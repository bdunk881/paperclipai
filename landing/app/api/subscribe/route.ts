import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!webhookUrl) {
    // Silently succeed if webhook is not configured (dev mode)
    return NextResponse.json({ ok: true });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "landing-page" }),
    });

    if (!res.ok) {
      throw new Error(`Zapier webhook returned ${res.status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Zapier webhook error:", err);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}
