/* eslint-disable @next/next/no-img-element -- images are served by our own API */
"use client";

import { useState } from "react";
import { JobMeta } from "@/components/outputs/OutputCard";
import { TailorSheetView } from "@/components/outputs/TailorSheetView";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { THEMES, themeStyle } from "@/lib/themes";
import type { Asset, DesignSpec, Measurement, MeasurementUnit, ReferenceView, TailorNotes, TailorReference } from "@/lib/types";
import { useProject } from "./ProjectContext";

const COMMON = ["Bust / chest", "Waist", "Hip", "Shoulder width", "Armhole", "Sleeve length", "Full length", "Neck depth (front)", "Neck depth (back)", "Wrist (sleeve opening)"];
const EMPTY_NOTES: TailorNotes = { construction: "", cutting: "", stitching: "", references: [] };
const VIEWS: ReferenceView[] = ["front", "back", "side", "detail"];
const MAX_REFERENCES = 8;

type Row = Omit<Measurement, "value"> & { value: string };

const GARMENT_FIELDS = [
  ["neckline", "Neckline", "V-neck, boat neck…"],
  ["sleeve_style", "Sleeves", "Full sleeves, cap…"],
  ["garment_length", "Length", "Floor length, knee…"],
  ["fit", "Fit", "Fitted, relaxed…"],
] as const;

const NOTE_FIELDS = [
  ["construction", "Construction notes", "e.g. Keep the back plain; kalis joined with piping"],
  ["cutting", "Cutting notes", "e.g. Match the border on both sleeves (no measurements needed here)"],
  ["stitching", "Stitching notes", "e.g. Hand-finish the hem; silk thread for topstitching"],
] as const;

function assetLabel(a: Asset): string {
  if (a.kind === "generated") return `${(a.generator_id ?? "image").replace("_", " ")} v${a.version_number ?? "?"}${a.is_mock ? " (mock)" : ""}`;
  if (a.kind === "sketch") return "Studio sketch";
  return a.filename;
}

