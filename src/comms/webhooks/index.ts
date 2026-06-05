/**
 * Inbound comms webhooks (HEL-613) — public surface.
 *
 * Normalize provider delivery/bounce/complaint/inbound-SMS events → resolve
 * tenant → publish `wake_events` → triage → (on ACT) boot an agent run.
 */

export { createCommsWebhookRoutes, type CommsWebhookDeps } from "./routes";
export {
  createCommsInboundIngest,
  type CommsInboundIngest,
  type CommsInboundIngestDeps,
  type CommsInboundIngestResult,
} from "./ingest";
export {
  normalizeTelnyxWebhook,
  normalizeSesEvent,
  type SesEventLike,
} from "./normalize";
export { verifyTelnyxSignature, TELNYX_PUBLIC_KEY_ENV } from "./telnyxSignature";
export { inboundRouteStore } from "./inboundRouteStore";
export type {
  NormalizedInboundEvent,
  CommsInboundKind,
  InboundTenancy,
} from "./types";
