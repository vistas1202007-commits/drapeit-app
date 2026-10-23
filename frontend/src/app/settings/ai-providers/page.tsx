import type { Metadata } from "next";
import Link from "next/link";
import { ProviderTable } from "@/components/project/ProviderTable";
import { PageHeader } from "@/components/layout/PageHeader";

// Everything here waits for sign-in in the browser (see components/auth/AuthProvider.tsx).
export const instant = false;

export const metadata: Metadata = { title: "AI Providers" };

export default function AiProvidersPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <Link href="/settings" className="text-xs text-muted hover:text-wine">
        &larr; Settings
      </Link>
      <PageHeader
        eyebrow="Settings"
        title="AI providers"
        description="Which service does each job, which API keys are set, and what paid AI has cost so far. Without keys everything runs as a free mock (a stand-in that follows simple rules)."
      />
      <ProviderTable />
      <p className="mt-6 text-sm text-muted">
        Looking for who can see your posts, or blocked accounts? Open{" "}
        <Link href="/settings/privacy" className="text-wine hover:underline">
          Privacy &amp; safety
        </Link>
        .
      </p>
      <div className="mt-6 rounded-lg border border-line bg-surface shadow-card p-5 text-sm">
        <h2 className="font-display text-lg">About API keys and cost</h2>
        <p className="mt-2 text-muted">
          A chat app subscription (such as ChatGPT Plus or a Gemini plan) does not give this app API access. Real AI providers need their own API account and
          billing, and their keys live only in the backend&apos;s <code>.env</code> file, never in the browser or in the code.
        </p>
        <p className="mt-2 text-muted">
          To protect you from surprise bills, paid AI stops for the day once the daily limit is reached (<code>DAILY_BUDGET_USD</code>, default $1). The
          setup steps are in the README under &quot;Turn on real AI&quot;.
        </p>
      </div>
    </div>
  );
}
