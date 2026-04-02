import type { Metadata } from "next";
import { Inter, Poppins, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-poppins",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

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
      <body className={`${inter.variable} ${poppins.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-100">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 flex h-16 items-center justify-between">
            <Link href="/" className="text-xl font-display font-bold text-[var(--color-primary)]">
              AutoFlow
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
              <a
                href="/demo"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Demo
              </a>
              <a
                href="https://docs.helloautoflow.com"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Docs
              </a>
              <a
                href="#pricing"
                className="rounded-lg bg-[var(--color-cta)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-cta-hover)] transition-colors"
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
              <a href="https://docs.helloautoflow.com" className="hover:text-white transition-colors">
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
              <a href="mailto:hello@helloautoflow.com" className="hover:text-white transition-colors">
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
