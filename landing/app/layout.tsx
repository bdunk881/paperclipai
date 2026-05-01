import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// TODO: Update with CMO-approved SEO copy from ALT-93
export const metadata: Metadata = {
  title: "AutoFlow — Hire AI. Deploy Fast. Earn More.",
  description:
    "AutoFlow lets you spin up fully autonomous AI businesses in minutes — complete with agents, workflows, and revenue infrastructure.",
  openGraph: {
    title: "AutoFlow — Hire AI. Deploy Fast. Earn More.",
    description:
      "AutoFlow lets you spin up fully autonomous AI businesses in minutes.",
    type: "website",
    siteName: "AutoFlow",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoFlow — Hire AI. Deploy Fast. Earn More.",
    description:
      "AutoFlow lets you spin up fully autonomous AI businesses in minutes.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
          />
        )}
      </head>
      <body className={`${inter.className} antialiased`}>
        <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-100">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <svg width="400" height="100" viewBox="0 0 400 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-auto">
                <g transform="translate(10, 10) scale(0.8)">
                  <path d="M50 15L85 85H70L50 45L30 85H15L50 15Z" fill="#6366f1" />
                  <circle cx="50" cy="45" r="8" fill="#14b8a6" />
                  <path d="M50 45V15" stroke="#14b8a6" stroke-width="4" stroke-linecap="round" />
                </g>
                <text x="100" y="65" font-family="Inter, sans-serif" font-weight="900" font-size="48" fill="currentColor" className="text-gray-900">
                  Auto<tspan fill="#6366f1">Flow</tspan>
                </text>
              </svg>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <a
                href="#how-it-works"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                How it works
              </a>
              <a
                href="#features"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Features
              </a>
              <a
                href="#pricing"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Pricing
              </a>
              <Link
                href="/blog"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Blog
              </Link>
              <Link
                href="/demo"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Demo
              </Link>
              <a
                href="https://docs.autoflow.app"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Docs
              </a>
              <a
                href="#pricing"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                Start free
              </a>
            </div>
          </div>
        </nav>
        {children}
        <footer className="bg-gray-900 text-gray-400 py-12">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <svg width="400" height="100" viewBox="0 0 400 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-auto">
                <g transform="translate(10, 10) scale(0.8)">
                  <path d="M50 15L85 85H70L50 45L30 85H15L50 15Z" fill="#6366f1" />
                  <circle cx="50" cy="45" r="8" fill="#14b8a6" />
                  <path d="M50 45V15" stroke="#14b8a6" stroke-width="4" stroke-linecap="round" />
                </g>
                <text x="100" y="65" font-family="Inter, sans-serif" font-weight="900" font-size="48" fill="white">
                  Auto<tspan fill="#6366f1">Flow</tspan>
                </text>
              </svg>
            </div>
            <div className="flex gap-6">
              <Link href="/blog" className="hover:text-white transition-colors">
                Blog
              </Link>
              <Link href="/demo" className="hover:text-white transition-colors">
                Demo
              </Link>
              <a href="https://docs.autoflow.app" className="hover:text-white transition-colors">
                Docs
              </a>
              <a href="https://github.com/autoflow-hq/autoflow" className="hover:text-white transition-colors">
                GitHub
              </a>
              <a href="/privacy" className="hover:text-white transition-colors">
                Privacy
              </a>
              <a href="/terms" className="hover:text-white transition-colors">
                Terms
              </a>
              <a href="mailto:hello@autoflow.app" className="hover:text-white transition-colors">
                Contact
              </a>
            </div>
            <p>© {new Date().getFullYear()} AutoFlow. All rights reserved.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
