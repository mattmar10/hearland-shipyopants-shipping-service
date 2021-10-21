"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRates = exports.validateAddress = exports.lambdaHandler = void 0;
const AWS = __importStar(require("aws-sdk"));
const Apply_1 = require("fp-ts/lib/Apply");
const E = __importStar(require("fp-ts/lib/Either"));
const function_1 = require("fp-ts/lib/function");
const O = __importStar(require("fp-ts/lib/Option"));
const shippo_1 = __importDefault(require("shippo"));
const lambdaHandler = async (event) => {
    const shippoTokenFromAWS = await getParameterFromSSM("SHIPPO_TOKEN_SB", true);
    const shippo = shippo_1.default(shippoTokenFromAWS);
    console.log(`executing ${event.path.toLocaleLowerCase()}`);
    if (event.path.toLocaleLowerCase() === "/address/validate") {
        return exports.validateAddress(event, shippo);
    }
    else if (event.path.toLocaleLowerCase() === "/getrates") {
        return exports.getRates(event, shippo);
    }
    else {
        const err = {
            message: "Invalid endpoint",
            statusCode: 404,
        };
        return shippingErrorToResponse(err);
    }
};
exports.lambdaHandler = lambdaHandler;
const makeShippoValidateCall = async (shippo, addReq) => {
    try {
        const resp = await shippo.address.create(addReq);
        console.log(JSON.stringify(resp));
        const address = {
            name: resp.name,
            city: resp.city,
            state: resp.state,
            zipCode: resp.zip,
            street: resp.street1,
            country: "US",
        };
        const res = {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                validationResults: resp.validation_results,
                address: address,
            }),
        };
        return res;
    }
    catch (err) {
        console.error(JSON.stringify(err));
        const errorRes = {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(err),
        };
        return errorRes;
    }
};
const getParameterFromSSM = async (name, decrypt) => {
    const ssm = new AWS.SSM({ region: "us-east-1" });
    const result = await ssm
        .getParameter({ Name: name, WithDecryption: decrypt })
        .promise();
    return result.Parameter.Value;
};
const buildShippingError = (message, status) => {
    return {
        message: message,
        statusCode: status,
    };
};
const validateAddress = async (event, shippo) => {
    const input = parseIncomingEvent(event);
    return E.fold(async (err) => {
        const error = {
            statusCode: err.statusCode,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(err),
        };
        return Promise.resolve(error);
    }, async (addReq) => {
        const res = makeShippoValidateCall(shippo, addReq);
        return res;
    })(input);
};
exports.validateAddress = validateAddress;
const getRates = async (event, shippo) => {
    return function_1.pipe(parseGetRatesEvent(event), E.fold((err) => Promise.resolve(E.left(err)), (createReq) => makeShippoGetRatesCall(createReq, shippo)), async (resultPromise) => {
        const result = await resultPromise;
        return E.fold((err) => shippingErrorToResponse(err), (shippoResp) => {
            const gatewayRes = {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(shippoResp),
            };
            return gatewayRes;
        })(result);
    });
};
exports.getRates = getRates;
const shippingErrorToResponse = (err) => {
    const error = {
        statusCode: err.statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(err),
    };
    return error;
};
const makeShippoGetRatesCall = async (payload, shippo) => {
    try {
        const shippoRes = await shippo.shipment.create(payload);
        const rates = shippoRes.rates.map((shippoRate) => {
            const rateDTO = {
                amount: shippoRate.amount,
                provider: shippoRate.provider,
                serviceName: shippoRate.servicelevel.token,
            };
            return rateDTO;
        });
        const ratesResp = {
            fromAddress: adaptShippoAddressToAddressDTO(payload.address_from),
            toAddress: adaptShippoAddressToAddressDTO(payload.address_to),
            parcels: payload.parcels,
            rates: rates,
        };
        return E.right(ratesResp);
    }
    catch (err) {
        return Promise.resolve(E.left(buildShippingError(err.message, 500)));
    }
};
const parseGetRatesEvent = (event) => {
    try {
        const parsed = JSON.parse(event.body);
        const toAddress = O.fromNullable(parsed.toAddress);
        const fromAddress = O.fromNullable(parsed.fromAddress);
        const parcel = O.fromNullable(parsed.parcel);
        const optSequence = Apply_1.sequenceT(O.Apply)(toAddress, fromAddress, parcel);
        return O.fold(() => E.left(buildShippingError("Invalid input data", 400)), (validated) => {
            const from = adaptAddressDTOToShippoAddress(validated[1]);
            const to = adaptAddressDTOToShippoAddress(validated[0]);
            const parcel = {
                distance_unit: "in",
                height: validated[2].height,
                weight: validated[2].weight,
                length: validated[2].length,
                width: validated[2].width,
                mass_unit: "lb",
            };
            const createReq = {
                address_from: from,
                address_to: to,
                parcels: [parcel],
            };
            return E.right(createReq);
        })(optSequence);
    }
    catch (err) {
        const message = "Unable to parse incoming event";
        return E.left(buildShippingError(message, 400));
    }
};
const parseIncomingEvent = (event) => {
    try {
        const parsed = JSON.parse(event.body);
        const address = O.fromNullable(parsed.address);
        return O.fold(() => E.left({
            message: "Unable to parse address from input",
            statusCode: 400,
        }), (address) => {
            const shippoReq = {
                name: address.name,
                street1: address.street,
                city: address.city,
                zip: address.zipCode,
                state: address.state,
                country: address.country,
                validate: true,
            };
            return E.right(shippoReq);
        })(address);
    }
    catch (err) {
        const message = "Unable to parse incoming event";
        return E.left({
            message: message,
            statusCode: 400,
        });
    }
};
const adaptAddressDTOToShippoAddress = (address) => {
    const shippoAddr = {
        street1: address.street,
        city: address.city,
        state: address.state,
        zip: address.zipCode,
        country: address.country,
        name: address.name,
    };
    return shippoAddr;
};
const adaptShippoAddressToAddressDTO = (shippoAddr) => {
    const address = {
        name: shippoAddr.name,
        city: shippoAddr.city,
        state: shippoAddr.state,
        zipCode: shippoAddr.zip,
        street: shippoAddr.street1,
        country: shippoAddr.country,
    };
    return address;
};
//# sourceMappingURL=app.js.map