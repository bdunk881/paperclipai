#!/usr/bin/env node
/**
 * Migrate markdown articles from content/articles/ into Sanity CMS as blogPost documents.
 *
 * Usage: node scripts/migrate-articles.mjs
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SANITY_PROJECT_ID
 *   NEXT_PUBLIC_SANITY_DATASET
 *   SANITY_API_TOKEN
 */

import fs from "fs";
import path from "path";
import { createClient } from "@sanity/client";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_TOKEN;

if (!projectId || !token) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID or SANITY_API_TOKEN");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: "2024-01-01",
  useCdn: false,
  token,
});

const ARTICLES_DIR = path.join(process.cwd(), "..", "content", "articles");

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, content: match[2].trim() };
}

function toSlug(filename) {
  return filename.replace(/\.md$/, "");
}

/** Convert markdown text to a basic Sanity Portable Text block array. */
function markdownToPortableText(md) {
  const blocks = [];
  const paragraphs = md.split(/\n{2,}/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Heading
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        _type: "block",
        _key: randomKey(),
        style: `h${level}`,
        children: [
          {
            _type: "span",
            _key: randomKey(),
            text: headingMatch[2],
            marks: [],
          },
        ],
        markDefs: [],
      });
      continue;
    }

    // List items
    if (trimmed.match(/^[-*]\s/m)) {
      const items = trimmed.split(/\n/).filter((l) => l.match(/^[-*]\s/));
      for (const item of items) {
        blocks.push({
          _type: "block",
          _key: randomKey(),
          style: "normal",
          listItem: "bullet",
          level: 1,
          children: [
            {
              _type: "span",
              _key: randomKey(),
              text: item.replace(/^[-*]\s+/, ""),
              marks: [],
            },
          ],
          markDefs: [],
        });
      }
      continue;
    }

    // Numbered list items
    if (trimmed.match(/^\d+\.\s/m)) {
      const items = trimmed.split(/\n/).filter((l) => l.match(/^\d+\.\s/));
      for (const item of items) {
        blocks.push({
          _type: "block",
          _key: randomKey(),
          style: "normal",
          listItem: "number",
          level: 1,
          children: [
            {
              _type: "span",
              _key: randomKey(),
              text: item.replace(/^\d+\.\s+/, ""),
              marks: [],
            },
          ],
          markDefs: [],
        });
      }
      continue;
    }

    // Regular paragraph
    const children = parseInlineMarks(trimmed.replace(/\n/g, " "));
    blocks.push({
      _type: "block",
      _key: randomKey(),
      style: "normal",
      children,
      markDefs: [],
    });
  }

  return blocks;
}

/** Parse bold/italic inline marks from text. */
function parseInlineMarks(text) {
  const spans = [];
  // Simple approach: split on bold markers, then handle remaining text
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      spans.push({
        _type: "span",
        _key: randomKey(),
        text: boldMatch[1],
        marks: ["strong"],
      });
    } else if (part) {
      spans.push({
        _type: "span",
        _key: randomKey(),
        text: part,
        marks: [],
      });
    }
  }
  return spans.length > 0
    ? spans
    : [{ _type: "span", _key: randomKey(), text: "", marks: [] }];
}

function randomKey() {
  return Math.random().toString(36).slice(2, 10);
}

function extractExcerpt(content) {
  const lines = content
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("!["));
  const first = lines.slice(0, 2).join(" ");
  return first.length > 280 ? first.slice(0, 277) + "..." : first;
}

async function main() {
  const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md"));
  console.log(`Found ${files.length} articles to migrate.`);

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
    const { meta, content } = parseFrontmatter(raw);
    const slug = meta.slug || toSlug(file);

    // Check if already exists
    const existing = await client.fetch(
      `*[_type == "blogPost" && slug.current == $slug][0]._id`,
      { slug },
    );
    if (existing) {
      console.log(`  SKIP ${slug} (already exists: ${existing})`);
      skipped++;
      continue;
    }

    const publishedAt = meta.date
      ? new Date(meta.date).toISOString()
      : new Date("2026-04-01").toISOString();

    const doc = {
      _type: "blogPost",
      title: meta.title || file.replace(/\.md$/, ""),
      slug: { _type: "slug", current: slug },
      author: meta.author || "AutoFlow",
      publishedAt,
      excerpt:
        meta.description ||
        meta.meta_description ||
        extractExcerpt(content),
      body: markdownToPortableText(content),
    };

    try {
      const result = await client.create(doc);
      console.log(`  OK   ${slug} -> ${result._id}`);
      created++;
    } catch (err) {
      console.error(`  FAIL ${slug}: ${err.message}`);
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
