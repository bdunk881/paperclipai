import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body as { email?: string };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  // TODO: persist to database or forward to email service (e.g. Mailchimp, Resend)
  console.log(`[waitlist] New signup: ${email}`);

  return res.status(200).json({ ok: true });
}
