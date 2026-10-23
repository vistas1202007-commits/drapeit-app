/* eslint-disable @next/next/no-img-element -- generated images come from our own API or an SVG data URL */
import Link from "next/link";
import { generatedImageSrc } from "@/lib/format";
import { SKETCH_STYLES, type GenerationJob, type PreviewOutput, type SketchOutput } from "@/lib/types";

/** Shows one generated picture (sketch or visual preview) with honest labels. */
function GeneratedImage({ job, title, out, compact, downloadName }: { job: GenerationJob; title: string; out: SketchOutput | PreviewOutput; compact: boolean; downloadName: string }) {
  const src = generatedImageSrc(out);
  if (!src) return <p className="text-sm text-muted">No image data.</p>;
  return (
    <figure className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <a href={src} target="_blank" rel="noreferrer" className="shrink-0" title="Open full size">
        <img src={src} alt={out.caption} className={`rounded-md border border-line bg-canvas ${compact ? "w-32" : "w-full max-w-[280px]"}`} />
      </a>
      <figcaption className="min-w-0 space-y-2 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-muted">{out.caption}</p>
        <p className="text-xs text-muted">
          This is a generated picture, not editable vector artwork. To draw over it, place it in the{" "}
          <Link href={`/projects/${job.project_id}/studio`} className="text-wine hover:underline">
            Design Studio
          </Link>{" "}
          as a reference layer. It is saved in the image library with design version {job.version_number}.
        </p>
        {out.svg && !out.asset_id ? (
          <a href={src} download={downloadName} className="inline-block text-xs text-wine hover:underline">
            Download image (SVG)
          </a>
        ) : (
          <a href={src} target="_blank" rel="noreferrer" className="inline-block text-xs text-wine hover:underline">
            Open full size (right-click to save)
          </a>
        )}
        {out.prompt && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-ink">What was asked of the image model</summary>
            <p className="mt-1 whitespace-pre-line rounded-md bg-sunken px-2 py-1.5">{out.prompt}</p>
          </details>
        )}
      </figcaption>
    </figure>
  );
}

export function SketchView({ job, compact = false }: { job: GenerationJob; compact?: boolean }) {
  const out = job.output as unknown as SketchOutput;
  const label = SKETCH_STYLES.find((s) => s.id === out.style)?.label ?? out.style;
  return <GeneratedImage job={job} out={out} title={label} compact={compact} downloadName={`sketch-${out.style}.svg`} />;
}

export function PreviewView({ job, compact = false }: { job: GenerationJob; compact?: boolean }) {
  const out = job.output as unknown as PreviewOutput;
  return <GeneratedImage job={job} out={out} title="Visual preview" compact={compact} downloadName="visual-preview.svg" />;
}
