import type { ReactNode } from "react";

type Tone = "info" | "warn" | "err" | "ok";

const TONES: Record<Tone, string> = {
  info: "bg-surface border-line text-ink shadow-card",
  warn: "bg-warn-soft border-warn/25 text-ink",
  err: "bg-err-soft border-err/25 text-ink",
  ok: "bg-ok-soft border-ok/25 text-ink",
};

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === "err" ? "alert" : undefined} className={`flex flex-wrap items-start gap-3 animate-fade rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted mt-0.5">{children}</div>}
      </div>
      {action}
    </div>
  );
}
