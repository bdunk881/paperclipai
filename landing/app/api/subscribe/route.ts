import { NextRequest, NextResponse } from "next/server";
import { getResend, AUDIENCE_ID } from "@/lib/resend";

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    const audienceId = AUDIENCE_ID();
    if (audienceId) {
      const resend = getResend();
      await resend.contacts.create({
        email,
        audienceId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Resend subscribe error:", err);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}
