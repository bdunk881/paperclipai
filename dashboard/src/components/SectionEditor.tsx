/**
 * SectionEditor (Wave 3) — splits a markdown body on conventional
 * H2 boundaries and renders one labeled <textarea> per named section.
 * Joins them back into a single markdown string on every edit so the
 * caller can save the body verbatim through the regular instruction
 * store.
 *
 * Why split + join instead of three separate fields in the DB:
 *   - The `workspace_instructions` table stores `body` as one TEXT
 *     column — splitting at the storage layer would mean migrating
 *     schema for a UI affordance.
 *   - The three-layer memory adapter inlines the full body into the
 *     agent's system prompt verbatim. A consistent markdown shape
 *     ("## Mission\n...\n\n## How they work\n...\n\n## Hard rules\n...")
 *     gives the model the same readable structure the human authored.
 *
 * The split is tolerant: if a section heading is missing from the
 * incoming body, the corresponding field renders empty (rather than
 * throwing). On save, only sections with content are emitted.
 */

import { useCallback } from "react";

export interface NamedSection {
  /** H2 text used as the boundary (case-insensitive when parsing). */
  heading: string;
  /** Plain-English explainer rendered as helper text under the textarea. */
  helperText?: string;
  /** Placeholder shown when the textarea is empty. */
  placeholder?: string;
}

export interface SectionEditorProps {
  /** Full markdown body, source of truth. */
  body: string;
  /** Called with the new joined body whenever any section changes. */
  onChange: (nextBody: string) => void;
  /** Section list in render order. */
  sections: NamedSection[];
  disabled?: boolean;
}

export function SectionEditor({ body, onChange, sections, disabled }: SectionEditorProps) {
  const parsed = parseSections(body, sections);

  const updateSection = useCallback(
    (heading: string, value: string) => {
      const next = sections.map((s) =>
        s.heading.toLowerCase() === heading.toLowerCase()
          ? { heading: s.heading, body: value }
          : { heading: s.heading, body: parsed[s.heading] ?? "" },
      );
      onChange(serializeSections(next));
    },
    [onChange, parsed, sections],
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {sections.map((section) => (
        <div key={section.heading}>
          <label
            className="af2-eyebrow"
            style={{
              display: "block",
              marginBottom: 6,
              color: "var(--af2-ink-2)",
            }}
          >
            {section.heading}
          </label>
          {section.helperText ? (
            <div
              className="af2-muted"
              style={{ fontSize: 12, marginBottom: 6 }}
            >
              {section.helperText}
            </div>
          ) : null}
          <textarea
            value={parsed[section.heading] ?? ""}
            disabled={disabled}
            placeholder={section.placeholder}
            onChange={(e) => updateSection(section.heading, e.target.value)}
            rows={6}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
              background: "var(--af2-card, #fff)",
              border: "1px solid var(--af2-line, #e0e0e0)",
              borderRadius: 8,
              resize: "vertical",
              color: "var(--af2-ink)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Parse a markdown body into a map of section heading → section body.
 * Headings are matched case-insensitively against the provided list;
 * the actual H2 line in the body must start with "## ".
 *
 * Exported for testability — the round-trip invariant
 * `serialize(parse(x)) === x` is the regression we care about.
 */
export function parseSections(
  body: string,
  knownSections: NamedSection[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const knownHeadings = knownSections.map((s) => s.heading.toLowerCase());
  // Initialize empty strings for every known section so the textareas
  // render even when the body is empty or missing a section.
  for (const s of knownSections) out[s.heading] = "";

  const lines = body.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentHeading) {
      const matched = knownSections.find(
        (s) => s.heading.toLowerCase() === currentHeading!.toLowerCase(),
      );
      if (matched) {
        out[matched.heading] = buffer.join("\n").trim();
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const h2Match = /^##\s+(.+?)\s*$/.exec(line);
    if (h2Match && knownHeadings.includes(h2Match[1]!.toLowerCase())) {
      flush();
      currentHeading = h2Match[1] ?? null;
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }
  flush();

  return out;
}

/**
 * Serialize section blocks back into a single markdown body. Sections
 * with empty bodies are omitted from the output so a half-filled draft
 * doesn't render with trailing empty headings.
 */
export function serializeSections(
  blocks: Array<{ heading: string; body: string }>,
): string {
  return blocks
    .filter((b) => b.body.trim().length > 0)
    .map((b) => `## ${b.heading}\n${b.body.trim()}`)
    .join("\n\n");
}
