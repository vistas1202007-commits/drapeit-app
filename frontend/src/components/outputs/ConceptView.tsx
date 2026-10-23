"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useProject } from "@/components/project/ProjectContext";
import { api } from "@/lib/api";
import type { DesignConceptOutput, DesignPlan, GenerationJob } from "@/lib/types";

const SHOWN: [keyof DesignConceptOutput["proposed_spec"], string][] = [
  ["garment_category", "Garment"],
  ["occasion", "Occasion"],
  ["silhouette", "Silhouette"],
  ["neckline", "Neckline"],
  ["sleeve_style", "Sleeves"],
  ["garment_length", "Length"],
  ["colour_palette", "Colours"],
  ["embellishments", "Embellishments"],
  ["preferred_fabrics", "Fabrics"],
];

function Heading({ children }: { children: string }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted">{children}</p>;
}

/** The structured design plan (Phase 2): concept, colours, details, order of work. */
function PlanView({ plan }: { plan: DesignPlan }) {
  return (
    <div className="space-y-4 rounded-md border border-line bg-paper px-4 py-3">
      <div>
        <Heading>Design plan</Heading>
        <p className="mt-1 leading-relaxed">{plan.concept_statement}</p>
        {plan.style_keywords.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {plan.style_keywords.map((k) => (
              <li key={k} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                {k}
              </li>
            ))}
          </ul>
        )}
      </div>
      {plan.colour_story.length > 0 && (
        <div>
          <Heading>Colour story</Heading>
          <ul className="mt-2 flex flex-wrap gap-3">
            {plan.colour_story.map((c) => (
              <li key={`${c.name}-${c.role}`} className="flex items-center gap-2">
                <span className="h-7 w-7 shrink-0 rounded-full border border-line" style={{ backgroundColor: /^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : "var(--color-line-strong)" }} aria-hidden />
                <span className="leading-tight">
                  <span className="block text-sm">{c.name}</span>
                  <span className="block text-xs text-muted">{c.role}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.design_details.length > 0 && (
        <div>
          <Heading>Design details</Heading>
          <dl className="mt-1 space-y-1">
            {plan.design_details.map((d) => (
              <div key={`${d.area}-${d.detail}`} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted">{d.area}</dt>
                <dd>{d.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {plan.construction_overview.length > 0 && (
        <div>
          <Heading>Order of work (overview, not cutting instructions)</Heading>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {plan.construction_overview.map((c) => (
              <li key={c.step}>
                {c.step}
                {c.note && <span className="text-muted"> · {c.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="grid gap-3 @xl:grid-cols-2">
        {plan.fabric_direction && (
          <div>
            <Heading>Fabric direction</Heading>
            <p className="mt-1">{plan.fabric_direction}</p>
          </div>
        )}
        <div>
          <Heading>Difficulty</Heading>
          <p className="mt-1 capitalize">{plan.difficulty}</p>
          {plan.difficulty_reason && <p className="text-xs text-muted">{plan.difficulty_reason}</p>}
        </div>
      </div>
    </div>
  );
}

export function ConceptView({ job }: { job: GenerationJob }) {
  const { projectId, refresh } = useProject();
  const out = job.output as unknown as DesignConceptOutput;
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply() {
    setApplying(true);
    setMessage(null);
    try {
      const res = await api.applyDesign(projectId, job.id);
      await refresh();
      setMessage(`Saved as design version ${res.version_number}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not apply.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="@container space-y-3 text-sm">
      <p className="font-display text-lg leading-snug">{out.summary}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 @xl:grid-cols-2">
        {SHOWN.map(([key, label]) => {
          const value = out.proposed_spec[key];
          const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          return (
            <div key={key} className="flex gap-2 border-b border-line/70 pb-1.5">
              <dt className="w-28 shrink-0 text-muted">{label}</dt>
              <dd className={text ? "text-ink" : "text-faint"}>{text || "—"}</dd>
            </div>
          );
        })}
      </dl>
      {out.proposed_spec.visual_description && (
        <p className="text-xs text-muted">
          <span className="font-medium text-ink">Picture description</span> (used for sketches and previews): {out.proposed_spec.visual_description}
        </p>
      )}
      {out.plan && <PlanView plan={out.plan} />}
      {out.assumptions.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Assumptions</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {out.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {out.unresolved_questions.length > 0 && (
        <div className="rounded-md bg-sunken px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Questions to answer</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {out.unresolved_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={apply} loading={applying}>
          Use this as the design spec
        </Button>
        <span className="text-xs text-muted">{message ?? "Saves a new version. Your earlier versions are kept."}</span>
      </div>
    </div>
  );
}
