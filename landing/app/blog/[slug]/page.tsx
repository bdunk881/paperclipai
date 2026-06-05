import { PortableText } from "@portabletext/react";
import type { MetaDescriptor, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import sanitizeHtml from "sanitize-html";
import { getBlogPost, urlFor } from "@/lib/sanity";
import { getArticle } from "@/lib/articles";
import { SITE_URL, blogPostingLd, breadcrumbLd, faqPageLd } from "@/lib/structuredData";

interface LoaderData {
  article: ReturnType<typeof getArticle>;
  cmsPost: Awaited<ReturnType<typeof getBlogPost>>;
  canonical: string;
  ogImageUrl: string;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Blog Post | AutoFlow" }];
  const { cmsPost, article, canonical, ogImageUrl } = data;
  const title =
    cmsPost?.seo?.metaTitle ?? cmsPost?.title ?? article?.title ?? "Blog Post";
  const description =
    cmsPost?.seo?.metaDescription ?? cmsPost?.excerpt ?? article?.excerpt ?? "";

  const tags: MetaDescriptor[] = [
    { title: `${title} | AutoFlow Blog` },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImageUrl },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },
  ];

  if (cmsPost?.seo?.noIndex) {
    tags.push({ name: "robots", content: "noindex,nofollow" });
  }

  if (cmsPost) {
    const graph: Record<string, unknown>[] = [
      blogPostingLd(cmsPost, { url: canonical, imageUrl: ogImageUrl }),
      breadcrumbLd(cmsPost, { url: canonical }),
    ];
    const faq = faqPageLd(cmsPost);
    if (faq) graph.push(faq);
    tags.push({ "script:ld+json": graph });
  }

  return tags;
};

export async function loader({ params }: { params: { slug?: string } }) {
  const slug = params.slug;
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const cmsPost = await getBlogPost(slug);
  const article = cmsPost ? null : getArticle(slug);

  if (!cmsPost && !article) {
    throw new Response("Not Found", { status: 404 });
  }

  const canonical = cmsPost?.seo?.canonicalUrl ?? `${SITE_URL}/blog/${slug}`;
  const ogImageUrl = cmsPost?.seo?.ogImage
    ? urlFor(cmsPost.seo.ogImage).width(1200).height(630).fit("crop").url()
    : `${SITE_URL}/og.svg`;

  return { cmsPost, article, canonical, ogImageUrl };
}

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset: unknown; alt?: string; caption?: string } }) => {
      const url = urlFor(value).width(800).url();
      const caption = value.caption ?? value.alt;
      return (
        <figure className="my-8">
          <img
            src={url}
            alt={value.alt ?? ""}
            width={800}
            height={450}
            className="rounded-lg"
          />
          {caption && (
            <figcaption className="mt-2 text-center text-sm text-gray-500">
              {caption}
            </figcaption>
          )}
        </figure>
      );
    },
  },
  block: {
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-2xl font-bold mt-10 mb-4">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-xl font-semibold mt-8 mb-3">{children}</h3>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p className="mt-4 leading-7 text-gray-700">{children}</p>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-indigo-300 pl-4 my-6 italic text-gray-600">
        {children}
      </blockquote>
    ),
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em>{children}</em>
    ),
    link: ({
      children,
      value,
    }: {
      children?: React.ReactNode;
      value?: {
        linkType?: string;
        href?: string;
        openInNewTab?: boolean;
        reference?: { slug?: string } | null;
      };
    }) => {
      const v = value ?? {};
      const className =
        "text-indigo-600 underline underline-offset-2 hover:text-indigo-700";
      if (v.linkType === "internal" && v.reference?.slug) {
        return (
          <Link to={`/blog/${v.reference.slug}`} className={className}>
            {children}
          </Link>
        );
      }
      return (
        <a
          href={v.href ?? "#"}
          {...(v.openInNewTab
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className={className}
        >
          {children}
        </a>
      );
    },
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc ml-6 mt-4 space-y-2">{children}</ul>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal ml-6 mt-4 space-y-2">{children}</ol>
    ),
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-gray-700">{children}</li>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-gray-700">{children}</li>
    ),
  },
};

export default function BlogPostPage() {
  const { cmsPost, article } = useLoaderData() as LoaderData;

  const title = cmsPost?.title ?? article!.title;
  const author = cmsPost?.author?.name ?? article!.author;
  const publishedAt = cmsPost?.publishedAt ?? article!.publishedAt;

  return (
    <main className="mx-auto max-w-3xl px-6 py-24 lg:px-8">
      <Link
        to="/blog"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
      >
        &larr; Back to Blog
      </Link>

      <article className="mt-8">
        <time dateTime={publishedAt} className="text-sm text-gray-500">
          {new Date(publishedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-gray-500">By {author}</p>

        {cmsPost?.coverImage && (
          <img
            src={urlFor(cmsPost.coverImage).width(1200).height(630).fit("crop").url()}
            alt={(cmsPost.coverImage as { alt?: string }).alt ?? title}
            width={1200}
            height={630}
            className="mt-8 w-full rounded-2xl object-cover"
          />
        )}

        {cmsPost?.body && (
          <div className="mt-10 max-w-none">
            {/* @ts-expect-error -- PortableText component types are loosely typed */}
            <PortableText value={cmsPost.body} components={portableTextComponents} />
          </div>
        )}

        {article && (
          <div className="prose prose-gray prose-lg mt-10 max-w-none">
            <MarkdownRenderer content={article.content} />
          </div>
        )}
      </article>
    </main>
  );
}

/**
 * HEL-257 / SEC-06 — sanitization allowlist for the regex-built local-
 * article HTML. Only the tags the MarkdownRenderer emits are permitted;
 * `class` is the only allowed attribute (the renderer attaches Tailwind
 * utility classes for typography). Anything outside this list (img,
 * script, event handlers, data: URLs, etc.) gets stripped.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h2", "h3", "strong", "em", "li", "br"],
  allowedAttributes: { "*": ["class"] },
};

/** Minimal markdown-to-HTML renderer for the local article fallback. */
function MarkdownRenderer({ content }: { content: string }) {
  const html = content
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-semibold mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-bold mt-10 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h2 class="text-2xl font-bold mt-10 mb-4">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-4">')
    .replace(/\n/g, "<br/>");

  // HEL-257 / SEC-06 — sanitize before injection so any inline script /
  // event-handler attribute / disallowed tag (e.g. `<img onerror=…>`) is
  // stripped instead of executing in the reader's browser.
  const safeHtml = sanitizeHtml(`<p class="mt-4">${html}</p>`, SANITIZE_OPTIONS);

  return (
    <div
      className="[&>p]:mt-4 [&>h2]:text-2xl [&>h2]:font-bold [&>h3]:text-xl [&>h3]:font-semibold"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
