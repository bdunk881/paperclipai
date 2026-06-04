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
export {
  getCommsQueue,
  getCommsDlqQueue,
  enqueueCommsSend,
  resetCommsQueueForTests,
  resetCommsDlqQueueForTests,
} from "./commsQueue";
export type { CommsSendJobPayload } from "./commsQueue";
export { processCommsSendJob, startCommsWorker, resetCommsWorkerForTests } from "./commsWorker";
export { commsSpendStore, COMMS_SPEND_SYSTEM_ACTOR_USER_ID } from "./commsSpendStore";
export type { CommsSpendEntry, CommsSpendSummary, RecordCommsSpendInput } from "./commsSpendStore";
export { estimateCommsCostUsd } from "./pricing";
