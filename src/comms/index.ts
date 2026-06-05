/**
 * Comms gateway package — the AutoFlow-owned outbound-comms control plane.
 * See project "Comms gateway + managed comms (SMS, voice, Layer C)".
 */

export * from "./types";
export { CommsGateway, commsGateway } from "./gateway";
export type { CommsGatewayDeps } from "./gateway";
export { commsSendStore, COMMS_SYSTEM_ACTOR_USER_ID } from "./commsSendStore";
export type { InsertQueuedInput } from "./commsSendStore";
export { TelnyxSmsTransport, isTelnyxConfigured } from "./transports/telnyxSms";
export { registerCommsTransports } from "./transports/registerTransports";
