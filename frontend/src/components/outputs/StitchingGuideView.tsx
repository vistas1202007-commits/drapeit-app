"use client";

import { useEffect, useMemo, useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { api } from "@/lib/api";
import { byPhase, knownTicks, progress } from "@/lib/stitching";
import type { GenerationJob, GuideStep, StitchingGuideOutput } from "@/lib/types";
import { GuideVideoPlayer } from "./GuideVideoPlayer";

const LANGUAGE: Record<string, string> = { any: "any language", en: "English", hi: "Hindi" };

function GarmentSummary({ out }: { out: StitchingGuideOutput }) {
  const g = out.garment;
  const rows: [string, string][] = [
    ["Garment", g.garment_type],
    ["Bodice", g.bodice],
    ["Neckline", [g.neckline, g.neckline_finish && `finished with ${g.neckline_finish.toLowerCase()}`].filter(Boolean).join(", ")],
    ["Sleeves", g.sleeves],
    ["Skirt", g.skirt],
    ["Closure", [g.closure, g.closure_position && `(${g.closure_position})`].filter(Boolean).join(" ")],
    ["Length", g.length],
    ["Fabric", g.fabric ? `${g.fabric} · ${g.fabric_weight} weight${g.lined ? " · lined" : ""}` : `not chosen · ${g.fabric_weight} weight assumed`],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs min-[420px]:grid-cols-2 sm:grid-cols-3">
      {rows
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-faint">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function StepItem({ step, done, onToggle, saving, startOpen }: { step: GuideStep; done: boolean; onToggle: (value: boolean) => void; saving: boolean; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const panelId = `guide-step-${step.key}`;
  return (
    <li id={`step-${step.key}`} className={`scroll-mt-24 rounded-lg border bg-surface ${done ? "border-ok/30" : "border-line"}`}>
      <div className="flex items-start gap-1 p-1.5 sm:p-2">
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-sunken" title={done ? "Mark as not done" : "Mark as done"}>
          <input
            type="checkbox"
            className="h-5 w-5 accent-wine"
            checked={done}
            disabled={saving}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Step ${step.number} done: ${step.title}`}
          />
        </label>
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 rounded-md px-1 py-1.5 text-left hover:bg-sunken"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="block text-[11px] uppercase tracking-wide text-faint">Step {step.number}</span>
          <span className={`block text-sm font-medium ${done ? "text-muted line-through" : ""}`}>{step.title}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {step.video ? `▶ Video${step.video.start_seconds ? " at the right moment" : ""}` : step.video_status === "none" ? "No video found" : "No video search"}
            <span aria-hidden="true"> · {open ? "Hide" : "Show"} steps</span>
          </span>
        </button>
      </div>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-line px-3 pb-3 pt-2.5 text-sm sm:px-4">
          <p className="text-xs text-muted">{step.why}</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            {step.instructions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          {step.tips.length > 0 && (
            <div className="rounded-md bg-sunken px-3 py-2 text-xs">
              <p className="font-medium">Tips</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {step.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {step.fabric_tips.length > 0 && (
            <div className="rounded-md bg-gold-soft px-3 py-2 text-xs">
              <p className="font-medium text-gold-ink">For your fabric</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {step.fabric_tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <GuideVideoPlayer step={step} />
          <p className="text-[11px] text-faint">
            From the technique module “{step.module_title}” <span className="font-mono">({step.module_slug})</span>
          </p>
        </div>
      )}
    </li>
  );
}

export function StitchingGuideView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as StitchingGuideOutput;
  const { projectId } = useProject();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const steps = out.steps;
  const groups = useMemo(() => byPhase(steps), [steps]);
  const status = progress(steps, done);
  // Open the first step that is not done yet, once the saved ticks are known.
  const [firstOpen, setFirstOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getStitchingProgress(projectId, job.version_number)
      .then((p) => {
        if (cancelled) return;
        const ticks = knownTicks(steps, p.done_keys);
        setDone(ticks);
        setFirstOpen(steps.find((s) => !ticks.has(s.key))?.key ?? "");
      })
      .catch((e) => {
        if (cancelled) return;
        setProblem(`Your saved ticks could not be loaded${e instanceof Error ? `: ${e.message}` : "."} Ticks you make now may not be saved.`);
        setFirstOpen(steps[0]?.key ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, job.version_number, steps]);

  async function toggle(key: string, value: boolean) {
    const before = done;
    const next = new Set(done);
    if (value) next.add(key);
    else next.delete(key);
    setDone(next);
    setSaving(key);
    setProblem(null);
    try {
      const saved = await api.setStitchingStep(projectId, job.version_number, key, value);
      setDone(knownTicks(steps, saved.done_keys));
    } catch (e) {
      setDone(before);
      setProblem(e instanceof Error ? `The tick was not saved: ${e.message}` : "The tick was not saved. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  function goToNext() {
    if (!status.next) return;
    document.getElementById(`step-${status.next.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {out.garment.source === "spec+photo" && <Badge tone="gold">Read from your photo too</Badge>}
          <span className="text-xs text-muted">
            {out.knowledge_source} · videos: {out.video_source}
            {out.video_connected && ` (${LANGUAGE[out.video_language] ?? out.video_language})`}
          </span>
        </div>
        {job.stale && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-wine">
            <Badge tone="wine" title={`Changed since: ${job.stale_fields.join(", ")}`}>
              Stale
            </Badge>
            <span>Some steps may no longer fit the changed design. Your ticks for version {job.version_number} stay saved.</span>
          </p>
        )}
        <GarmentSummary out={out} />
        {(out.garment.assumptions.length > 0 || out.garment.photo_notes.length > 0) && (
          <details className="rounded-md bg-sunken px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">
              What the guide worked out for itself ({out.garment.assumptions.length + out.garment.photo_notes.length})
            </summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted">
              {[...out.garment.photo_notes, ...out.garment.assumptions].map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {out.fabric_card && (
        <details className="rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-xs" open>
          <summary className="cursor-pointer text-sm font-medium">Machine settings for {out.fabric_card.fabric}</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {(
              [
                ["Needle", out.fabric_card.needle],
                ["Thread", out.fabric_card.thread],
                ["Stitch length", out.fabric_card.stitch_length],
                ["Seams", out.fabric_card.seam_types.join(" · ")],
                ["Pressing", out.fabric_card.pressing],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-faint">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted">
            {out.fabric_card.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      {!out.video_connected && (
        <Notice tone="warn" title="Tutorial search is not connected">
          No videos are shown, because the app never makes them up. Add a free <code>YOUTUBE_API_KEY</code> to <code>backend/.env</code>, restart the backend and press Update. Until then
          every step links to the same search on YouTube.
        </Notice>
      )}

      <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" aria-live="polite">
            {status.done} of {status.total} steps done
          </p>
          {status.next ? (
            <button type="button" onClick={goToNext} className="min-h-9 rounded-md px-2 text-xs text-wine hover:bg-wine-soft">
              Next: step {status.next.number} · {status.next.title} ↓
            </button>
          ) : (
            status.total > 0 && <Badge tone="ok">All done</Badge>
          )}
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-label="Stitching progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.percent}
        >
          <div className="h-full rounded-full bg-wine transition-all" style={{ width: `${status.percent}%` }} />
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-err">
          {problem}
        </p>
      )}

      {firstOpen !== null &&
        groups.map((group) => (
          <section key={`${group.phase}-${group.steps[0].key}`} aria-label={group.label}>
            <h3 className="mb-2 font-display text-base">
              {group.label}{" "}
              <span className="text-xs font-normal text-faint">
                ({group.steps.filter((s) => done.has(s.key)).length}/{group.steps.length})
              </span>
            </h3>
            {(out.phase_tips?.[group.phase]?.length ?? 0) > 0 && (
              <div className="mb-2 rounded-md bg-gold-soft px-3 py-2 text-xs">
                <p className="font-medium text-gold-ink">For your {out.fabric_card?.fabric ?? "fabric"} in this part</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {out.phase_tips[group.phase]!.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="space-y-2">
              {group.steps.map((step) => (
                <StepItem key={step.key} step={step} done={done.has(step.key)} saving={saving === step.key} onToggle={(v) => toggle(step.key, v)} startOpen={step.key === firstOpen} />
              ))}
            </ol>
          </section>
        ))}

      <div className="space-y-1 border-t border-line pt-3">
        {out.notes.map((n) => (
          <p key={n} className="text-xs text-muted">
            {n}
          </p>
        ))}
      </div>
    </div>
  );
}
