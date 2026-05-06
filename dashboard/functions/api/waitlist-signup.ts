export const onRequestPost = async (context: { request: Request }) => {
  const payload = (await context.request.json().catch(() => null)) as { email?: string } | null;
  const email = payload?.email?.trim();

  if (!email || !email.includes("@")) {
    return json({ error: "Valid email required" }, 400);
  }

  console.log(`[waitlist] New signup: ${email}`);
  return json({ ok: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