function TailorDetailsForm() {
  const { detail, saveSpec } = useProject();
  const spec = detail!.current_spec;
  const [unit, setUnit] = useState<MeasurementUnit>(spec.measurement_unit);
  const [rows, setRows] = useState<Row[]>(() => spec.measurements.map((m) => ({ ...m, value: String(m.value) })));
  const [garment, setGarment] = useState(() => ({ neckline: spec.neckline, sleeve_style: spec.sleeve_style, garment_length: spec.garment_length, fit: spec.fit }));
  const [closures, setClosures] = useState(spec.closures.join(", "));
  const [notes, setNotes] = useState<TailorNotes>(() => structuredClone(spec.tailor ?? EMPTY_NOTES));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = new Set(rows.map((r) => r.name.toLowerCase()));
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const images = [...detail!.assets].reverse().slice(0, 12);
  const referenceFor = (assetId: string) => notes.references.find((r) => r.asset_id === assetId);

  function setReference(assetId: string, patch: Partial<TailorReference> | null) {
    setNotes((n) => {
      const others = n.references.filter((r) => r.asset_id !== assetId);
      if (patch === null) return { ...n, references: others };
      const current = n.references.find((r) => r.asset_id === assetId) ?? { asset_id: assetId, view: "front" as const, note: "" };
      return { ...n, references: [...others, { ...current, ...patch }] };
    });
  }

  async function save() {
    setError(null);
    const clean: Measurement[] = [];
    for (const r of rows) {
      if (!r.name.trim() && !r.value.trim()) continue;
      const value = Number(r.value);
      if (!r.name.trim() || !Number.isFinite(value) || value <= 0 || value >= 1000) {
        setError(`Check the row "${r.name || "(no name)"}": it needs a name and a number greater than 0. Leave a measurement out if you do not have it yet; the sheet will list it as missing.`);
        return;
      }
      clean.push({ name: r.name.trim(), value, verified: r.verified, note: r.note.trim() });
    }
    const next: DesignSpec = {
      ...spec,
      ...Object.fromEntries(Object.entries(garment).map(([k, v]) => [k, v.trim()])),
      measurement_unit: unit,
      measurements: clean,
      closures: closures.split(",").map((s) => s.trim()).filter(Boolean),
      tailor: { ...notes, references: notes.references.map((r) => ({ ...r, note: r.note.trim() })) },
    };
    setSaving(true);
    try {
      await saveSpec(next, "Updated tailor details");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-surface shadow-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Measurements</h2>
          <div role="radiogroup" aria-label="Unit" className="flex rounded-md border border-line p-0.5 text-xs">
            {(["cm", "in"] as const).map((u) => (
              <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)} className={`rounded px-2.5 py-1 ${unit === u ? "bg-wine text-on-wine" : "text-muted"}`}>
                {u}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">
          Tick <span className="font-medium text-ok">Measured</span> only for real measurements of the wearer. Unticked values print as <span className="font-medium text-warn">Estimate</span>; anything the garment needs but you leave out prints as <span className="font-medium text-err">Missing</span>.
        </p>

        <div className="mt-3 space-y-2.5">
          {rows.length === 0 && <p className="text-sm text-faint">No measurements yet. Add the ones below.</p>}
          {rows.map((r, i) => (
            <div key={i} className="space-y-1">
              <div className="grid grid-cols-[1fr_72px_auto_auto] items-center gap-2">
                <input aria-label="Measurement name" className={`${inputClass} py-1.5`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" maxLength={60} />
                <input aria-label={`${r.name || "Measurement"} value in ${unit}`} className={`${inputClass} py-1.5`} inputMode="decimal" value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={unit} />
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" className="accent-wine" checked={r.verified} onChange={(e) => update(i, { verified: e.target.checked })} /> Measured
                </label>
                <button type="button" aria-label={`Remove ${r.name || "row"}`} className="rounded p-1 text-faint hover:text-err" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </div>
              <input aria-label={`Note for ${r.name || "measurement"}`} className={`${inputClass} py-1 text-xs`} value={r.note} onChange={(e) => update(i, { note: e.target.value })} placeholder="Note (optional), e.g. taken over a blouse" maxLength={200} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {COMMON.filter((c) => !used.has(c.toLowerCase())).map((c) => (
            <button key={c} type="button" onClick={() => setRows((rs) => [...rs, { name: c, value: "", verified: false, note: "" }])} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-wine hover:text-wine">
              + {c}
            </button>
          ))}
          <button type="button" onClick={() => setRows((rs) => [...rs, { name: "", value: "", verified: false, note: "" }])} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-wine hover:text-wine">
            + Custom
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface shadow-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Garment details</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {GARMENT_FIELDS.map(([key, label, ph]) => (
            <div key={key}>
              <label htmlFor={`tw-${key}`} className={labelClass}>
                {label}
              </label>
              <input id={`tw-${key}`} className={inputClass} value={garment[key]} placeholder={ph} maxLength={60} onChange={(e) => setGarment((g) => ({ ...g, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="col-span-2">
            <label htmlFor="tw-closures" className={labelClass}>
              Closures (comma separated)
            </label>
            <input id="tw-closures" className={inputClass} value={closures} onChange={(e) => setClosures(e.target.value)} placeholder="Side zip, Hooks" />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface shadow-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Notes for the tailor</h2>
        <p className="mt-1 text-xs text-muted">Printed on the sheet as “Designer:” lines, above the app&apos;s general guidance.</p>
        <div className="mt-3 space-y-3">
          {NOTE_FIELDS.map(([key, label, ph]) => (
            <div key={key}>
              <label htmlFor={`tw-${key}`} className={labelClass}>
                {label}
              </label>
              <textarea id={`tw-${key}`} className={`${inputClass} min-h-16`} value={notes[key]} placeholder={ph} maxLength={2000} onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface shadow-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Front / back references</h2>
          <span className="text-xs text-faint">
            {notes.references.length}/{MAX_REFERENCES}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Choose which pictures show the front and back. They are printed on the sheet and the PDF (PNG/JPEG/WebP; mock SVG sketches show as a note in the PDF).</p>
        {images.length === 0 ? (
          <p className="mt-3 text-xs text-faint">Generate a sketch or upload reference images in the Notebook first.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {images.map((a) => {
              const ref = referenceFor(a.id);
              const full = !ref && notes.references.length >= MAX_REFERENCES;
              return (
                <li key={a.id} className={`rounded-md border p-1.5 ${ref ? "border-wine bg-wine-soft" : "border-line"}`}>
                  <img src={api.assetUrl(a.id)} alt={assetLabel(a)} className="aspect-[2/3] w-full rounded bg-canvas object-cover" />
                  <p className="mt-1 truncate text-[11px] text-muted" title={assetLabel(a)}>
                    {assetLabel(a)}
                  </p>
                  <select
                    aria-label={`Use ${assetLabel(a)} as`}
                    className={`${inputClass} mt-1 py-1 text-xs`}
                    value={ref?.view ?? ""}
                    disabled={full}
                    onChange={(e) => setReference(a.id, e.target.value ? { view: e.target.value as ReferenceView } : null)}
                  >
                    <option value="">{full ? "Limit reached" : "Not used"}</option>
                    {VIEWS.map((v) => (
                      <option key={v} value={v}>
                        {v[0].toUpperCase() + v.slice(1)} view
                      </option>
                    ))}
                  </select>
                  {ref && (
                    <input aria-label={`Note for ${ref.view} view`} className={`${inputClass} mt-1 py-1 text-xs`} value={ref.note} maxLength={200} placeholder="Note (optional)" onChange={(e) => setReference(a.id, { note: e.target.value })} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error && <p role="alert" className="text-xs text-err">{error}</p>}
      <div className="sticky bottom-3 flex justify-end">
        <Button variant="primary" onClick={save} loading={saving} className="shadow-md">
          Save tailor details as v{detail!.project.current_version + 1}
        </Button>
      </div>
    </div>
  );
}

export function TailorWorkspace() {
  const { detail, latestJob, runGenerator, running, requestErrors, retryJob, projectId } = useProject();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  if (!detail) return null;
  const job = latestJob("tailor_sheet");

  async function downloadPdf() {
    if (!job) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      await api.downloadTailorPdf(projectId, job.id);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "The PDF could not be made.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="no-print">
        <TailorDetailsForm key={detail.project.current_version} />
      </div>

      <div className="min-w-0 space-y-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Tailor specification sheet</h2>
          <div className="flex flex-wrap gap-2">
            {job?.status === "succeeded" && (
              <>
                <Button onClick={downloadPdf} loading={pdfBusy}>
                  <Icon name="download" /> Download PDF
                </Button>
                <Button onClick={() => window.print()}>
                  <Icon name="print" /> Print
                </Button>
              </>
            )}
            <Button variant="primary" onClick={() => runGenerator("tailor_sheet")} loading={running.tailor_sheet}>
              <Icon name="sparkle" /> {job ? (job.stale ? "Update sheet" : "Regenerate sheet") : "Generate tailor sheet"}
            </Button>
          </div>
        </div>
        {requestErrors.tailor_sheet && <Notice tone="err" title="Request failed">{requestErrors.tailor_sheet}</Notice>}
        {pdfError && <Notice tone="err" title="PDF download failed">{pdfError}</Notice>}
        {running.tailor_sheet && (
          <p className="no-print flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Building the sheet…
          </p>
        )}
        {!job && !running.tailor_sheet && (
          <EmptyState title="No tailor sheet yet">Fill in the details on the left, save, then generate the sheet. It lists anything that is still missing.</EmptyState>
        )}
        {job?.status === "failed" && (
          <Notice tone="err" title="Could not build the sheet" action={<Button size="sm" onClick={() => retryJob(job)}>Retry</Button>}>
            {job.error}
          </Notice>
        )}
        {job?.status === "succeeded" && (
          <>
            <div className="no-print flex flex-wrap items-center gap-2">
              <JobMeta job={job} />
              {!job.is_mock && <Badge>Built from your spec · no AI</Badge>}
            </div>
            {job.stale && <p className="no-print text-xs text-wine">The design changed since this sheet was made ({job.stale_fields.join(", ").replaceAll("_", " ")}). Press Update sheet before downloading.</p>}
            {/* The sheet is a paper document, so it always shows in the Ivory theme. */}
            <article className="print-area rounded-lg border border-line bg-surface p-6 text-ink" style={themeStyle(THEMES.light)}>
              <TailorSheetView job={job} full />
            </article>
            <p className="no-print text-xs text-muted">The PDF is an A4 sheet with your references, a measurement table, construction, cutting and stitching notes, a tick-box checklist and a sign-off block.</p>
          </>
        )}
      </div>
    </div>
  );
}
