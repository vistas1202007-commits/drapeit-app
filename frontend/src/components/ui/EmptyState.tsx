import type { ReactNode } from "react";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-rise rounded-xl border border-dashed border-line-strong bg-surface/70 px-6 py-12 text-center">
      <hr aria-hidden className="stitch-divider mx-auto mb-5 w-24" />
      <p className="font-display text-xl text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
