import { Badge } from "@/components/ui/Badge";
import type { EmbroideryOutput, GenerationJob, Placement } from "@/lib/types";

const isHex = (h: string) => /^#[0-9a-f]{3,8}$/i.test(h);

const PLACEMENT_LABEL: Record<Placement, string> = {
  neckline: "Neckline",
  yoke: "Yoke",
  bodice: "Bodice",
  sleeves: "Sleeves",
  cuffs: "Cuffs",
  waist: "Waist",
  hem: "Hem",
  back: "Back",
  dupatta: "Dupatta",
  all_over: "All over",
};

// A simple flat garment (front and back) drawn in a 100-wide box; each zone can be highlighted.
const BODY = "M30 30 L41 30 Q50 42 59 30 L70 30 L88 80 L78 84 L68 50 L68 95 L88 190 L12 190 L32 95 L32 50 L22 84 L12 80 Z";
const ZONES: Partial<Record<Placement, string>> = {
  neckline: "M38 30 L41 30 Q50 42 59 30 L62 30 Q50 50 38 30 Z",
  yoke: "M32 30 L68 30 L68 52 L32 52 Z",
  bodice: "M32 30 L68 30 L68 95 L32 95 Z",
  sleeves: "M30 30 L12 80 L22 84 L32 50 Z M70 30 L88 80 L78 84 L68 50 Z",
  cuffs: "M12 80 L22 84 L20 90 L10 86 Z M88 80 L78 84 L80 90 L90 86 Z",
  waist: "M31 89 L69 89 L70 97 L30 97 Z",
  hem: "M15 176 L85 176 L88 190 L12 190 Z",
};

function Figure({ x, label, zones }: { x: number; label: string; zones: Placement[] }) {
  return (
    <g transform={`translate(${x} 0)`}>
      {zones.includes("all_over") && <path d={BODY} fill="var(--color-wine)" fillOpacity={0.18} />}
      {zones.map((z) => ZONES[z] && <path key={z} d={ZONES[z]} fill="var(--color-wine)" fillOpacity={0.45} />)}
      <path d={BODY} fill="none" stroke="var(--color-ink)" strokeWidth={1.2} strokeLinejoin="round" />
      <text x={50} y={205} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
        {label}
      </text>
    </g>
  );
}

/** Front and back flats with the chosen placements shaded. */
export function PlacementMap({ placements }: { placements: Placement[] }) {
  const shared = placements.filter((p) => p !== "back" && p !== "dupatta");
  const back: Placement[] = [...shared.filter((p) => p !== "neckline" && p !== "yoke" && p !== "bodice"), ...(placements.includes("back") ? (["bodice", "all_over"] as Placement[]) : [])];
  const dupatta = placements.includes("dupatta");
  return (
    <svg viewBox="0 0 250 212" className="h-40 w-auto max-w-full" role="img" aria-label={`Placement: ${placements.map((p) => PLACEMENT_LABEL[p]).join(", ")}`}>
      <Figure x={0} label="Front" zones={shared} />
      <Figure x={110} label="Back" zones={back} />
      {dupatta && (
        <g>
          <rect x={222} y={20} width={22} height={170} rx={3} fill="var(--color-wine)" fillOpacity={0.35} stroke="var(--color-ink)" strokeWidth={1} />
          <text x={233} y={205} textAnchor="middle" fontSize={9} fill="var(--color-muted)">
            Dupatta
          </text>
        </g>
      )}
    </svg>
  );
}

export function EmbroideryView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as EmbroideryOutput;
  return (
    <div className="@container space-y-3 text-sm">
      <ul className="space-y-3">
        {out.concepts.map((c) => (
          <li key={c.name} className="grid gap-3 rounded-lg border border-line bg-paper p-3 @xl:grid-cols-[auto_minmax(0,1fr)]">
            <PlacementMap placements={c.placements} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-medium">{c.name}</p>
                <Badge tone={c.kind === "print" ? "neutral" : "wine"}>{c.kind}</Badge>
                <Badge>{c.difficulty}</Badge>
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">Technique</dt>
                <dd>{c.technique}</dd>
                <dt className="text-muted">Motif</dt>
                <dd>{c.motif}</dd>
                <dt className="text-muted">Where</dt>
                <dd>
                  {c.placements.map((p) => PLACEMENT_LABEL[p]).join(", ")} · {c.scale} scale
                </dd>
                <dt className="text-muted">Placement</dt>
                <dd>{c.placement_note}</dd>
                <dt className="text-muted">Materials</dt>
                <dd>{c.materials.join(", ")}</dd>
                <dt className="text-muted">Effort</dt>
                <dd>{c.effort_note}</dd>
              </dl>
              <div className="mt-2 flex flex-wrap gap-2">
                {c.colours.map((col) => (
                  <span key={col.name + col.role} className="flex items-center gap-1 text-xs text-muted">
                    <span className="h-4 w-4 rounded-full border border-ink/10" style={{ backgroundColor: isHex(col.hex) ? col.hex : "var(--color-line-strong)" }} aria-hidden />
                    {col.name} ({col.role})
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
