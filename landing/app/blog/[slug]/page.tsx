import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PortableText } from "@portabletext/react";
import { getBlogPost, urlFor } from "@/lib/sanity";
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

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset: unknown; alt?: string } }) => {
      const url = urlFor(value).width(800).url();
      return (
        <figure className="my-8">
          <Image
            src={url}
            alt={value.alt ?? ""}
            width={800}
            height={450}
            className="rounded-lg"
          />
          {value.alt && (
            <figcaption className="mt-2 text-center text-sm text-gray-500">
              {value.alt}
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

  return (
    <div
      className="[&>p]:mt-4 [&>h2]:text-2xl [&>h2]:font-bold [&>h3]:text-xl [&>h3]:font-semibold"
      dangerouslySetInnerHTML={{ __html: `<p class="mt-4">${html}</p>` }}
    />
  );
}
