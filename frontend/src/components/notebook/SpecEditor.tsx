"use client";

import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/fields";
import { GARMENT_CATEGORIES } from "@/lib/format";
import type { DesignSpec, SkillLevel } from "@/lib/types";

type TextKey = "title" | "occasion" | "silhouette" | "fit" | "neckline" | "sleeve_style" | "garment_length" | "climate";
type ListKey = "colour_palette" | "embellishments" | "closures" | "preferred_fabrics";

const TEXT_FIELDS: [TextKey, string, string][] = [
  ["title", "Design title", "Wine anarkali"],
  ["occasion", "Occasion", "Evening wedding"],
  ["silhouette", "Silhouette", "Fitted bodice, flared skirt"],
  ["fit", "Fit", "Fitted"],
  ["neckline", "Neckline", "V-neck"],
  ["sleeve_style", "Sleeves", "Full-length sleeves"],
  ["garment_length", "Length", "Floor length"],
  ["climate", "Climate", "Hot / summer"],
];

const LIST_FIELDS: [ListKey, string, string][] = [
  ["colour_palette", "Colours", "Wine, Gold"],
  ["embellishments", "Embellishments", "Embroidery, Zari work"],
  ["closures", "Closures", "Side zip, Hooks"],
  ["preferred_fabrics", "Preferred fabrics", "Georgette, Silk"],
];

function ListField({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label} <span className="font-normal text-faint">(comma separated)</span>
      </label>
      <input
        id={id}
        className={inputClass}
        placeholder={placeholder}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
    </div>
  );
}

/** Edit the shared design spec. Saving creates a new version; old versions stay. */
export function SpecEditor() {
  const { detail, saveSpec } = useProject();
  // The parent re-mounts this component (via `key`) when the version changes,
  // so starting from the current spec here is enough.
  const [spec, setSpec] = useState<DesignSpec>(() => structuredClone(detail!.current_spec));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;
  const dirty = JSON.stringify(spec) !== JSON.stringify(detail.current_spec);
  const set = <K extends keyof DesignSpec>(key: K, value: DesignSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveSpec(spec, note.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {spec.unresolved_questions.length > 0 && (
        <div className="rounded-md bg-sunken px-3 py-2 text-xs">
          <p className="font-medium text-ink">Open questions</p>
          <ul className="mt-1 space-y-1">
            {spec.unresolved_questions.map((q) => (
              <li key={q} className="flex items-start justify-between gap-2 text-muted">
                <span>{q}</span>
                <button type="button" className="shrink-0 text-wine hover:underline" onClick={() => set("unresolved_questions", spec.unresolved_questions.filter((x) => x !== q))}>
                  Resolved
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <label htmlFor="spec-cat" className={labelClass}>
          Garment type
        </label>
        <input id="spec-cat" list="garment-types" className={inputClass} value={spec.garment_category} onChange={(e) => set("garment_category", e.target.value)} placeholder="Choose or type" />
        <datalist id="garment-types">
          {GARMENT_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {TEXT_FIELDS.map(([key, label, ph]) => (
          <div key={key} className={key === "title" || key === "silhouette" ? "col-span-2" : ""}>
            <label htmlFor={`spec-${key}`} className={labelClass}>
              {label}
            </label>
            <input id={`spec-${key}`} className={inputClass} value={spec[key]} placeholder={ph} onChange={(e) => set(key, e.target.value)} />
          </div>
        ))}
      </div>
      {LIST_FIELDS.map(([key, label, ph]) => (
        <ListField key={key} id={`spec-${key}`} label={label} placeholder={ph} value={spec[key]} onChange={(v) => set(key, v)} />
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="spec-skill" className={labelClass}>
            Maker&apos;s skill level
          </label>
          <select id="spec-skill" className={inputClass} value={spec.skill_level} onChange={(e) => set("skill_level", e.target.value as SkillLevel)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="professional">Professional</option>
          </select>
        </div>
        <div>
          <label htmlFor="spec-budget" className={labelClass}>
            Budget
          </label>
          <div className="flex gap-1">
            <input
              id="spec-budget"
              type="number"
              min={0}
              className={inputClass}
              value={spec.budget.amount ?? ""}
              onChange={(e) => set("budget", { ...spec.budget, amount: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <input aria-label="Currency" className={`${inputClass} w-16`} value={spec.budget.currency} maxLength={8} onChange={(e) => set("budget", { ...spec.budget, currency: e.target.value })} />
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="spec-fabreq" className={labelClass}>
          Fabric requirements
        </label>
        <input id="spec-fabreq" className={inputClass} value={spec.fabric_requirements} placeholder="Breathable, not see-through, washable" onChange={(e) => set("fabric_requirements", e.target.value)} />
      </div>
      <div>
        <label htmlFor="spec-notes" className={labelClass}>
          Design notes
        </label>
        <textarea id="spec-notes" className={`${inputClass} min-h-20`} value={spec.design_notes} onChange={(e) => set("design_notes", e.target.value)} />
      </div>
      <div>
        <label htmlFor="spec-visual" className={labelClass}>
          Picture description
        </label>
        <textarea
          id="spec-visual"
          className={`${inputClass} min-h-24`}
          value={spec.visual_description}
          maxLength={1500}
          placeholder="What the garment looks like. Generate Design writes this; sketches and previews follow it."
          onChange={(e) => set("visual_description", e.target.value)}
        />
      </div>
      <p className="text-xs text-muted">
        Measurements ({spec.measurements.length}) are edited in the{" "}
        <Link href={`/projects/${detail.project.id}/tailor`} className="text-wine hover:underline">
          Tailor Workspace
        </Link>
        .
      </p>

      <div className="sticky bottom-0 -mx-1 border-t border-line bg-paper/95 px-1 pb-1 pt-3 backdrop-blur">
        <label htmlFor="spec-note" className="sr-only">
          What changed?
        </label>
        <input id="spec-note" className={`${inputClass} mb-2`} placeholder="What changed? (optional, e.g. 'boat neck instead of V')" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        {error && <p role="alert" className="mb-2 text-xs text-err">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {dirty ? <Badge tone="warn">Unsaved changes</Badge> : <span className="text-xs text-faint">Saved · v{detail.project.current_version}</span>}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => setSpec(structuredClone(detail.current_spec))}>
              Discard
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={!dirty} loading={saving}>
              Save as v{detail.project.current_version + 1}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
