import type { Metadata } from "next";
import "./globals.css";

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
  <html lang="sv">
      <body className="antialiased">{children}</body>
    </html>
  );
}
