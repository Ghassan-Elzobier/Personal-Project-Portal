"use client";

import PageError from "./error";
import "./globals.css";

// When the root layout itself fails, this replaces it, so it brings its own
// document and styles. It shows (and reports) the same thing as any page error.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <title>Portal</title>
        <main id="main" className="mx-auto max-w-6xl c-space pt-8">
          <PageError error={error} reset={retry} />
        </main>
      </body>
    </html>
  );
}
