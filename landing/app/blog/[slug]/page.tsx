import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogPost } from "@/lib/sanity";
import { getArticle, getAllArticles } from "@/lib/articles";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const cmsPost = await getBlogPost(slug);
  const article = cmsPost ? null : getArticle(slug);
  const title = cmsPost?.title ?? article?.title ?? "Blog Post";
  const description = cmsPost?.excerpt ?? article?.excerpt ?? "";
  return {
    title: `${title} | AutoFlow Blog`,
    description,
  };
}

export async function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const cmsPost = await getBlogPost(slug);
  const article = cmsPost ? null : getArticle(slug);

  if (!cmsPost && !article) notFound();

  const title = cmsPost?.title ?? article!.title;
  const author = cmsPost?.author ?? article!.author;
  const publishedAt = cmsPost?.publishedAt ?? article!.publishedAt;

  return (
    <main className="mx-auto max-w-3xl px-6 py-24 lg:px-8">
      <Link
        href="/blog"
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

        {/* CMS portable text rendering will go here once Sanity is live */}
        {article && (
          <div className="prose prose-gray prose-lg mt-10 max-w-none">
            <MarkdownRenderer content={article.content} />
          </div>
        )}

        {cmsPost && (
          <div className="prose prose-gray prose-lg mt-10 max-w-none">
            <p className="text-gray-500 italic">
              This post is managed via Sanity CMS. Portable Text rendering will
              be enabled once the Sanity project is configured.
            </p>
          </div>
        )}
      </article>
    </main>
  );
}

/** Minimal markdown-to-HTML renderer for the local article fallback. */
function MarkdownRenderer({ content }: { content: string }) {
  const html = content
    // headings
    .replace(/^### (.+)$/gm, '<h3 class="text-xl font-semibold mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-2xl font-bold mt-10 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h2 class="text-2xl font-bold mt-10 mb-4">$1</h2>')
    // bold & italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="mt-4">')
    // single newlines inside paragraphs
    .replace(/\n/g, "<br/>");

  return (
    <div
      className="[&>p]:mt-4 [&>h2]:text-2xl [&>h2]:font-bold [&>h3]:text-xl [&>h3]:font-semibold"
      dangerouslySetInnerHTML={{ __html: `<p class="mt-4">${html}</p>` }}
    />
  );
}
