"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/Button";

// Shown inside the app (the menu stays) when a page crashes while drawing. "Try again" draws the page again.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const ref = error instanceof Error && "digest" in error ? String((error as { digest?: string }).digest ?? "") : "";

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center" role="alert">
      <h1 className="font-display text-3xl">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        This page stopped working. Your saved work is safe. Try again, or go back to the dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className={buttonClass("primary", "md")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary", "md")}>
          Back to dashboard
        </Link>
      </div>
      <p className="mt-6 text-xs text-muted">
        Keeps happening?{" "}
        <Link href="/help" className="text-wine hover:underline">
          Report a problem
        </Link>
        {ref && <> and mention code {ref}</>}.
      </p>
    </div>
  );
}
