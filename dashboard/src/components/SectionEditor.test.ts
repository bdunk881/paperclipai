/**
 * Round-trip + edge-case coverage for the SectionEditor parser/serializer
 * (Wave 3). The page stores Job Description bodies as a single markdown
 * string; the parser must lossily split + losslessly recombine the three
 * named sections so editing in Sections mode is invertible.
 */

import { describe, expect, it } from "vitest";
import { parseSections, serializeSections, type NamedSection } from "./SectionEditor";

const SECTIONS: NamedSection[] = [
  { heading: "Mission" },
  { heading: "How they work" },
  { heading: "Hard rules" },
];

describe("parseSections", () => {
  it("returns empty bodies when the input has no headings", () => {
    const out = parseSections("", SECTIONS);
    expect(out).toEqual({
      Mission: "",
      "How they work": "",
      "Hard rules": "",
    });
  });

  it("captures content under each known heading", () => {
    const body = [
      "## Mission",
      "Keep customers happy.",
      "",
      "## How they work",
      "Daily check.",
      "",
      "## Hard rules",
      "- Never discount.",
    ].join("\n");
    const out = parseSections(body, SECTIONS);
    expect(out["Mission"]).toBe("Keep customers happy.");
    expect(out["How they work"]).toBe("Daily check.");
    expect(out["Hard rules"]).toBe("- Never discount.");
  });

  it("ignores H2 headings that aren't in the known list", () => {
    const body = "## Random\nSome stray text.\n\n## Mission\nGo.";
    const out = parseSections(body, SECTIONS);
    expect(out["Mission"]).toBe("Go.");
  });

  it("trims surrounding whitespace from section bodies", () => {
    const body = "## Mission\n\n  Keep accounts healthy.   \n\n";
    const out = parseSections(body, SECTIONS);
    expect(out["Mission"]).toBe("Keep accounts healthy.");
  });

  it("matches headings case-insensitively", () => {
    const body = "## mission\nGo.\n";
    const out = parseSections(body, SECTIONS);
    expect(out["Mission"]).toBe("Go.");
  });
});

describe("serializeSections", () => {
  it("omits empty sections", () => {
    expect(
      serializeSections([
        { heading: "Mission", body: "Go." },
        { heading: "How they work", body: "   " },
        { heading: "Hard rules", body: "- Never X." },
      ]),
    ).toBe("## Mission\nGo.\n\n## Hard rules\n- Never X.");
  });

  it("preserves the order in which sections are passed", () => {
    expect(
      serializeSections([
        { heading: "Hard rules", body: "- Never X." },
        { heading: "Mission", body: "Go." },
      ]),
    ).toBe("## Hard rules\n- Never X.\n\n## Mission\nGo.");
  });
});

describe("parse(serialize(x)) round-trip", () => {
  it("is invertible for a fully populated body", () => {
    const blocks = [
      { heading: "Mission", body: "Keep customers happy." },
      { heading: "How they work", body: "Daily check.\nWeekly review." },
      { heading: "Hard rules", body: "- Never discount." },
    ];
    const serialized = serializeSections(blocks);
    const parsed = parseSections(serialized, SECTIONS);
    expect(parsed["Mission"]).toBe(blocks[0]!.body);
    expect(parsed["How they work"]).toBe(blocks[1]!.body);
    expect(parsed["Hard rules"]).toBe(blocks[2]!.body);
  });

  it("is invertible when one section is empty (omitted in serialized form)", () => {
    const blocks = [
      { heading: "Mission", body: "Go." },
      { heading: "How they work", body: "" },
      { heading: "Hard rules", body: "- Never X." },
    ];
    const serialized = serializeSections(blocks);
    const parsed = parseSections(serialized, SECTIONS);
    expect(parsed["Mission"]).toBe("Go.");
    expect(parsed["How they work"]).toBe("");
    expect(parsed["Hard rules"]).toBe("- Never X.");
  });
});
