"use client";

import { useState } from "react";
import { JobMeta } from "@/components/outputs/OutputCard";
import { Swatch } from "@/components/outputs/Swatch";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass } from "@/components/ui/fields";
import type { DesignConceptOutput, FabricOutput, FabricRecommendation, Level, Suggestion } from "@/lib/types";
import { useProject } from "./ProjectContext";

const LEVEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, delicate: 0, moderate: 1, easy: 2 };

const SORTS: { id: string; label: string; key: (r: FabricRecommendation) => number }[] = [
  { id: "match", label: "Best match", key: (r) => r.score },
  { id: "comfort", label: "Most comfortable", key: (r) => RANK[r.comfort ?? "medium"] },
  { id: "care", label: "Easiest care", key: (r) => RANK[r.maintenance ?? "moderate"] },
  { id: "breathable", label: "Most breathable", key: (r) => RANK[r.breathability] },
  { id: "drape", label: "Most drape", key: (r) => RANK[r.drape] },
];

/** Three small bars, filled to show low / medium / high. */
function Meter({ level }: { level: Level }) {
  const filled = RANK[level] + 1;
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-1.5 w-3 rounded-sm ${i < filled ? "bg-wine" : "bg-line"}`} />
      ))}
    </span>
  );
}

function Factor({ label, level, text, title }: { label: string; level?: Level | null; text?: string; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5">
        {level && <Meter level={level} />}
        <span>{text ?? (level ? LEVEL[level] : "—")}</span>
      </dd>
    </div>
  );
}

function SuggestionList({ title, items }: { title: string; items: Suggestion[] }) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.name}>
            <p className="font-medium">{i.name}</p>
            {i.reason && <p className="text-xs text-muted">{i.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FabricStudio() {
  const { detail, latestJob, runGenerator, running, requestErrors, saveSpec, retryJob } = useProject();
  const [savingName, setSavingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState("match");
  if (!detail) return null;
  const job = latestJob("fabric");
  const out = job?.status === "succeeded" ? (job.output as unknown as FabricOutput) : null;
  const preferred = detail.current_spec.preferred_fabrics;
  const isPreferred = (name: string) => preferred.some((p) => p.toLowerCase() === name.toLowerCase());
  const design = latestJob("design");
  const palette = design?.status === "succeeded" ? ((design.output as unknown as DesignConceptOutput).plan?.colour_story ?? []) : [];
  const sortKey = SORTS.find((s) => s.id === sort)?.key ?? SORTS[0].key;
  const recs = out ? [...out.recommendations].sort((a, b) => sortKey(b) - sortKey(a) || b.score - a.score) : [];
  const liningOptions: Suggestion[] = out?.lining_options?.length ? out.lining_options : (out?.lining ?? []).map((name) => ({ name, reason: "" }));

  async function togglePreferred(name: string) {
    setSavingName(name);
    setError(null);
    const next = isPreferred(name) ? preferred.filter((p) => p.toLowerCase() !== name.toLowerCase()) : [...preferred, name];
    try {
      await saveSpec({ ...detail!.current_spec, preferred_fabrics: next }, isPreferred(name) ? `Removed fabric: ${name}` : `Saved fabric: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingName(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Fabric Studio</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Suggestions weigh climate, occasion, budget, comfort, drape, care and your skill level. Saving a fabric adds it to the design spec (as a new version).
          </p>
        </div>
        <Button variant="primary" onClick={() => runGenerator("fabric")} loading={running.fabric}>
          <Icon name="sparkle" /> {out ? (job?.stale ? "Update recommendations" : "Regenerate") : "Recommend fabrics"}
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface shadow-card p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Saved to this design</p>
        {preferred.length === 0 ? (
          <p className="mt-1 text-sm text-faint">No favourites yet. Press “Save to design” on a fabric you like.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {preferred.map((p) => {
              const rec = out?.recommendations.find((r) => r.name.toLowerCase() === p.toLowerCase());
              return (
                <li key={p} className="flex items-center gap-2 rounded-full border border-line bg-paper py-1 pl-1 pr-3 text-sm">
                  {rec ? <Swatch colour={rec.swatch_colour} texture={rec.texture} className="h-6 w-6 rounded-full" /> : <span className="h-6 w-6 rounded-full bg-sunken" />}
                  {p}
                  <button type="button" aria-label={`Remove ${p}`} className="text-faint hover:text-err" onClick={() => togglePreferred(p)} disabled={savingName === p}>
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {requestErrors.fabric && <Notice tone="err" title="Request failed">{requestErrors.fabric}</Notice>}
        {error && <Notice tone="err" title="Could not save">{error}</Notice>}
        {running.fabric && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Finding fabrics…
          </p>
        )}
        {job?.status === "failed" && (
          <Notice tone="err" title="Fabric recommendation failed" action={<Button size="sm" onClick={() => retryJob(job)}>Retry</Button>}>
            {job.error}
          </Notice>
        )}
        {!job && !running.fabric && (
          <EmptyState title="No fabric suggestions yet">Make sure the design spec has a garment type, then press Recommend fabrics.</EmptyState>
        )}
        {out && job && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <JobMeta job={job} />
              <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
                Sort by
                <select className={`${inputClass} w-auto py-1 text-xs`} value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {job.stale && <p className="text-xs text-wine">The design changed since these were made ({job.stale_fields.join(", ").replaceAll("_", " ")}).</p>}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recs.map((r) => (
                <li key={r.name} className="flex flex-col rounded-lg border border-line bg-surface shadow-card p-4">
                  <Swatch colour={r.swatch_colour} texture={r.texture} className="h-24 w-full" />
                  {palette.length > 1 && (
                    <div className="mt-1.5 flex items-center gap-1" title="This fabric's texture in each colour of your design">
                      {palette.slice(0, 5).map((c) => (
                        <Swatch key={c.hex + c.name} colour={c.hex} texture={r.texture} className="h-5 flex-1" />
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg leading-tight">{r.name}</h3>
                    <span className="shrink-0 text-xs text-muted">{r.score}/100</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.lining_needed && <Badge>Needs lining</Badge>}
                    {isPreferred(r.name) && <Badge tone="wine">Saved</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{r.suitability}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2.5 text-xs">
                    <Factor label="Comfort" level={r.comfort} />
                    <Factor label="Drape" level={r.drape} />
                    <Factor label="Breathable" level={r.breathability} />
                    <Factor label="Care" text={r.maintenance ? r.maintenance[0].toUpperCase() + r.maintenance.slice(1) : "—"} />
                    <Factor label="Weight" text={r.weight ? r.weight[0].toUpperCase() + r.weight.slice(1) : "—"} />
                    <Factor label="Relative cost" level={r.cost_level ?? undefined} title="Compared with the other fabrics here. Not a price." />
                  </dl>
                  {(r.climate_fit || r.occasion_fit || r.budget_note) && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                      {r.climate_fit && (
                        <li>
                          <span className="font-medium">Climate: </span>
                          <span className="text-muted">{r.climate_fit}</span>
                        </li>
                      )}
                      {r.occasion_fit && (
                        <li>
                          <span className="font-medium">Occasion: </span>
                          <span className="text-muted">{r.occasion_fit}</span>
                        </li>
                      )}
                      {r.budget_note && (
                        <li>
                          <span className="font-medium">Budget: </span>
                          <span className="text-muted">{r.budget_note}</span>
                        </li>
                      )}
                    </ul>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-ok">Advantages</p>
                      <ul className="mt-0.5 space-y-0.5 text-muted">
                        {r.advantages.map((a) => (
                          <li key={a}>+ {a}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-err">Limitations</p>
                      <ul className="mt-0.5 space-y-0.5 text-muted">
                        {r.limitations.map((a) => (
                          <li key={a}>– {a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    <span className="font-medium text-ink">Care:</span> {r.care}
                  </p>
                  <p className="mt-1 text-xs text-faint">Price: {r.approximate_cost ?? "not shown (no reliable price data). Add your own in Cost Estimate."}</p>
                  <div className="mt-auto pt-4">
                    <Button size="sm" variant={isPreferred(r.name) ? "primary" : "secondary"} className="w-full" onClick={() => togglePreferred(r.name)} loading={savingName === r.name}>
                      {isPreferred(r.name) ? (
                        <>
                          <Icon name="check" className="h-3.5 w-3.5" /> Saved to design
                        </>
                      ) : (
                        "Save to design"
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <SuggestionList title="Lining" items={liningOptions} />
              {out.embellishment_options && out.embellishment_options.length > 0 && <SuggestionList title="Embellishment ideas" items={out.embellishment_options} />}
              {(
                [
                  ["Complementary materials", out.complementary_materials],
                  ["Things to consider", out.considerations],
                ] as const
              ).map(([title, items]) => (
                <section key={title} className="rounded-lg border border-line bg-surface shadow-card p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                    {items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
