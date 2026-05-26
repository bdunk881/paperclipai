/**
 * Skills API contract tests (HEL-219).
 *
 * Uses supertest against an isolated Express app with a stubbed
 * skills directory so we don't depend on the real repo layout.
 */

import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { createSkillsRoutes } from "./skillsRoutes";
import { resetSkillsCacheForTests } from "./skillsLoader";

const SKILLS_DIR_ENV = "AUTOFLOW_SKILLS_DIR";

let prevEnv: string | undefined;
let tempDir: string | undefined;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/skills", createSkillsRoutes());
  return app;
}

function makeSkillsTree(skills: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-routes-"));
  for (const [name, content] of Object.entries(skills)) {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  }
  return dir;
}

beforeEach(() => {
  prevEnv = process.env[SKILLS_DIR_ENV];
  resetSkillsCacheForTests();
});

afterEach(() => {
  resetSkillsCacheForTests();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (prevEnv === undefined) delete process.env[SKILLS_DIR_ENV];
  else process.env[SKILLS_DIR_ENV] = prevEnv;
});

describe("GET /api/skills", () => {
  it("returns the installed skills as { skills: [...] }", async () => {
    tempDir = makeSkillsTree({
      pdf: `---\nname: pdf\ndescription: PDF utilities\n---\nbody`,
      docx: `---\nname: docx\ndescription: Word docs\nlicense: Proprietary\n---\nbody`,
    });
    process.env[SKILLS_DIR_ENV] = tempDir;

    const res = await request(buildApp()).get("/api/skills");
    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([
      { key: "docx", name: "docx", description: "Word docs", license: "Proprietary" },
      { key: "pdf", name: "pdf", description: "PDF utilities" },
    ]);
  });

  it("returns an empty list when no skills are installed", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-routes-empty-"));
    process.env[SKILLS_DIR_ENV] = tempDir;

    const res = await request(buildApp()).get("/api/skills");
    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([]);
  });
});

describe("GET /api/skills/manifest", () => {
  it("returns the manifest entries as a flat array", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manifest-"));
    process.env[SKILLS_DIR_ENV] = tempDir;
    fs.writeFileSync(
      path.join(tempDir, ".manifest.json"),
      JSON.stringify({
        generatedAt: "2026-05-26T20:00:00.000Z",
        entries: {
          pdf: {
            ref: "anthropics/skills@pdf",
            skillKey: "pdf",
            verdict: "approved",
            scannedAt: "2026-05-26T20:00:00.000Z",
            findings: [],
          },
          shady: {
            ref: "random/repo@shady",
            skillKey: "shady",
            verdict: "needs_review",
            scannedAt: "2026-05-26T20:00:00.000Z",
            findings: [
              {
                severity: "warning",
                code: "curl_pipe_sh",
                message: "Pipes downloaded content directly into a shell.",
              },
            ],
          },
        },
      }),
    );

    const res = await request(buildApp()).get("/api/skills/manifest");
    expect(res.status).toBe(200);
    expect(res.body.generatedAt).toBe("2026-05-26T20:00:00.000Z");
    expect(res.body.entries).toHaveLength(2);
    const verdicts = res.body.entries.map((e: { verdict: string }) => e.verdict).sort();
    expect(verdicts).toEqual(["approved", "needs_review"]);
  });

  it("returns an empty list when no manifest file exists", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manifest-empty-"));
    process.env[SKILLS_DIR_ENV] = tempDir;

    const res = await request(buildApp()).get("/api/skills/manifest");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], generatedAt: null });
  });

  it("returns empty when the manifest is malformed (warns, does not throw)", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manifest-bad-"));
    process.env[SKILLS_DIR_ENV] = tempDir;
    fs.writeFileSync(path.join(tempDir, ".manifest.json"), "{not valid json");

    const res = await request(buildApp()).get("/api/skills/manifest");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], generatedAt: null });
  });
});
