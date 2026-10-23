import Link from "next/link";
import { formatMoney } from "@/lib/cost";
import type { CostEstimateOutput, GenerationJob } from "@/lib/types";

const STATUS: Record<string, string> = {
  missing_price: "No price",
  missing_quantity: "No quantity",
  missing_both: "No quantity or price",
  missing: "No amount",
};

export function CostView({ job, full = false }: { job: GenerationJob; full?: boolean }) {
  const out = job.output as unknown as CostEstimateOutput;
  const money = (n: number) => formatMoney(n, out.currency);
  const budgetTone = out.budget_status === "within" ? "text-ok" : out.budget_status === "over" ? "text-err" : "text-muted";

  const totals = (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-sunken p-3 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs text-muted">Materials</dt>
        <dd className="font-medium">{money(out.materials_subtotal)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Buffer ({out.contingency_percent}% of materials)</dt>
        <dd className="font-medium">{money(out.contingency_amount)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Labour (separate)</dt>
        <dd className="font-medium">{money(out.labour_subtotal)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Total{out.complete ? "" : " so far"}</dt>
        <dd className="font-display text-lg text-wine">{money(out.total)}</dd>
      </div>
    </dl>
  );

  if (!full) {
    return (
      <div className="space-y-2 text-sm">
        {totals}
        {!out.complete && <p className="text-xs text-warn">{out.missing.length} line(s) still need a price or quantity and are not in the total.</p>}
        <p className={`text-xs ${budgetTone}`}>{out.budget_note}</p>
        <p className="text-xs text-muted">
          Edit prices and see every assumption in{" "}
          <Link href={`/projects/${job.project_id}/cost`} className="text-wine hover:underline">
            Cost Estimate
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="@container space-y-4 text-sm">
      {totals}
      <p className={`text-sm ${budgetTone}`}>
        <span className="font-medium">Budget: </span>
        {out.budget_note}
      </p>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Materials{out.region && ` · prices for ${out.region}`}
          {out.price_date && ` · checked ${out.price_date}`}
        </h4>
        <ul className="mt-1 divide-y divide-line/70 @xl:hidden">
          {out.materials.map((m, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                {m.item} <span className="text-xs text-faint">({m.kind})</span>
                <span className="block text-xs text-muted">
                  {m.quantity != null ? `${m.quantity} ${m.unit}` : "no quantity"} × {m.unit_price != null ? money(m.unit_price) : "no price"}
                  {m.price_source && ` · ${m.price_source}`}
                </span>
              </span>
              <span className={`shrink-0 text-right ${m.line_total == null ? "text-xs font-medium text-warn" : ""}`}>{m.line_total != null ? money(m.line_total) : STATUS[m.status]}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 hidden @xl:block">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1 font-medium">Item</th>
                <th className="py-1 font-medium">Qty</th>
                <th className="py-1 font-medium">Unit price</th>
                <th className="py-1 font-medium">Source</th>
                <th className="py-1 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {out.materials.map((m, i) => (
                <tr key={i} className="border-b border-line/70 align-top">
                  <td className="py-1">
                    {m.item} <span className="text-xs text-faint">({m.kind})</span>
                  </td>
                  <td className="py-1">{m.quantity != null ? `${m.quantity} ${m.unit}` : "—"}</td>
                  <td className="py-1">{m.unit_price != null ? money(m.unit_price) : "—"}</td>
                  <td className="py-1 text-xs text-muted">{m.price_source}</td>
                  <td className={`py-1 text-right ${m.line_total == null ? "text-xs font-medium text-warn" : ""}`}>{m.line_total != null ? money(m.line_total) : STATUS[m.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Labour (kept separate from materials)</h4>
        <table className="mt-1 w-full border-collapse">
          <tbody>
            {out.labour.length === 0 && (
              <tr>
                <td className="py-1 text-muted">No labour entered.</td>
              </tr>
            )}
            {out.labour.map((l, i) => (
              <tr key={i} className="border-b border-line/70 align-top">
                <td className="py-1">
                  {l.task}
                  {l.note && <span className="block text-xs text-muted">{l.note}</span>}
                </td>
                <td className={`py-1 text-right ${l.amount == null ? "text-xs font-medium text-warn" : ""}`}>{l.amount != null ? money(l.amount) : STATUS.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-md border border-line bg-paper p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
          {out.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {out.missing.length > 0 && (
          <p className="mt-2 text-[13px]">
            <span className="font-medium text-warn">Not in the total yet:</span> {out.missing.join("; ")}
          </p>
        )}
      </section>
    </div>
  );
}
