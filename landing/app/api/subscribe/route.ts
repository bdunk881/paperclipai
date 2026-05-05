export async function action({ request }: { request: Request }) {
  const { email } = (await request.json()) as { email?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }

  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!webhookUrl) {
    return Response.json({ ok: true });
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

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Zapier webhook error:", err);
    return Response.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}
