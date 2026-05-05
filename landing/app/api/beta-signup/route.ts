interface BetaSignupBody {
  name?: string;
  email?: string;
  company?: string;
  currentTools?: string;
  useCase?: string;
  caseStudyInterest?: boolean;
}

export async function action({ request }: { request: Request }) {
  const body = (await request.json()) as BetaSignupBody;

  const { name, email, company, currentTools, useCase, caseStudyInterest } =
    body;

  if (
    !name?.trim() ||
    !email?.trim() ||
    !company?.trim() ||
    !currentTools?.trim() ||
    !useCase?.trim()
  ) {
    return Response.json(
      { error: "All fields are required" },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }

  const webhookUrl = process.env.ZAPIER_BETA_SIGNUP_WEBHOOK_URL;
  if (!webhookUrl) {
    return Response.json({ ok: true });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        company: company.trim(),
        currentTools: currentTools.trim(),
        useCase: useCase.trim(),
        caseStudyInterest: !!caseStudyInterest,
        source: "landing-page-beta-signup",
        submittedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Beta signup webhook error:", err);
    return Response.json(
      { error: "Failed to submit application" },
      { status: 500 }
    );
  }
}
