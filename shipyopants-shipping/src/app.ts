import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import * as AWS from "aws-sdk";
import { sequenceT } from "fp-ts/lib/Apply";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import * as O from "fp-ts/lib/Option";

import Shippo, { Parcel } from "shippo";
import {
  AddressDTO,
  GetRatesResponse,
  ParcelDTO,
  RateDTO,
  ShippingError,
} from "./shippingTypes";

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const shippoTokenFromAWS: string = await getParameterFromSSM(
    "SHIPPO_TOKEN_SB",
    true
  );

  const shippo = Shippo(shippoTokenFromAWS);

  console.log(`executing ${event.path.toLocaleLowerCase()}`);

  if (event.path.toLocaleLowerCase() === "/address/validate") {
    return validateAddress(event, shippo);
  } else if (event.path.toLocaleLowerCase() === "/getrates") {
    return getRates(event, shippo);
  } else {
    const err: ShippingError = {
      message: "Invalid endpoint",
      statusCode: 404,
    };

    return shippingErrorToResponse(err);
  }
};

const makeShippoValidateCall = async (
  shippo: Shippo.Shippo,
  addReq: Shippo.CreateAddressRequest
): Promise<APIGatewayProxyResult> => {
  try {
    const resp = await shippo.address.create(addReq);
    console.log(JSON.stringify(resp));

    const address: AddressDTO = {
      name: resp.name,
      city: resp.city,
      state: resp.state,
      zipCode: resp.zip,
      street: resp.street1,
      country: "US",
    };

    const res: APIGatewayProxyResult = {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        validationResults: resp.validation_results,
        address: address,
      }),
    };

    return res;
  } catch (err) {
    console.error(JSON.stringify(err));
    const errorRes: APIGatewayProxyResult = {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(err),
    };

    return errorRes;
  }
};

const getParameterFromSSM = async (
  name: string,
  decrypt: boolean
): Promise<string> => {
  const ssm = new AWS.SSM({ region: "us-east-1" });
  const result = await ssm
    .getParameter({ Name: name, WithDecryption: decrypt })
    .promise();
  return result.Parameter.Value;
};

const buildShippingError = (message: string, status: number): ShippingError => {
  return {
    message: message,
    statusCode: status,
  };
};

export const validateAddress = async (
  event: APIGatewayProxyEvent,
  shippo: Shippo.Shippo
): Promise<APIGatewayProxyResult> => {
  const input: E.Either<ShippingError, Shippo.CreateAddressRequest> =
    parseIncomingEvent(event);

  return E.fold(
    async (err: ShippingError) => {
      const error: APIGatewayProxyResult = {
        statusCode: err.statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(err),
      };

      return Promise.resolve(error);
    },
    async (addReq: Shippo.CreateAddressRequest) => {
      const res = makeShippoValidateCall(shippo, addReq);

      return res;
    }
  )(input);
};

export const getRates = async (
  event: APIGatewayProxyEvent,
  shippo: Shippo.Shippo
): Promise<APIGatewayProxyResult> => {
  return pipe(
    parseGetRatesEvent(event),
    E.fold(
      (err: ShippingError) => Promise.resolve(E.left(err)),
      (createReq: Shippo.CreateShipmentRequest) =>
        makeShippoGetRatesCall(createReq, shippo)
    ),
    async (
      resultPromise: Promise<E.Either<ShippingError, GetRatesResponse>>
    ) => {
      const result = await resultPromise;

      return E.fold(
        (err: ShippingError) => shippingErrorToResponse(err),
        (shippoResp: GetRatesResponse) => {
          const gatewayRes: APIGatewayProxyResult = {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(shippoResp),
          };

          return gatewayRes;
        }
      )(result);
    }
  );
};

const shippingErrorToResponse = (err: ShippingError): APIGatewayProxyResult => {
  const error: APIGatewayProxyResult = {
    statusCode: err.statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(err),
  };

  return error;
};

