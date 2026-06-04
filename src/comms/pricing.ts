/**
 * Comms cost estimation (HEL-611). v1 static per-(channel, provider) rates from
 * the comms-stack strategy's pricing tables — approximate US list prices for
 * spend *attribution*, not billing. Email is per message; SMS per segment;
 * voice per minute (units = minutes). Refine later with provider-reported cost
 * (e.g. Telnyx returns `cost` on the send response) or an env/DB override.
 */

import { CommsChannel } from "./types";

// USD per unit. `default` applies when the provider isn't explicitly listed.
const RATES: Record<CommsChannel, Record<string, number>> = {
  email: { ses: 0.0001, resend: 0.0004, sendgrid: 0.0008, default: 0.0002 },
  sms: { telnyx: 0.0055, twilio: 0.0083, default: 0.0075 },
  voice: { telnyx: 0.003, twilio: 0.014, default: 0.01 },
};

/** Estimated USD cost for `units` of `channel` via `provider`. */
export function estimateCommsCostUsd(
  channel: CommsChannel,
  provider: string | undefined,
  units = 1,
): number {
  const channelRates = RATES[channel];
  if (!channelRates) {
    return 0;
  }
  const rate = (provider ? channelRates[provider] : undefined) ?? channelRates.default ?? 0;
  return Number((rate * Math.max(0, units)).toFixed(6));
}
