"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { DesignVariation, GenerationJob, VariationsOutput } from "@/lib/types";
import { applyVariation, variationChanges } from "@/lib/variations";

const KIND_LABEL: Record<DesignVariation["kind"], string> = {
  neckline: "Neckline",
  sleeves: "Sleeves",
  silhouette: "Silhouette",
  embellishment: "Embellishment",
  colour: "Colour",
};

const isHex = (h: string) => /^#[0-9a-f]{3,8}$/i.test(h);

export function VariationsView({ job }: { job: GenerationJob }) {
  const { detail, saveSpec } = useProject();
  const out = job.output as unknown as VariationsOutput;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!detail) return null;
  const spec = detail.current_spec;

  async function tryIt(v: DesignVariation) {
    setBusy(v.name);
    setMessage(null);
    try {
      await saveSpec(applyVariation(v, spec), `Variation: ${v.name}`.slice(0, 200));
      setMessage({ ok: true, text: `Saved “${v.name}” as v${detail!.project.current_version + 1}. Outputs that depend on it are now marked out of date. Restore the old version from History any time.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="@container space-y-3 text-sm">
      <p className="text-muted">{out.base_summary}</p>
      {message && (
        <p role="status" className={`rounded-md px-3 py-2 text-xs ${message.ok ? "bg-ok-soft text-ok" : "bg-err-soft text-err"}`}>
          {message.text}
        </p>
      )}
      <ul className="grid gap-3 @lg:grid-cols-2">
        {out.variations.map((v) => {
          const changes = variationChanges(v, spec);
          const already = changes.length > 0 && changes.every(([, from, to]) => from.toLowerCase() === to.toLowerCase());
          return (
            <li key={`${v.kind}-${v.name}`} className="flex flex-col rounded-lg border border-line bg-paper p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{v.name}</p>
                <Badge>{KIND_LABEL[v.kind]}</Badge>
              </div>
              <p className="mt-1 text-xs">{v.description}</p>
              <p className="mt-1 text-xs text-muted">{v.why}</p>
              {v.colour_hex.length > 0 && (
                <div className="mt-2 flex gap-1" aria-label={`Colours: ${v.colour_palette.join(", ")}`}>
                  {v.colour_hex.map((h, i) => (
                    <span key={h + i} title={v.colour_palette[i]} className="h-6 flex-1 rounded border border-ink/10" style={{ backgroundColor: isHex(h) ? h : "var(--color-line-strong)" }} />
                  ))}
                </div>
              )}
              {changes.length > 0 && (
                <dl className="mt-2 space-y-0.5 text-xs">
                  {changes.map(([label, from, to]) => (
                    <div key={label} className="flex flex-wrap gap-x-1">
                      <dt className="text-muted">{label}:</dt>
                      <dd>
                        <span className="text-faint line-through">{from || "not set"}</span> → <span className="font-medium">{to}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-auto pt-3">
                <Button size="sm" className="w-full" onClick={() => tryIt(v)} loading={busy === v.name} disabled={already || (busy !== null && busy !== v.name)}>
                  {already ? "Already in the design" : "Try this (save as new version)"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
