import { string } from "fp-ts";
import { Parcel } from "shippo";

export interface AddressDTO {
  name: string;
  city: string;
  state: string;
  zipCode: string;
  street: string;
  country: string;
}

export interface ShippingError {
  message: string;
  statusCode: number;
}

export interface ParcelDTO {
  width: number;
  weight: number;
  height: number;
  length: number;
}

export interface GetRatesRequest {
  fromAddress: AddressDTO;
  toAddress: AddressDTO;
  parcel: ParcelDTO;
}

export interface RateDTO {
  amount: number;
  provider: string;
  serviceName: string;
}

export interface GetRatesResponse {
  fromAddress: AddressDTO;
  toAddress: AddressDTO;
  parcels: Parcel[];
  rates: RateDTO[];
}
