const LOOPS_API_BASE = "https://app.loops.so/api/v1";

interface LoopsContact {
  email: string;
  firstName?: string;
  companyName?: string;
  userId?: string;
  userGroup?: string; // tier: starter | pro | enterprise
  signupDate?: string; // ISO datetime
}

export async function upsertLoopsContact(contact: LoopsContact): Promise<void> {
  const apiKey = process.env.LOOPS_API_KEY;
  if (!apiKey) {
    console.warn("[loops] LOOPS_API_KEY not set — skipping contact upsert");
    return;
  }

  const res = await fetch(`${LOOPS_API_BASE}/contacts/update`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: contact.email,
      firstName: contact.firstName,
      companyName: contact.companyName,
      userId: contact.userId,
      userGroup: contact.userGroup,
      signupDate: contact.signupDate,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[loops] upsertContact failed ${res.status}: ${body}`);
    throw new Error(`Loops contact upsert failed: ${res.status}`);
  }
}

export async function sendLoopsEvent(
  email: string,
  eventName: string,
  properties?: Record<string, string>
): Promise<void> {
  const apiKey = process.env.LOOPS_API_KEY;
  if (!apiKey) {
    console.warn("[loops] LOOPS_API_KEY not set — skipping event send");
    return;
  }

  const res = await fetch(`${LOOPS_API_BASE}/events/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      eventName,
      ...(properties && { eventProperties: properties }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[loops] sendEvent failed ${res.status}: ${body}`);
    throw new Error(`Loops event send failed: ${res.status}`);
  }
}

/** Map internal tier slugs to Loops-facing tier labels */
export function mapTierToLoops(tier: string): string {
  switch (tier) {
    case "growth":
      return "pro";
    case "scale":
      return "enterprise";
    default:
      return "starter";
  }
}

/** True for tiers that warrant CSM outreach (growth / scale) */
export function tierRequiresCSM(tier: string): boolean {
  return tier === "growth" || tier === "scale";
}
