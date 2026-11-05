import type { Metadata, Viewport } from "next";
import { Funnel_Display } from "next/font/google";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/toaster";
import "./globals.css";

// Served from the portal itself, so no request ever goes to Google for it.
const funnel = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Portal", template: "%s · Portal" },
  description: "Study and rendering progress.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#030412", colorScheme: "dark", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={funnel.variable}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="c-space mx-auto max-w-6xl pt-8 pb-28 md:pb-24">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
