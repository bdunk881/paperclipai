import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return NextResponse.json({
      status: session.status,
      customerEmail: session.customer_details?.email ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve session" },
      { status: 500 }
    );
  }
}
