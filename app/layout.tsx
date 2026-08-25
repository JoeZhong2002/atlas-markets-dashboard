import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "Atlas Markets · 科技投资晨报",
    description: "每天北京时间 9:00 更新的美股科技投资看板。",
    openGraph: {
      title: "Atlas Markets · 科技投资晨报",
      description: "美股科技、自选股、宏观与加密市场的晨间研究看板。",
      images: [{ url: `${origin}/og.png`, width: 720, height: 378, alt: "Atlas Markets 科技投资晨报" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Atlas Markets · 科技投资晨报",
      description: "72 小时来源校验的科技投资晨报。",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
