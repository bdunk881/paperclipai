import { Resend } from "resend";

export function getResend() {
  return new Resend(process.env.RESEND_API_KEY ?? "");
}

export const AUDIENCE_ID = () => process.env.RESEND_AUDIENCE_ID ?? "";
