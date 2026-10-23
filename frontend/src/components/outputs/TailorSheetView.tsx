/* eslint-disable @next/next/no-img-element -- reference pictures are served by our own API */
import { api } from "@/lib/api";
import type { GenerationJob, TailorSheetOutput } from "@/lib/types";
import { formatDate } from "@/lib/format";

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("missing")) return "font-medium text-err";
  if (s.startsWith("estimate")) return "font-medium text-warn";
  return "text-ok";
}

function NoteList({ title, items, numbered = false }: { title: string; items: string[]; numbered?: boolean }) {
  if (items.length === 0) return null;
  const List = numbered ? "ol" : "ul";
  return (
    <section className="break-inside-avoid">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <List className={`mt-1 space-y-1 pl-5 ${numbered ? "list-decimal" : "list-disc"}`}>
        {items.map((n) => (
          <li key={n} className={n.startsWith("Designer:") ? "font-medium" : ""}>
            {n}
          </li>
        ))}
      </List>
    </section>
  );
}

export function TailorSheetView({ job, full = false }: { job: GenerationJob; full?: boolean }) {
  const out = job.output as unknown as TailorSheetOutput;
  const sections = full ? out.sections : out.sections.slice(0, 1);
  const references = out.references ?? [];
  const missingCount = out.measurements.filter((m) => m.status.toLowerCase().startsWith("missing")).length || out.missing_measurements.length;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-2">
        <h3 className="font-display text-xl">{out.title}</h3>
        <p className="text-xs text-muted">
          Tailor specification · design v{job.version_number} · {formatDate(job.created_at)}
        </p>
      </div>
      {out.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px]">
          {out.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {full && references.length > 0 && (
        <section className="break-inside-avoid">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Reference views</h4>
          <div className="mt-2 flex flex-wrap gap-3">
            {references.map((r) => (
              <figure key={r.asset_id + r.view} className="w-32">
                <img src={api.assetUrl(r.asset_id)} alt={`${r.view} view`} className="aspect-[2/3] w-full rounded border border-line bg-canvas object-cover" />
                <figcaption className="mt-0.5 text-xs">
                  <span className="font-medium capitalize">{r.view} view</span>
                  {r.note && <span className="text-muted"> – {r.note}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      <div className={full ? "grid gap-5 md:grid-cols-2" : ""}>
        {sections.map((s) => (
          <section key={s.heading} className="break-inside-avoid">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{s.heading}</h4>
            <table className="mt-1 w-full border-collapse">
              <tbody>
                {s.rows.map(([k, v]) => (
                  <tr key={k} className="border-b border-line/70 align-top">
                    <th scope="row" className="w-40 py-1 pr-3 text-left font-normal text-muted">
                      {k}
                    </th>
                    <td className="py-1">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {full && (
        <>
          <section className="break-inside-avoid">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Measurements{out.unit ? ` (${out.unit})` : ""}</h4>
            {out.measurements.length === 0 ? (
              <p className="mt-1 text-muted">No measurements provided.</p>
            ) : (
              <table className="mt-1 w-full border-collapse">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-1 font-medium">Measurement</th>
                    <th className="py-1 pr-2 font-medium">Value</th>
                    <th className="py-1 pr-2 font-medium">Status</th>
                    <th className="py-1 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {out.measurements.map((m) => (
                    <tr key={m.name} className="border-b border-line/70">
                      <td className="py-1 pr-2">{m.name}</td>
                      <td className="py-1 pr-2">{m.value}</td>
                      <td className={`py-1 ${statusClass(m.status)}`}>{m.status}</td>
                      <td className="py-1 text-muted">{m.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Older sheets listed missing measurements separately instead of as table rows. */}
            {out.missing_measurements.length > 0 && !out.measurements.some((m) => m.status.toLowerCase().startsWith("missing")) && (
              <p className="mt-2 text-[13px]">
                <span className="font-medium text-err">Missing:</span> {out.missing_measurements.join(", ")}
              </p>
            )}
            {missingCount > 0 && <p className="mt-1 text-xs text-muted">No cutting dimensions are given until every required measurement is taken.</p>}
          </section>
          <div className="grid gap-5 md:grid-cols-2">
            <NoteList title="Construction guidance" items={out.construction_notes} numbered />
            <div className="space-y-5">
              <NoteList title="Cutting notes" items={out.cutting_notes} />
              <NoteList title="Stitching notes" items={out.stitching_notes ?? []} />
            </div>
          </div>
          <NoteList title="Open questions" items={out.open_questions ?? []} />
        </>
      )}
      {!full && <p className="text-xs text-muted">Open the Tailor Workspace for the full sheet and PDF download.</p>}
    </div>
  );
}
