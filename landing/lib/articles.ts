import fs from "fs";
import path from "path";

export interface ArticleMeta {
  title: string;
  slug: string;
  author: string;
  publishedAt: string;
  excerpt: string;
}

export interface Article extends ArticleMeta {
  content: string;
}

const ARTICLES_DIR = path.join(process.cwd(), "..", "content", "articles");

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, content: match[2].trim() };
}

function toSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}

function extractExcerpt(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("!["));
  const first = lines.slice(0, 2).join(" ");
  return first.length > 200 ? first.slice(0, 197) + "..." : first;
}

export function getAllArticles(): ArticleMeta[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md"));
  return files
    .map((file) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
      const { meta, content } = parseFrontmatter(raw);
      return {
        title: meta.title ?? file.replace(/\.md$/, ""),
        slug: meta.slug ?? toSlug(file),
        author: meta.author ?? "AutoFlow",
        publishedAt: meta.date ?? "2026-04-01",
        excerpt: meta.description ?? meta.meta_description ?? extractExcerpt(content),
      };
    })
    .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1));
}

export function getArticle(slug: string): Article | null {
  if (!fs.existsSync(ARTICLES_DIR)) return null;
  const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf-8");
    const { meta, content } = parseFrontmatter(raw);
    const fileSlug = meta.slug ?? toSlug(file);
    if (fileSlug === slug) {
      return {
        title: meta.title ?? file.replace(/\.md$/, ""),
        slug: fileSlug,
        author: meta.author ?? "AutoFlow",
        publishedAt: meta.date ?? "2026-04-01",
        excerpt: meta.description ?? meta.meta_description ?? extractExcerpt(content),
        content,
      };
    }
  }
  return null;
}
