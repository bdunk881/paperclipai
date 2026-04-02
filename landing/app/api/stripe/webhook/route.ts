import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  mapTierToLoops,
  sendLoopsEvent,
  tierRequiresCSM,
  upsertLoopsContact,
} from "@/lib/loops";

// Next.js App Router: disable body parsing so we can verify the raw signature
export const config = { api: { bodyParser: false } };

async function notifyCSM(params: {
  email: string;
  firstName: string;
  companyName: string;
  tier: string;
  signupDate: string;
  userId: string;
}): Promise<void> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_WEBHOOK_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const csmAgentId = process.env.PAPERCLIP_CSM_AGENT_ID ?? "0cc5e90d-8514-40ea-b502-da0a585cd1df";
  const goalId = process.env.PAPERCLIP_ONBOARDING_GOAL_ID ?? "aa40b2bf-bf64-48a5-991d-0fcadd431a34";

  if (!apiUrl || !apiKey || !companyId) {
    console.warn("[paperclip] PAPERCLIP_WEBHOOK_API_KEY / PAPERCLIP_API_URL / PAPERCLIP_COMPANY_ID not set — skipping CSM task creation");
    return;
  }

  const title = `New ${params.tier} signup — ${params.email} · personal outreach within 24h`;
  const description = [
    `## New Paid User — CSM Outreach Required`,
    ``,
    `A new **${params.tier}** subscriber just completed checkout and needs a personal touch within **24 hours**.`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Email | ${params.email} |`,
    `| Name | ${params.firstName} |`,
    `| Company | ${params.companyName || "—"} |`,
    `| Tier | ${params.tier} |`,
    `| Signup date | ${params.signupDate} |`,
    `| User ID | ${params.userId || "—"} |`,
    ``,
    `**Action:** Send a personal welcome email within 24h. Offer an onboarding call, ask about use-case goals, and flag any enterprise requirements.`,
  ].join("\n");

  const res = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      description,
      status: "todo",
      priority: "high",
      assigneeAgentId: csmAgentId,
      goalId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[paperclip] CSM task creation failed ${res.status}: ${body}`);
    // Non-fatal — log and continue
  } else {
    const task = await res.json() as { identifier?: string };
    console.log(`[paperclip] CSM task created: ${task.identifier}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Read raw body — required for signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe/webhook] Signature verification failed: ${msg}`);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only process paid subscriptions
    if (session.mode !== "subscription" || session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    const meta = session.metadata ?? {};
    const email =
      meta.email ?? session.customer_details?.email ?? session.customer_email ?? "";
    const firstName = meta.firstName ?? session.customer_details?.name?.split(" ")[0] ?? "";
    const companyName = meta.companyName ?? "";
    const userId = meta.userId ?? "";
    const tier = meta.tier ?? "starter";
    const signupDate = new Date().toISOString();

    if (!email) {
      console.warn("[stripe/webhook] checkout.session.completed missing email — skipping Loops");
      return NextResponse.json({ received: true });
    }

    const loopsTier = mapTierToLoops(tier);

    try {
      // 1. Create / update Loops.so contact with all required properties
      await upsertLoopsContact({
        email,
        firstName,
        companyName,
        userId,
        userGroup: loopsTier,
        signupDate,
      });

      // 2. Fire user_signed_up event to trigger Sequence B
      await sendLoopsEvent(email, "user_signed_up", {
        tier: loopsTier,
        signupDate,
        ...(firstName ? { firstName } : {}),
        ...(companyName ? { companyName } : {}),
        ...(userId ? { userId } : {}),
      });

      console.log(`[loops] user_signed_up fired for ${email} (tier=${loopsTier})`);
    } catch (err) {
      console.error("[loops] Error firing Loops.so event:", err);
      // Return 500 so Stripe retries the webhook
      return NextResponse.json({ error: "Loops event failed" }, { status: 500 });
    }

    // 3. CSM notification for growth / scale tiers
    if (tierRequiresCSM(tier)) {
      // Non-blocking — don't fail the webhook if CSM task creation fails
      notifyCSM({ email, firstName, companyName, tier: loopsTier, signupDate, userId }).catch(
        (err) => console.error("[paperclip] notifyCSM error:", err)
      );
    }
  }

  return NextResponse.json({ received: true });
}
