import * as Schema from "effect/Schema";

export const ID = Schema.String;
export const JSONObject = Schema.Record(Schema.String, Schema.Unknown);

export const DeviceRunSessionStatus = Schema.Literals([
  "STARTING",
  "RUNNING",
  "STOPPING",
  "STOPPED",
  "ERRORED",
]);
export type DeviceRunSessionStatus = typeof DeviceRunSessionStatus.Type;

export const CreateDeviceRunSessionInput = Schema.Record(Schema.String, Schema.Unknown);
export const DeviceRunSessionFilterInput = Schema.Record(Schema.String, Schema.Unknown);

export namespace Typename {
  export type Actor = string;
  export type DeviceRunSessionRemoteConfig = string;
}
