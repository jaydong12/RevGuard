import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import RootShell from "../components/RootShell";

export const dynamic = "force-dynamic";

console.log("🔥 DEPLOY CHECK:", new Date().toISOString());

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RevGuard",
  description: "RevGuard — AI-powered accounting and cashflow clarity.",
  icons: {
    icon: "/icon.png?v=2",
    shortcut: "/favicon.ico?v=2",
    apple: "/icon.png?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
