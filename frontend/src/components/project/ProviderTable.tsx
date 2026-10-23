"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { formatUsd, timeAgo } from "@/lib/format";
import type { ProviderOverview, UsageSummary } from "@/lib/types";

function UsageCard({ usage }: { usage: UsageSummary }) {
  const share = usage.daily_budget_usd > 0 ? Math.min(1, usage.today_usd / usage.daily_budget_usd) : 1;
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card p-5 text-sm">
      <h2 className="font-display text-lg">Spending (estimated)</h2>
      <p className="mt-1 text-muted">
        Worked out from what each AI provider reported. Your provider&apos;s own billing page is the final word.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Today</p>
          <p className="font-display text-xl">{formatUsd(usage.today_usd)}</p>
          <p className="text-xs text-muted">{usage.paid_calls_today} paid calls</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Daily limit</p>
          <p className="font-display text-xl">{formatUsd(usage.daily_budget_usd)}</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Share of today's limit used">
            <div className={`h-full ${share >= 0.9 ? "bg-err" : "bg-wine"}`} style={{ width: `${share * 100}%` }} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">All time</p>
          <p className="font-display text-xl">{formatUsd(usage.total_usd)}</p>
          <p className="text-xs text-muted">{usage.paid_calls_total} paid calls</p>
        </div>
      </div>
      {usage.recent.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 pr-3 font-medium">When</th>
                <th className="py-1.5 pr-3 font-medium">Generator</th>
                <th className="py-1.5 pr-3 font-medium">Provider</th>
                <th className="py-1.5 pr-3 font-medium">Result</th>
                <th className="py-1.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.recent.map((r) => (
                <tr key={r.created_at + r.provider} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 text-muted">{timeAgo(r.created_at)}</td>
                  <td className="py-1.5 pr-3">{r.generator_id?.replaceAll("_", " ") ?? r.service}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.provider}</td>
                  <td className="py-1.5 pr-3">{r.success ? "OK" : <span className="text-err">Failed</span>}</td>
                  <td className="py-1.5">{formatUsd(r.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ProviderTable() {
  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.providers(), api.usage()])
      .then(([o, u]) => {
        setOverview(o);
        setUsage(u);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="mt-6"><Notice tone="err" title="Could not load provider status">{error}</Notice></div>;
  if (!overview || !usage) return <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Spinner /> Loading…</p>;
  return (
    <div className="mt-6 space-y-6">
      {overview.warnings.map((w) => (
        <Notice key={w} tone="warn" title="Check your backend settings">
          {w}
        </Notice>
      ))}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">Service</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Provider</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Note</th>
            </tr>
          </thead>
          <tbody>
            {overview.services.map((r) => (
              <tr key={r.service} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-2.5 align-top">
                  {r.service}
                  <span className="mt-0.5 block font-mono text-xs text-muted sm:hidden">{r.provider}</span>
                  <span className="mt-0.5 block text-xs text-muted md:hidden">{r.note}</span>
                </td>
                <td className="hidden px-4 py-2.5 align-top font-mono text-xs sm:table-cell">{r.provider}</td>
                <td className="whitespace-nowrap px-4 py-2.5 align-top">
                  {!r.configured ? <Badge>Not connected</Badge> : r.is_mock ? <Badge tone="warn">Mock</Badge> : r.provider === "built-in" ? <Badge>Built-in · free</Badge> : <Badge tone="ok">Live{r.paid ? " · paid" : ""}</Badge>}
                </td>
                <td className="hidden px-4 py-2.5 align-top text-muted md:table-cell">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="rounded-lg border border-line bg-surface shadow-card p-5 text-sm">
        <h2 className="font-display text-lg">API keys in backend/.env</h2>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(overview.keys).map(([name, set]) => (
            <li key={name} className="flex items-center gap-2">
              <code className="text-xs">{name}</code>
              {set ? <Badge tone="ok">Set</Badge> : <Badge>Not set</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">The app only shows whether a key is set. The key itself never leaves the backend. After changing .env, restart the backend.</p>
      </section>
      <UsageCard usage={usage} />
    </div>
  );
}
