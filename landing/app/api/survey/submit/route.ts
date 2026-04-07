import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".survey-data");

interface SurveyPayload {
  surveyId: string;
  email: string;
  responses: Record<string, string | number>;
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function getSubmissions(surveyId: string): Promise<SurveyPayload[]> {
  const filePath = path.join(DATA_DIR, `${surveyId}.json`);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveSubmissions(surveyId: string, submissions: SurveyPayload[]) {
  const filePath = path.join(DATA_DIR, `${surveyId}.json`);
  await fs.writeFile(filePath, JSON.stringify(submissions, null, 2));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SurveyPayload;
    const { surveyId, email, responses } = body;

    if (!surveyId || !email || !responses) {
      return NextResponse.json(
        { error: "Missing required fields: surveyId, email, responses" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (!["day-7", "day-30"].includes(surveyId)) {
      return NextResponse.json({ error: "Invalid survey ID" }, { status: 400 });
    }

    await ensureDataDir();
    const submissions = await getSubmissions(surveyId);

    // Enforce 1 response per email
    if (submissions.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json(
        { error: "You have already submitted this survey." },
        { status: 409 }
      );
    }

    submissions.push({
      surveyId,
      email,
      responses: { ...responses, submittedAt: new Date().toISOString() },
    });

    await saveSubmissions(surveyId, submissions);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Survey submission error:", err);
    return NextResponse.json(
      { error: "Failed to save survey response" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const surveyId = req.nextUrl.searchParams.get("surveyId");

  if (!surveyId || !["day-7", "day-30"].includes(surveyId)) {
    return NextResponse.json({ error: "Invalid or missing surveyId" }, { status: 400 });
  }

  await ensureDataDir();
  const submissions = await getSubmissions(surveyId);

  return NextResponse.json({ surveyId, count: submissions.length, submissions });
}
