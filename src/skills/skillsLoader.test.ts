import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import {
  getSkill,
  loadAllSkills,
  resetSkillsCacheForTests,
  resolveSkills,
} from "./skillsLoader";

const ENV_KEY = "AUTOFLOW_SKILLS_DIR";

let tempDir: string | undefined;
let prevEnv: string | undefined;

function makeSkillsTree(skills: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-loader-"));
  for (const [name, content] of Object.entries(skills)) {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  }
  return dir;
}

beforeEach(() => {
  prevEnv = process.env[ENV_KEY];
  resetSkillsCacheForTests();
});

afterEach(() => {
  resetSkillsCacheForTests();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (prevEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = prevEnv;
});

describe("skillsLoader", () => {
  it("parses single-line and multi-line frontmatter fields", () => {
    tempDir = makeSkillsTree({
      pdf: `---
name: pdf
description: One-liner description
license: Proprietary
---

# PDF body
`,
      complex: `---
name: complex
description: >
  A multi-line description
  that spans several lines
  with extra detail
---

Body of complex skill.
`,
    });
    process.env[ENV_KEY] = tempDir;

    const all = loadAllSkills();
    expect(all.size).toBe(2);
    expect(all.get("pdf")?.description).toBe("One-liner description");
    expect(all.get("pdf")?.license).toBe("Proprietary");
    expect(all.get("complex")?.description).toContain("A multi-line description");
    expect(all.get("complex")?.description).toContain("extra detail");
  });

  it("falls back to the directory name when no `name:` is set", () => {
    tempDir = makeSkillsTree({
      bare: `---
description: Bare skill with no name
---

body
`,
    });
    process.env[ENV_KEY] = tempDir;
    expect(getSkill("bare")?.name).toBe("bare");
  });

  it("skips directories without a SKILL.md", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-loader-bad-"));
    fs.mkdirSync(path.join(tempDir, "empty-dir"), { recursive: true });
    process.env[ENV_KEY] = tempDir;
    const all = loadAllSkills();
    expect(all.size).toBe(0);
  });

  it("returns an empty map when the skills dir doesn't exist", () => {
    process.env[ENV_KEY] = "/nonexistent/path/that/should/not/exist";
    expect(loadAllSkills().size).toBe(0);
  });

  it("resolves a list of skill keys and silently drops unknown ones", () => {
    tempDir = makeSkillsTree({
      pdf: "---\nname: pdf\n---\nbody",
      docx: "---\nname: docx\n---\nbody",
    });
    process.env[ENV_KEY] = tempDir;
    const resolved = resolveSkills(["pdf", "missing", "docx"]);
    expect(resolved.map((s) => s.key)).toEqual(["pdf", "docx"]);
  });
});
