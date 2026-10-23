"use client";

import { useEffect, useState } from "react";
import type { GenerationJob, MaterialsOutput } from "@/lib/types";

const GROUPS: { key: MaterialsOutput["items"][number]["category"]; label: string }[] = [
  { key: "tool", label: "Tools" },
  { key: "material", label: "Materials" },
  { key: "notion", label: "Notions & closures" },
  { key: "embellishment", label: "Embellishment" },
];

// Ticks are remembered in this browser only, per checklist (one checklist = one design version).
const storageKey = (jobId: string) => `croquis:materials-ticks:${jobId}`;

function loadTicks(jobId: string): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(jobId)) ?? "{}");
  } catch {
    return {};
  }
}

export function MaterialsView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as MaterialsOutput;
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // Read saved ticks after the first render, so server and browser render the same HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading browser-only storage once
    setTicked(loadTicks(job.id));
  }, [job.id]);

  function toggle(item: string, value: boolean) {
    setTicked((t) => {
      const next = { ...t, [item]: value };
      try {
        window.localStorage.setItem(storageKey(job.id), JSON.stringify(next));
      } catch {
        /* storage blocked (private window): ticks just are not remembered */
      }
      return next;
    });
  }

  const done = out.items.filter((i) => ticked[i.item]).length;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2 text-xs">
        <span>
          Checklist for <span className="font-medium">design v{job.version_number}</span>
          {out.based_on && out.based_on.length > 0 && <span className="text-muted"> · made from {out.based_on.join(" · ")}</span>}
        </span>
        <span className="text-muted">
          {done}/{out.items.length} ready
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUPS.map((g) => {
          const items = out.items.filter((i) => i.category === g.key);
          if (items.length === 0) return null;
          return (
            <fieldset key={g.key}>
              <legend className="text-xs font-medium uppercase tracking-wide text-muted">{g.label}</legend>
              <ul className="mt-1.5 space-y-1.5">
                {items.map((i) => (
                  <li key={i.item}>
                    <label className="flex cursor-pointer gap-2">
                      <input type="checkbox" className="mt-0.5 accent-wine" checked={!!ticked[i.item]} onChange={(e) => toggle(i.item, e.target.checked)} />
                      <span>
                        <span className={ticked[i.item] ? "text-muted line-through" : ""}>{i.item}</span>
                        {i.optional && <span className="ml-1 text-xs text-faint">(optional)</span>}
                        <span className="block text-xs text-muted">{i.reason}</span>
                        {(i.linked_to || i.quantity_hint) && (
                          <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]">
                            {i.linked_to && <span className="text-wine">↳ {i.linked_to}</span>}
                            {i.quantity_hint && <span className="text-faint">Qty: {i.quantity_hint}</span>}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
