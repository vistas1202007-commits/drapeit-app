import type { GenerationJob, PatternOutput } from "@/lib/types";

const BOX = { large: [86, 92], medium: [58, 44], small: [40, 28] } as const;
const FABRIC_H = 100;

type Placed = { n: number; name: string; x: number; y: number; w: number; h: number };

/** Packs the main-fabric pieces into columns along the fabric. Only shows order and direction: NOT TO SCALE. */
export function layoutPieces(pieces: PatternOutput["pieces"]): { placed: Placed[]; length: number } {
  const order = { large: 0, medium: 1, small: 2 };
  const main = pieces.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => p.fabric === "main").sort((a, b) => order[a.size] - order[b.size]);
  const placed: Placed[] = [];
  let colX = 4;
  let colW = 0;
  let y = 4;
  for (const p of main) {
    const [w, h] = BOX[p.size];
    if (y + h > FABRIC_H - 4 && y > 4) {
      colX += colW + 6;
      colW = 0;
      y = 4;
    }
    placed.push({ n: p.n, name: p.name, x: colX, y, w, h });
    colW = Math.max(colW, w);
    y += h + 4;
  }
  return { placed, length: colX + colW + 4 };
}

function LayoutDiagram({ out }: { out: PatternOutput }) {
  const { placed, length } = layoutPieces(out.pieces);
  const width = Math.max(length, 160);
  return (
    <svg viewBox={`-2 -14 ${width + 4} ${FABRIC_H + 30}`} className="h-auto w-full max-w-2xl" role="img" aria-label="Cutting layout, not to scale">
      <rect x={0} y={0} width={width} height={FABRIC_H} fill="var(--color-sunken)" stroke="var(--color-line-strong)" />
      {!out.layout.nap && <line x1={0} y1={0} x2={width} y2={0} stroke="var(--color-wine)" strokeDasharray="4 3" strokeWidth={1.5} />}
      <text x={2} y={-4} fontSize={7} fill="var(--color-wine)">
        {out.layout.nap ? "SINGLE LAYER · pile down · all pieces point one way →" : "FOLD"}
      </text>
      <text x={2} y={FABRIC_H + 9} fontSize={7} fill="var(--color-muted)">
        SELVEDGE · grainline runs this way →
      </text>
      <text x={width - 2} y={FABRIC_H + 9} fontSize={7} fill="var(--color-err)" textAnchor="end" fontWeight={600}>
        NOT TO SCALE
      </text>
      {placed.map((p) => (
        <g key={p.n}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={2} fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth={0.8} />
          <line x1={p.x + 6} y1={p.y + p.h - 6} x2={p.x + p.w - 6} y2={p.y + p.h - 6} stroke="var(--color-muted)" strokeWidth={0.6} markerEnd="url(#arrow)" />
          <text x={p.x + 4} y={p.y + 10} fontSize={8} fontWeight={600} fill="var(--color-wine)">
            {p.n}
          </text>
        </g>
      ))}
      <defs>
        <marker id="arrow" viewBox="0 0 6 6" refX={5} refY={3} markerWidth={5} markerHeight={5} orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--color-muted)" />
        </marker>
      </defs>
    </svg>
  );
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  return s.startsWith("missing") ? "font-medium text-err" : s.startsWith("estimate") ? "font-medium text-warn" : "text-ok";
}

export function PatternView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as PatternOutput;
  return (
    <div className="@container space-y-4 text-sm">
      <div className="rounded-md border-2 border-err/40 bg-err-soft px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-err">Conceptual · not production-ready</p>
        <p className="mt-0.5 text-[13px]">{out.disclaimer}</p>
      </div>
      {out.warnings.slice(1).map((w) => (
        <p key={w} className="text-xs text-warn">
          ⚠ {w}
        </p>
      ))}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Measurements this {out.garment.toLowerCase()} needs ({out.unit})</h4>
        <ul className="mt-1 grid gap-x-4 gap-y-0.5 @lg:grid-cols-2">
          {out.required_measurements.map((m) => (
            <li key={m.name} className="flex justify-between gap-2 border-b border-line/70 py-0.5">
              <span>{m.name}</span>
              <span className={`text-xs ${statusClass(m.status)}`}>{m.value !== "—" ? `${m.value} · ` : ""}{m.status.split(" – ")[0]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Pattern pieces</h4>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-1 font-medium">#</th>
                <th className="py-1 font-medium">Piece</th>
                <th className="py-1 font-medium">Cut</th>
                <th className="py-1 font-medium">Fabric</th>
                <th className="py-1 font-medium">Grain</th>
              </tr>
            </thead>
            <tbody>
              {out.pieces.map((p, i) => (
                <tr key={p.name} className="border-b border-line/70 align-top">
                  <td className="py-1 font-medium text-wine">{i + 1}</td>
                  <td className="py-1">
                    {p.name}
                    {p.notes && <span className="block text-xs text-muted">{p.notes}</span>}
                  </td>
                  <td className="py-1">{p.cut}</td>
                  <td className="py-1 capitalize">{p.fabric}</td>
                  <td className="py-1 text-xs text-muted">{p.grain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Drafting guidance</h4>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {out.drafting_steps.map((s) => (
            <li key={s.step}>
              {s.step}
              {s.note && <span className="text-muted"> {s.note}</span>}
              {s.uses.length > 0 && <span className="block text-xs text-wine">Uses: {s.uses.join(", ")}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Cutting layout (main fabric)</h4>
        <p className="mt-1 text-[13px]">{out.layout.fold}</p>
        <div className="mt-2 rounded-md border border-line bg-surface p-2">
          <LayoutDiagram out={out} />
        </div>
        <p className="mt-1 text-xs text-muted">Numbers match the pieces table. Lining and interfacing are cut separately.</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {out.layout.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
