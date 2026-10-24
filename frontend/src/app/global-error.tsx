"use client";

import { useEffect } from "react";
import "./globals.css";

// Shown only when the whole app frame fails. It replaces the root layout, so it brings its own <html> and
// <body>; the colours follow the device's light / dark setting.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-paper text-ink">
        <title>Something went wrong · Drapeit</title>
        <main className="mx-auto max-w-xl px-4 py-24 text-center" role="alert">
          <p className="font-display text-2xl italic text-wine">Drapeit</p>
          <h1 className="mt-6 font-display text-3xl">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">The app could not start this time. Your saved work is safe.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="rounded-full border border-wine bg-wine px-5 py-2 text-sm font-medium text-on-wine hover:bg-wine-dark"
            >
              Try again
            </button>
            {/* A full page load, not a client-side link: the app frame itself is what failed. */}
            <button
              type="button"
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the app frame failed; start it fresh
              onClick={() => window.location.assign("/")}
              className="rounded-full border border-line-strong bg-surface px-5 py-2 text-sm font-medium hover:bg-sunken"
            >
              Back to dashboard
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
