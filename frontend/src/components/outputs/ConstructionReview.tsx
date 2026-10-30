"use client";

import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/fields";
import type { ConstructionChoices, StitchingGuideOutput } from "@/lib/types";

const OPTIONS: Record<keyof ConstructionChoices, [string, string][]> = {
  bodice: [["darted", "Darts"], ["princess", "Princess seams"], ["unfitted", "Unfitted, no darts"]],
  neckline_finish: [["facing", "Facing"], ["binding", "Bias binding"], ["collar", "Collar"]],
  closure_type: [["none", "No closure"], ["invisible_zip", "Invisible zip"], ["lapped_zip", "Lapped zip"], ["buttons", "Buttons"], ["hooks", "Hooks and eyes"]],
  closure_position: [["front", "Front"], ["back", "Back"], ["side", "Side"], ["none", "No closure"]],
  fabric_construction: [["woven", "Woven"], ["knit", "Knit or stretch"]],
  fabric_weight: [["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]],
  seam_finish: [["plain", "Plain"], ["french", "French"], ["flat_fell", "Flat fell"], ["stretch", "Stretch"]],
};

export function ConstructionReview({ out, stale }: { out: StitchingGuideOutput; stale: boolean }) {
  const { detail, saveSpec } = useProject();
  const [editing, setEditing] = useState(false);
  const decisions = out.garment.decisions ?? [];
  const pending = editing ? decisions : decisions.filter((d) => d.needs_confirmation);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!pending.length) return decisions.length
    ? <Button size="sm" onClick={() => setEditing(true)} disabled={stale}>Change construction choices</Button>
    : null;

  async function confirm() {
    if (!detail || stale) return;
    if (pending.some((d) => !values[d.key])) {
      setMessage("Choose an option for each construction detail.");
      return;
    }
    if ((values.fabric_construction || detail.current_spec.construction?.fabric_construction) === "knit"
        && ["french", "flat_fell"].includes(values.seam_finish || detail.current_spec.construction?.seam_finish || "")) {
      setMessage("Choose a stretch seam for a knit fabric.");
      return;
    }
    setBusy(true);
    try {
      await saveSpec({ ...detail.current_spec, construction: { ...detail.current_spec.construction, ...values } as ConstructionChoices },
        "Confirmed stitching construction choices");
      setMessage("Choices saved. Update the guide to use the new design version.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The choices could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-gold/40 bg-gold-soft p-3" aria-label="Confirm construction details">
      <p className="font-medium">Confirm the construction before sewing</p>
      <p className="text-xs">This is a draft plan. A photo or short description may leave the finish, shaping or fabric construction unclear. Check these choices against your pattern.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {pending.map((d) => (
          <label key={d.key} className="block text-xs">
            <span className="mb-1 block font-medium">{d.label}</span>
            <span className="mb-1 block text-muted">{d.source}: {d.value.replaceAll("_", " ")}</span>
            <select className={inputClass} value={values[d.key] || ""} disabled={stale || busy}
              onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value,
                ...((d.key === "closure_position" || d.key === "closure_type") && e.target.value === "none"
                  ? { closure_type: "none", closure_position: "none" } : {}) }))}>
              <option value="">Choose the construction</option>
              {OPTIONS[d.key]?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <Button size="sm" onClick={confirm} disabled={stale} loading={busy}>Confirm construction choices</Button>
      {stale && <p className="text-xs">Update this guide before confirming choices for the changed design.</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </section>
  );
}
