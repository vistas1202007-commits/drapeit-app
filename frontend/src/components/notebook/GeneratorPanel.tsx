"use client";

import { useRef, useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge, ProviderBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { costInputsFromOutput } from "@/lib/cost";
import { SKETCH_STYLES, type CostEstimateOutput, type PackageResult } from "@/lib/types";

export function GeneratorPanel({ sketchStyle, onSketchStyle, ideaDraft }: { sketchStyle: string; onSketchStyle: (s: string) => void; ideaDraft: string }) {
  const { generators, running, runGenerator, latestJob, detail, projectId, refresh } = useProject();
  const available = generators.filter((g) => g.available);
  const planned = generators.filter((g) => !g.available);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pkgRunning, setPkgRunning] = useState(false);
  const [pkgResult, setPkgResult] = useState<PackageResult | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [tutorialLanguage, setTutorialLanguage] = useState("any");
  const [guideLanguage, setGuideLanguage] = useState("any");
  const [indexVideos, setIndexVideos] = useState(false);

  const idea = ideaDraft.trim() || detail?.current_spec.idea || [...(detail?.messages ?? [])].reverse().find((m) => m.role === "user")?.content || "";

  function openPackage() {
    setSelected(Object.fromEntries(available.map((g) => [g.id, g.in_package_by_default])));
    setPkgResult(null);
    setPkgError(null);
    dialogRef.current?.showModal();
  }

  async function runPackage() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;
    setPkgRunning(true);
    setPkgError(null);
    try {
      const res = await api.generatePackage(projectId, ids, { design: { idea }, sketch: { style: sketchStyle }, tutorial: { language: tutorialLanguage }, stitching_guide: { language: guideLanguage }, video: { language: guideLanguage } });
      setPkgResult(res);
      await refresh();
    } catch (e) {
      setPkgError(e instanceof Error ? e.message : "Package failed");
    } finally {
      setPkgRunning(false);
    }
  }

  function scrollTo(id: string) {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(id: string) {
    const lastCost = id === "cost" ? latestJob("cost") : undefined;
    const options =
      id === "sketch"
        ? { style: sketchStyle }
        : id === "design"
          ? { idea }
          : id === "tutorial"
            ? { language: tutorialLanguage }
            : (id === "stitching_guide" || id === "video")
            ? { language: guideLanguage, index_videos: indexVideos }
            : lastCost?.status === "succeeded"
            ? (costInputsFromOutput(lastCost.output as unknown as CostEstimateOutput) as unknown as Record<string, unknown>) // keep the prices typed in Cost Estimate
            : {};
    scrollTo(id);
    await runGenerator(id, options);
  }

  return (
    <div className="space-y-4">
      <Button variant="primary" className="w-full" onClick={openPackage}>
        <Icon name="sparkle" /> Generate complete design package
      </Button>

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
        {available.map((g) => {
          const job = latestJob(g.id);
          return (
            <li key={g.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.name.replace("Generate ", "")}</p>
                  <p className="text-xs text-muted">{g.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ProviderBadge isMock={g.is_mock} provider={g.provider} />
                    {job?.status === "succeeded" && !job.stale && <Badge tone="ok">Done · v{job.version_number}</Badge>}
                    {job?.status === "succeeded" && job.stale && <Badge tone="wine">Out of date</Badge>}
                    {job?.status === "failed" && <Badge tone="err">Failed</Badge>}
                  </div>
                </div>
                <Button size="sm" onClick={() => run(g.id)} loading={running[g.id]} disabled={g.id === "design" && !idea}>
                  Generate
                </Button>
              </div>
              {g.id === "sketch" && (
                <div className="mt-2">
                  <label htmlFor="sketch-style" className={labelClass}>
                    Sketch style
                  </label>
                  <select id="sketch-style" className={`${inputClass} py-1.5`} value={sketchStyle} onChange={(e) => onSketchStyle(e.target.value)}>
                    {SKETCH_STYLES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(g.id === "stitching_guide" || g.id === "video") && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label htmlFor={g.id + "-language"} className={labelClass}>
                      Video language
                    </label>
                    <select id={g.id + "-language"} className={`${inputClass} py-1.5`} value={guideLanguage} onChange={(e) => setGuideLanguage(e.target.value)}>
                      <option value="any">Any language</option>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
                    <input type="checkbox" className="mt-0.5 accent-wine" checked={indexVideos} onChange={(e) => setIndexVideos(e.target.checked)} />
                    <span>Let AI watch videos without chapters once, to start them at the right moment (needs a Gemini key; costs a little)</span>
                  </label>
                </div>
              )}
              {g.id === "tutorial" && (
                <div className="mt-2">
                  <label htmlFor="tutorial-language" className={labelClass}>
                    Video language
                  </label>
                  <select id="tutorial-language" className={`${inputClass} py-1.5`} value={tutorialLanguage} onChange={(e) => setTutorialLanguage(e.target.value)}>
                    <option value="any">Any language</option>
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {planned.length > 0 && (
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Coming in later phases</p>
        <ul className="space-y-1">
          {planned.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-faint" title={g.description}>
              <span className="truncate">{g.name.replace("Generate ", "")}</span>
              <span className="flex items-center gap-2">
                <Badge>Phase {g.phase}</Badge>
                <Button size="sm" variant="ghost" disabled aria-label={`${g.name} – not available yet`}>
                  Unavailable
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      )}

      <dialog ref={dialogRef} className="m-auto w-[min(94vw,480px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl">
        <div className="p-5">
          <h2 className="font-display text-xl">Complete design package</h2>
          <p className="mt-1 text-sm text-muted">Choose what to generate. Everything uses the same design spec. Generate Design runs first and its result is saved as a new version.</p>
          {!idea && selected.design && <p className="mt-2 text-sm text-err">Write an idea first, or untick Generate Design.</p>}
          <ul className="mt-4 space-y-2">
            {generators.map((g) => (
              <li key={g.id}>
                <label className={`flex items-center gap-2 text-sm ${g.available ? "cursor-pointer" : "text-faint"}`}>
                  <input type="checkbox" className="accent-wine" disabled={!g.available || pkgRunning} checked={!!selected[g.id]} onChange={(e) => setSelected((s) => ({ ...s, [g.id]: e.target.checked }))} />
                  {g.name}
                  {!g.available && <span className="text-xs">({g.unavailable_reason})</span>}
                </label>
              </li>
            ))}
          </ul>
          {selected.sketch && (
            <p className="mt-3 text-xs text-muted">Sketch style: {SKETCH_STYLES.find((s) => s.id === sketchStyle)?.label}</p>
          )}
          {pkgError && <p role="alert" className="mt-3 text-sm text-err">{pkgError}</p>}
          {pkgResult && (
            <ul className="mt-3 space-y-1 rounded-md bg-sunken p-3 text-sm" aria-live="polite">
              {pkgResult.steps.map((s) => (
                <li key={s.generator_id} className="flex justify-between gap-2">
                  <span>{generators.find((g) => g.id === s.generator_id)?.name ?? s.generator_id}</span>
                  <span className={s.status === "succeeded" ? "text-ok" : s.status === "failed" ? "text-err" : "text-muted"}>
                    {s.status}
                    {s.reason ? ` – ${s.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => dialogRef.current?.close()}>{pkgResult ? "Close" : "Cancel"}</Button>
            {!pkgResult && (
              <Button variant="primary" onClick={runPackage} loading={pkgRunning} disabled={!Object.values(selected).some(Boolean) || (!!selected.design && !idea)}>
                Run selected
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
