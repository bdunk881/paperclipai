import type { Metadata } from "next";
import "./globals.css";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: {
    default: "AutoFlow Docs",
    template: "%s — AutoFlow Docs",
  },
  description: "Documentation for AutoFlow — the AI workflow automation platform.",
  openGraph: {
    type: "website",
    siteName: "AutoFlow Docs",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased text-gray-900 bg-white">
        <DocsLayout>{children}</DocsLayout>
      </body>
    </html>
  );
}
