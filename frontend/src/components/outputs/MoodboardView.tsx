/* eslint-disable @next/next/no-img-element -- pictures are served by our own API */
import { api } from "@/lib/api";
import type { GenerationJob, MoodboardOutput } from "@/lib/types";
import { Swatch } from "./Swatch";

const isHex = (h: string) => /^#[0-9a-f]{3,8}$/i.test(h);

export function MoodboardView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as MoodboardOutput;
  return (
    <div className="@container space-y-4 text-sm">
      <div className="rounded-lg border border-line bg-paper p-4">
        <p className="font-display text-xl text-wine">{out.title}</p>
        <p className="mt-1 leading-relaxed">{out.story}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {out.mood_words.map((w) => (
            <li key={w} className="rounded-full border border-wine/30 px-2.5 py-0.5 font-display text-sm italic text-wine">
              {w}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 @md:grid-cols-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
          {out.palette.map((c) => (
            <div key={c.name + c.role} className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              <div className="h-20" style={{ backgroundColor: isHex(c.hex) ? c.hex : "var(--color-line-strong)" }} aria-hidden />
              <div className="px-2 py-1.5">
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-[11px] text-muted">
                  {c.role} · {c.hex}
                </p>
              </div>
            </div>
          ))}
          {out.textures.map((t) => (
            <div key={t.name} className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              <Swatch colour={isHex(t.colour) ? t.colour : "var(--color-line-strong)"} texture={t.texture} className="h-20 w-full rounded-none border-0" />
              <div className="px-2 py-1.5">
                <p className="text-xs font-medium">{t.name}</p>
                {t.note && <p className="text-[11px] text-muted">{t.note}</p>}
              </div>
            </div>
          ))}
        </div>
        {out.image_asset_ids.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {out.image_asset_ids.map((id) => (
              <img key={id} src={api.assetUrl(id)} alt="Picture from this project" className="aspect-[3/4] w-full rounded-lg border border-line bg-canvas object-cover" />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-4 text-xs text-faint">Generate a sketch or preview, or upload reference pictures, and they will appear on the board next time.</p>
        )}
      </div>

      <div className="grid gap-3 @md:grid-cols-2">
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Motifs</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {out.motifs.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Look at</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {out.references.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </div>
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
