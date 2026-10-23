"use client";

import { useState } from "react";
import { CostView } from "@/components/outputs/CostView";
import { JobMeta } from "@/components/outputs/OutputCard";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { costInputsFromOutput, parseAmount } from "@/lib/cost";
import type { CostEstimateOutput, CostInputs, CostKind } from "@/lib/types";
import { useProject } from "./ProjectContext";

const KINDS: CostKind[] = ["fabric", "lining", "notion", "embellishment", "other"];

// Numbers are kept as text while typing, and checked when the estimate is calculated.
type MaterialRow = { item: string; kind: CostKind; quantity: string; unit: string; unit_price: string; price_source: string };
type LabourRow = { task: string; amount: string; note: string };

const text = (n: number | null) => (n == null ? "" : String(n));

function CostForm({ initial, onCalculate, onStarter, busy }: { initial: CostInputs; onCalculate: (inputs: CostInputs) => void; onStarter: (meta: Partial<CostInputs>) => void; busy: boolean }) {
  const [currency, setCurrency] = useState(initial.currency);
  const [region, setRegion] = useState(initial.region);
  const [priceDate, setPriceDate] = useState(initial.price_date);
  const [buffer, setBuffer] = useState(String(initial.contingency_percent));
  const [materials, setMaterials] = useState<MaterialRow[]>(() => initial.materials.map((m) => ({ ...m, quantity: text(m.quantity), unit_price: text(m.unit_price) })));
  const [labour, setLabour] = useState<LabourRow[]>(() => initial.labour.map((l) => ({ ...l, amount: text(l.amount) })));
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const meta = (): Partial<CostInputs> => ({ currency: currency.trim(), region: region.trim(), price_date: priceDate.trim(), contingency_percent: parseAmount(buffer) ?? 0 });
  const setMaterial = (i: number, patch: Partial<MaterialRow>) => setMaterials((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setLabourRow = (i: number, patch: Partial<LabourRow>) => setLabour((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function calculate() {
    setError(null);
    const contingency = parseAmount(buffer);
    if (contingency == null || contingency > 50) return setError("The buffer must be a number from 0 to 50 (%).");
    const lines: CostInputs["materials"] = [];
    for (const r of materials) {
      if (!r.item.trim() && !r.quantity.trim() && !r.unit_price.trim()) continue;
      const quantity = parseAmount(r.quantity);
      const price = parseAmount(r.unit_price);
      if (!r.item.trim()) return setError("Every material line needs a name.");
      if ((r.quantity.trim() && (quantity == null || quantity === 0)) || (r.unit_price.trim() && price == null)) {
        return setError(`Check the numbers for "${r.item}". Leave a box empty if you do not know it yet.`);
      }
      lines.push({ item: r.item.trim(), kind: r.kind, quantity, unit: r.unit.trim(), unit_price: price, price_source: r.price_source.trim() });
    }
    const work: CostInputs["labour"] = [];
    for (const r of labour) {
      if (!r.task.trim() && !r.amount.trim()) continue;
      const amount = parseAmount(r.amount);
      if (!r.task.trim()) return setError("Every labour line needs a task name.");
      if (r.amount.trim() && amount == null) return setError(`Check the amount for "${r.task}".`);
      work.push({ task: r.task.trim(), amount, note: r.note.trim() });
    }
    if (lines.length === 0 && work.length === 0) return setError("Add at least one material or labour line, or press “Fill from my checklist”.");
    onCalculate({ ...(meta() as Omit<CostInputs, "materials" | "labour">), contingency_percent: contingency, materials: lines, labour: work });
  }

  async function starter() {
    if (materials.length + labour.length > 0) {
      const ok = await confirm({ title: "Replace the lines?", message: "The lines below are replaced with items from your saved checklist and fabrics (without prices).", confirmLabel: "Replace" });
      if (!ok) return;
    }
    onStarter(meta());
  }

  return (
    <section className="space-y-5 rounded-lg border border-line bg-surface shadow-card p-4">
      {dialog}
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="cost-currency" className={labelClass}>
            Currency
          </label>
          <input id="cost-currency" className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} placeholder="INR" />
        </div>
        <div>
          <label htmlFor="cost-region" className={labelClass}>
            Prices are for (city / region)
          </label>
          <input id="cost-region" className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} placeholder="e.g. Jaipur" />
        </div>
        <div>
          <label htmlFor="cost-date" className={labelClass}>
            Prices checked on
          </label>
          <input id="cost-date" className={inputClass} value={priceDate} onChange={(e) => setPriceDate(e.target.value)} maxLength={40} placeholder="e.g. Oct 2026" />
        </div>
        <div>
          <label htmlFor="cost-buffer" className={labelClass}>
            Buffer on materials (%)
          </label>
          <input id="cost-buffer" className={inputClass} inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Materials</h3>
          <p className="text-xs text-faint">Fabric length: ask your tailor. The app never guesses it.</p>
        </div>
        <div className="mt-2 space-y-2">
          {materials.length === 0 && <p className="text-sm text-faint">No material lines yet.</p>}
          {materials.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,2fr)_110px_80px_70px_100px_minmax(0,1.3fr)_auto] sm:items-center sm:border-0 sm:p-0">
              <input aria-label="Item" className={`${inputClass} col-span-2 py-1.5 sm:col-span-1`} value={r.item} onChange={(e) => setMaterial(i, { item: e.target.value })} placeholder="Item" maxLength={120} />
              <select aria-label={`Kind of ${r.item || "item"}`} className={`${inputClass} py-1.5`} value={r.kind} onChange={(e) => setMaterial(i, { kind: e.target.value as CostKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input aria-label={`Quantity of ${r.item || "item"}`} className={`${inputClass} py-1.5`} inputMode="decimal" value={r.quantity} onChange={(e) => setMaterial(i, { quantity: e.target.value })} placeholder="Qty" />
              <input aria-label={`Unit for ${r.item || "item"}`} className={`${inputClass} py-1.5`} value={r.unit} onChange={(e) => setMaterial(i, { unit: e.target.value })} placeholder="m / pcs" maxLength={20} />
              <input aria-label={`Price per unit of ${r.item || "item"}`} className={`${inputClass} py-1.5`} inputMode="decimal" value={r.unit_price} onChange={(e) => setMaterial(i, { unit_price: e.target.value })} placeholder="Price/unit" />
              <input aria-label={`Where the price for ${r.item || "item"} comes from`} className={`${inputClass} py-1.5`} value={r.price_source} onChange={(e) => setMaterial(i, { price_source: e.target.value })} placeholder="Source (shop, online…)" maxLength={120} />
              <button type="button" aria-label={`Remove ${r.item || "line"}`} className="justify-self-end rounded p-1 text-faint hover:text-err" onClick={() => setMaterials((rs) => rs.filter((_, j) => j !== i))}>
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-wine hover:text-wine" onClick={() => setMaterials((rs) => [...rs, { item: "", kind: "other", quantity: "", unit: "", unit_price: "", price_source: "" }])}>
          + Material line
        </button>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Labour (kept separate)</h3>
        <div className="mt-2 space-y-2">
          {labour.length === 0 && <p className="text-sm text-faint">No labour lines yet.</p>}
          {labour.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_120px_minmax(0,2fr)_auto] sm:items-center">
              <input aria-label="Task" className={`${inputClass} py-1.5`} value={r.task} onChange={(e) => setLabourRow(i, { task: e.target.value })} placeholder="Task" maxLength={120} />
              <input aria-label={`Amount for ${r.task || "task"}`} className={`${inputClass} py-1.5`} inputMode="decimal" value={r.amount} onChange={(e) => setLabourRow(i, { amount: e.target.value })} placeholder="Quote" />
              {/* On phones the note gets its own row; on wider screens it sits before the remove button. */}
              <button type="button" aria-label={`Remove ${r.task || "line"}`} className="justify-self-end rounded p-1 text-faint hover:text-err sm:order-2" onClick={() => setLabour((rs) => rs.filter((_, j) => j !== i))}>
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
              <input aria-label={`Note for ${r.task || "task"}`} className={`${inputClass} col-span-3 py-1.5 sm:order-1 sm:col-span-1`} value={r.note} onChange={(e) => setLabourRow(i, { note: e.target.value })} placeholder="Note (who quoted, what is included)" maxLength={200} />
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-wine hover:text-wine" onClick={() => setLabour((rs) => [...rs, { task: "", amount: "", note: "" }])}>
          + Labour line
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button onClick={starter} disabled={busy}>
          <Icon name="refresh" /> Fill from my checklist
        </Button>
        <Button variant="primary" onClick={calculate} loading={busy}>
          <Icon name="sparkle" /> Calculate estimate
        </Button>
      </div>
    </section>
  );
}

export function CostWorkspace() {
  const { detail, latestJob, runGenerator, running, requestErrors, retryJob } = useProject();
  if (!detail) return null;
  const job = latestJob("cost");
  const out = job?.status === "succeeded" ? (job.output as unknown as CostEstimateOutput) : null;
  const initial: CostInputs = out
    ? costInputsFromOutput(out)
    : { currency: detail.current_spec.budget.currency || "INR", region: "", price_date: "", contingency_percent: 10, materials: [], labour: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8">
      <div>
        <h2 className="font-display text-2xl">Cost Estimate</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Adds up the prices <em>you</em> enter. The app has no price data, so it never fills in a price, a fabric length or a tailor&apos;s charge. Materials and labour stay separate, and every assumption is listed with the result.
        </p>
      </div>

      {!out && !running.cost && (
        <EmptyState title="No estimate yet">Press “Fill from my checklist” to list what needs a price (from your saved fabrics and tools &amp; materials), then type in real prices and press Calculate.</EmptyState>
      )}
      <CostForm
        key={job?.id ?? "new"}
        initial={initial}
        busy={!!running.cost}
        onCalculate={(inputs) => runGenerator("cost", inputs as unknown as Record<string, unknown>)}
        onStarter={(meta) => runGenerator("cost", meta)}
      />

      {requestErrors.cost && <Notice tone="err" title="Request failed">{requestErrors.cost}</Notice>}
      {running.cost && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Calculating…
        </p>
      )}
      {job?.status === "failed" && (
        <Notice tone="err" title="Could not calculate" action={<Button size="sm" onClick={() => retryJob(job)}>Retry</Button>}>
          {job.error}
        </Notice>
      )}
      {out && job && (
        <section className="space-y-3 rounded-lg border border-line bg-surface shadow-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-xl">Estimate</h3>
            <JobMeta job={job} />
          </div>
          {job.stale && <p className="text-xs text-wine">The design changed since this estimate ({job.stale_fields.join(", ").replaceAll("_", " ")}). Check the lines, then calculate again.</p>}
          <CostView job={job} full />
        </section>
      )}
    </div>
  );
}