const makeShippoGetRatesCall = async (
  payload: Shippo.CreateShipmentRequest,
  shippo: Shippo.Shippo
): Promise<E.Either<ShippingError, GetRatesResponse>> => {
  try {
    const shippoRes = await shippo.shipment.create(payload);

    const rates: RateDTO[] = shippoRes.rates.map((shippoRate: Shippo.Rate) => {
      const rateDTO: RateDTO = {
        amount: shippoRate.amount,
        provider: shippoRate.provider,
        serviceName: shippoRate.servicelevel.token,
      };

      return rateDTO;
    });

    const ratesResp: GetRatesResponse = {
      fromAddress: adaptShippoAddressToAddressDTO(payload.address_from),
      toAddress: adaptShippoAddressToAddressDTO(payload.address_to),
      parcels: payload.parcels as Parcel[],
      rates: rates,
    };

    return E.right(ratesResp);
  } catch (err) {
    return Promise.resolve(E.left(buildShippingError(err.message, 500)));
  }
};

const parseGetRatesEvent = (
  event: APIGatewayProxyEvent
): E.Either<ShippingError, Shippo.CreateShipmentRequest> => {
  try {
    const parsed = JSON.parse(event.body);
    const toAddress: O.Option<AddressDTO> = O.fromNullable(parsed.toAddress);
    const fromAddress: O.Option<AddressDTO> = O.fromNullable(
      parsed.fromAddress
    );
    const parcel: O.Option<ParcelDTO> = O.fromNullable(parsed.parcel);

    const optSequence = sequenceT(O.Apply)(toAddress, fromAddress, parcel);

    return O.fold(
      () => E.left(buildShippingError("Invalid input data", 400)),
      (validated: [AddressDTO, AddressDTO, ParcelDTO]) => {
        const from = adaptAddressDTOToShippoAddress(validated[1]);
        const to = adaptAddressDTOToShippoAddress(validated[0]);
        const parcel: Parcel = {
          distance_unit: "in",
          height: validated[2].height,
          weight: validated[2].weight,
          length: validated[2].length,
          width: validated[2].width,
          mass_unit: "lb",
        };

        const createReq: Shippo.CreateShipmentRequest = {
          address_from: from,
          address_to: to,
          parcels: [parcel],
        };

        return E.right(createReq);
      }
    )(optSequence);
  } catch (err) {
    const message: string = "Unable to parse incoming event";
    return E.left(buildShippingError(message, 400));
  }
};

const parseIncomingEvent = (
  event: APIGatewayProxyEvent
): E.Either<ShippingError, Shippo.CreateAddressRequest> => {
  try {
    const parsed = JSON.parse(event.body);

    const address: O.Option<AddressDTO> = O.fromNullable(parsed.address);

    return O.fold(
      () =>
        E.left({
          message: "Unable to parse address from input",
          statusCode: 400,
        }),
      (address: AddressDTO) => {
        const shippoReq: Shippo.CreateAddressRequest = {
          name: address.name,
          street1: address.street,
          city: address.city,
          zip: address.zipCode,
          state: address.state,
          country: address.country,
          validate: true,
        };

        return E.right(shippoReq);
      }
    )(address);
  } catch (err) {
    const message: string = "Unable to parse incoming event";

    return E.left({
      message: message,
      statusCode: 400,
    });
  }
};

const adaptAddressDTOToShippoAddress = (
  address: AddressDTO
): Shippo.Address => {
  const shippoAddr: Shippo.Address = {
    street1: address.street,
    city: address.city,
    state: address.state,
    zip: address.zipCode,
    country: address.country,
    name: address.name,
  };

  return shippoAddr;
};

const adaptShippoAddressToAddressDTO = (
  shippoAddr: Shippo.Address
): AddressDTO => {
  const address: AddressDTO = {
    name: shippoAddr.name,
    city: shippoAddr.city,
    state: shippoAddr.state,
    zipCode: shippoAddr.zip,
    street: shippoAddr.street1,
    country: shippoAddr.country,
  };

  return address;
};
