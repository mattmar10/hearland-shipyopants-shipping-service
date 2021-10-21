"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddressAdapter = void 0;
class AddressAdapter {
    constructor() { }
    static adaptAddressDTOToShippoAddress(address) {
        const shippoAddr = {
            street1: address.street,
            city: address.city,
            state: address.state,
            zip: address.zipCode,
            country: address.country,
            name: address.name,
        };
        return shippoAddr;
    }
    static adaptShippoAddressToAddressDTO(shippoAddr) {
        const address = {
            name: shippoAddr.name,
            city: shippoAddr.city,
            state: shippoAddr.state,
            zipCode: shippoAddr.zip,
            street: shippoAddr.street1,
            country: shippoAddr.country,
        };
        return address;
    }
}
exports.AddressAdapter = AddressAdapter;
//# sourceMappingURL=addressAdapter.js.map