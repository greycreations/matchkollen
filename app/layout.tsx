import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import { AppTheme } from "@/components/theme";

export const metadata: Metadata = {
  title: "Matchkollen – matchräknare för lag",
  description: "Planera matcher och håll koll på mål, perioder och målskyttar i fotboll och innebandy.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
  <html lang="sv" suppressHydrationWarning>
      <body className="antialiased"><AppTheme>{children}</AppTheme></body>
    </html>
  );
}
