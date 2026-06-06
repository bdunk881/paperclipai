/**
 * Wires concrete provider transports into a comms gateway at boot. Each
 * transport is env-gated, so an environment without a provider's credentials
 * simply doesn't register it — the gateway then has no transport for that
 * kind/channel and `comms.send` throws a clear "no transport" error rather
 * than failing silently.
 *
 * Telnyx is registered as the channel-wide default for SMS, so new managed
 * tenants default to Telnyx (comms-stack strategy). Per-workspace BYOC
 * Twilio/Telnyx is unaffected — it flows through `src/notifications/delivery.ts`.
 *
 * To make the gateway live, call this once at startup with the process-wide
 * gateway:
 *
 *   import { commsGateway, registerCommsTransports } from "./comms";
 *   registerCommsTransports(commsGateway);
 *
 * (Boot wiring lands with the Telnyx account — no env carries `TELNYX_API_KEY`
 * yet, so registration is currently inert by design.)
 */

import { CommsGateway } from "../gateway";
import { TelnyxSmsTransport, isTelnyxConfigured } from "./telnyxSms";
import { SesEmailTransport, isSesCustomerEmailConfigured } from "./sesEmail";

/** Register all env-configured transports on `gateway`. Returns the ids registered. */
export function registerCommsTransports(gateway: CommsGateway): string[] {
  const registered: string[] = [];

  if (isTelnyxConfigured()) {
    gateway.registerTransport("sms", new TelnyxSmsTransport());
    registered.push("telnyx");
  }

  // HEL-615: managed Layer-C customer email via SES (via.helloautoflow.com),
  // bound to kind:'customer' so it doesn't touch Layer A/B system mail.
  if (isSesCustomerEmailConfigured()) {
    gateway.registerTransport("email", new SesEmailTransport(), "customer");
    registered.push("ses-email");
  }

  return registered;
}
