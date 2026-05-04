import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AutoFlow — Agent-Native Automation | Operating Layer for SMB Operators and Dev Teams",
  description:
    "AutoFlow is the agent-native automation platform for lean SMB operators and dev teams. BYOLLM, MCP-standard, 22-skill marketplace. Built by Altitude Media.",
  openGraph: {
    title: "AutoFlow — Agent-Native Automation | Operating Layer for SMB Operators and Dev Teams",
    description:
      "AutoFlow is the agent-native automation platform for lean SMB operators and dev teams. BYOLLM, MCP-standard, 22-skill marketplace. Built by Altitude Media.",
    type: "website",
    siteName: "AutoFlow — Agent-Native Automation",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoFlow — Agent-Native Automation | Operating Layer for SMB Operators and Dev Teams",
    description:
      "AutoFlow is the agent-native automation platform for lean SMB operators and dev teams. BYOLLM, MCP-standard, 22-skill marketplace. Built by Altitude Media.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
          />
        )}
        {children}
      </body>
    </html>
  );
}
