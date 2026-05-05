export async function action({ request }: { request: Request }) {
  const payload = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = payload?.email?.trim();

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email required" }, { status: 400 });
  }

  console.log(`[waitlist] New signup: ${email}`);
  return Response.json({ ok: true });
}
