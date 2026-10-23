"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { OutputCard } from "@/components/outputs/OutputCard";
import { ImageLibrary } from "./ImageLibrary";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { costInputsFromOutput } from "@/lib/cost";
import type { CostEstimateOutput, GenerationJob } from "@/lib/types";

const SECTIONS = [
  { id: "design", title: "Design concept", empty: "Write your idea on the left and press Generate Design." },
  { id: "sketch", title: "Sketches", empty: "Set a garment type, then generate a sketch in any style." },
  { id: "visual_preview", title: "Visual preview", empty: "Generate a realistic picture of the finished garment." },
  { id: "fabric", title: "Fabric suggestions", empty: "Generate fabric recommendations for this design." },
  { id: "materials", title: "Tools & materials", empty: "Generate a checklist of what you need." },
  { id: "tailor_sheet", title: "Tailor sheet", empty: "Combine everything into a tailor specification." },
  { id: "cost", title: "Cost estimate", empty: "Open Cost Estimate to add your own prices; the app never invents them." },
  { id: "variations", title: "Design variations", empty: "Try alternative necklines, sleeves, silhouettes, embellishments and colours." },
  { id: "moodboard", title: "Moodboard", empty: "Collect the mood, palette, textures and motifs for this design." },
  { id: "embroidery", title: "Embroidery & print", empty: "Get embroidery and print concepts with placement ideas." },
  { id: "pattern", title: "Pattern assistance", empty: "Conceptual help: pattern pieces, measurements, drafting and cutting layout." },
  { id: "tutorial", title: "Tutorials", empty: "Find real tutorial videos for this design (needs a free YouTube key)." },
  { id: "video", title: "Instructional video", empty: "Plan a how-to video: storyboard and script, plus real tutorial links." },
];

/** Options to regenerate an output with: the same style for sketches, the same typed prices for cost estimates. */
function regenerateOptions(sectionId: string, job: GenerationJob, sketchStyle: string): Record<string, unknown> {
  if (sectionId === "sketch") return { style: (job.output as { style?: string } | null)?.style ?? sketchStyle };
  if (sectionId === "cost" && job.status === "succeeded") return costInputsFromOutput(job.output as unknown as CostEstimateOutput) as unknown as Record<string, unknown>;
  if (sectionId === "tutorial") return { language: (job.output as { language?: string } | null)?.language ?? "any" };
  return {};
}

export function OutputSections({ sketchStyle }: { sketchStyle: string }) {
  const { detail, running, runGenerator, requestErrors } = useProject();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  if (!detail) return null;

  return (
    <div className="space-y-8">
      {SECTIONS.map((section, index) => {
        const jobs = detail.jobs.filter((j) => j.generator_id === section.id);
        const visible = showAll[section.id] ? jobs : jobs.slice(0, 1);
        return (
          <section key={section.id} id={`section-${section.id}`} aria-labelledby={`h-${section.id}`} className="scroll-mt-24">
            <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
              <span className="font-display text-sm italic text-wine">{String(index + 1).padStart(2, "0")}</span>
              <h2 id={`h-${section.id}`} className="font-display text-xl">
                {section.title}
              </h2>
              {jobs.length > 1 && (
                <button type="button" className="ml-auto text-xs text-muted hover:text-wine" onClick={() => setShowAll((s) => ({ ...s, [section.id]: !s[section.id] }))}>
                  {showAll[section.id] ? "Show latest only" : `Show all ${jobs.length}`}
                </button>
              )}
            </div>
            <div className="space-y-3">
              {running[section.id] && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-6 text-sm text-muted" role="status">
                  <Spinner /> Generating…
                </div>
              )}
              {requestErrors[section.id] && (
                <Notice tone="err" title="The request did not reach the generator">
                  {requestErrors[section.id]}
                </Notice>
              )}
              {jobs.length === 0 && !running[section.id] ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-faint">{section.empty}</p>
              ) : (
                visible.map((job) => (
                  <OutputCard
                    key={job.id}
                    job={job}
                    regenerating={running[section.id]}
                    onRegenerate={
                      section.id === "design"
                        ? undefined // the idea panel is where the design is regenerated
                        : () => runGenerator(section.id, regenerateOptions(section.id, job, sketchStyle))
                    }
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
      <ImageLibrary />
    </div>
  );
}
