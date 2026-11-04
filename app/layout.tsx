import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Portal", template: "%s · Portal" },
  description: "Study and rendering progress, from Asana.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="c-space mx-auto max-w-6xl pt-8 pb-24">{children}</main>
      </body>
    </html>
  );
}
