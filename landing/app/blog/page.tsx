import type { Metadata } from "next";
import Link from "next/link";
import { getBlogPosts } from "@/lib/sanity";
import { getAllArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Blog | AutoFlow",
  description:
    "Guides, comparisons, and tutorials on workflow automation, AI agents, and building autonomous businesses with AutoFlow.",
};

interface BlogItem {
  title: string;
  slug: string;
  author: string;
  publishedAt: string;
  excerpt: string;
}

export default async function BlogPage() {
  const cmsPosts = await getBlogPosts();
  const posts: BlogItem[] =
    cmsPosts && cmsPosts.length > 0
      ? cmsPosts
      : getAllArticles();

  return (
    <main className="mx-auto max-w-4xl px-6 py-24 lg:px-8">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">Blog</h1>
      <p className="mt-4 text-lg text-gray-600">
        Guides, comparisons, and tutorials on workflow automation and AI agents.
      </p>

      <div className="mt-12 space-y-10">
        {posts.map((post) => (
          <article
            key={post.slug}
            className="group rounded-2xl border border-gray-200 p-6 transition-shadow hover:shadow-md"
          >
            <Link href={`/blog/${post.slug}`} className="block">
              <time
                dateTime={post.publishedAt}
                className="text-sm text-gray-500"
              >
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              <h2 className="mt-2 text-xl font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {post.title}
              </h2>
              <p className="mt-2 text-gray-600 line-clamp-2">{post.excerpt}</p>
              <p className="mt-3 text-sm font-medium text-indigo-600">
                Read more &rarr;
              </p>
            </Link>
          </article>
        ))}

        {posts.length === 0 && (
          <p className="text-gray-500">No posts yet. Check back soon!</p>
        )}
      </div>
    </main>
  );
}
