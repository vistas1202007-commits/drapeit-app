import Link from "next/link";
import type { FabricOutput, GenerationJob } from "@/lib/types";
import { Swatch } from "./Swatch";

export function FabricView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as FabricOutput;
  return (
    <div className="space-y-3 text-sm">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {out.recommendations.map((r) => (
          <li key={r.name} className="space-y-1.5">
            <Swatch colour={r.swatch_colour} texture={r.texture} />
            <p className="font-medium leading-tight">{r.name}</p>
            <p className="text-xs text-muted">Match {r.score}/100</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Details, reasons and saving favourites are in the{" "}
        <Link href={`/projects/${job.project_id}/fabric`} className="text-wine hover:underline">
          Fabric Studio
        </Link>
        .
      </p>
    </div>
  );
}
