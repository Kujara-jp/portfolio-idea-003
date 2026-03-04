import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "K.F | 業務改善・社内DX向けポートフォリオ",
  description: "製造業出身。現場課題を整理し、仕組みと運用で改善につなげる制作実績。社内SE・DX推進向けポートフォリオ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased`}
      >
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <Link href="/" className="font-semibold tracking-tight text-slate-900">
              K.F
            </Link>
            <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                ホーム
              </Link>
              <Link href="/projects" className="hover:text-slate-900">
                作品一覧
              </Link>
              <Link href="/about" className="hover:text-slate-900">
                自己紹介
              </Link>
              <Link href="/contact" className="hover:text-slate-900">
                お問い合わせ
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-slate-500 sm:px-6">
            © 2026 K.F
          </div>
        </footer>
      </body>
    </html>
  );
}
