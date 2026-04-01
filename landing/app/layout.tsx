import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
      <body className={`${inter.className} antialiased`}>
        <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-100">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 flex h-16 items-center justify-between">
            <a href="/" className="text-xl font-bold text-indigo-600">
              AutoFlow
            </a>
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
              <a
                href="/demo"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Demo
              </a>
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
            <p className="font-bold text-white text-lg">AutoFlow</p>
            <div className="flex gap-6">
              <a href="/demo" className="hover:text-white transition-colors">
                Demo
              </a>
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
