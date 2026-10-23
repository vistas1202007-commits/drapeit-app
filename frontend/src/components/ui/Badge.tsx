import type { ReactNode } from "react";

type Tone = "neutral" | "wine" | "gold" | "ok" | "warn" | "err";

const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-muted border-line",
  gold: "bg-gold-soft text-gold-ink border-gold/40",
  wine: "bg-wine-soft text-wine border-wine/20",
  ok: "bg-ok-soft text-ok border-ok/20",
  warn: "bg-warn-soft text-warn border-warn/25",
  err: "bg-err-soft text-err border-err/20",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Shown on anything produced by a mock (fake) provider, so it is never mistaken for real AI. */
export function MockBadge() {
  return (
    <Badge tone="warn" title="Made by a mock provider for testing. Not real AI output.">
      Mock
    </Badge>
  );
}

/** Says who made an output: a mock, plain code ("No AI"), or a real AI provider. */
export function ProviderBadge({ isMock, provider }: { isMock: boolean; provider: string | null }) {
  if (isMock) return <MockBadge />;
  if (!provider || provider === "built-in") return <Badge>No AI</Badge>;
  return (
    <Badge tone="ok" title={`Real AI: ${provider}. Each use costs a little money.`}>
      AI
    </Badge>
  );
}
