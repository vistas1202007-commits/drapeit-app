"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { GenerationJob, VideoOutput } from "@/lib/types";
import { VideoCard } from "./VideoCard";
import { StitchingGuideView } from "./StitchingGuideView";

export function VideoView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as VideoOutput;
  const [copied, setCopied] = useState(false);
  const total = out.scenes.reduce((sum, s) => sum + s.seconds, 0);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(`${out.title}\n\n${out.script}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (out.stitching_guide) {
    return (
      <div className="space-y-4 text-sm">
        <p className="font-display text-lg">Personalized stitching video guide</p>
        <StitchingGuideView job={{ ...job, output: out.stitching_guide as unknown as Record<string, unknown> }} />
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-medium">Optional filming storyboard and narration</summary>
          <p className="mt-2 text-xs text-muted">This script is a filming plan. The demonstrations above use existing footage.</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{out.script}</pre>
          <Button size="sm" className="mt-2" onClick={copyScript}>{copied ? "Copied" : "Copy script"}</Button>
        </details>
      </div>
    );
  }

  return (
    <div className="@container space-y-4 text-sm">
      {out.mode === "storyboard" && (
        <Notice tone="warn" title="Storyboard and script (no video generated)">
          {out.provider_note}
        </Notice>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg">{out.title}</p>
        <p className="text-xs text-muted">
          {out.scenes.length} scenes · about {Math.round(total / 60)} min
        </p>
      </div>
      <ol className="space-y-2">
        {out.scenes.map((s) => (
          <li key={s.number} className="grid gap-x-3 rounded-lg border border-line bg-paper p-3 @md:grid-cols-[3.5rem_minmax(0,1fr)]">
            <div className="font-display text-2xl italic text-wine">
              {String(s.number).padStart(2, "0")}
              <span className="block text-[11px] not-italic text-muted">{s.seconds}s</span>
            </div>
            <div className="min-w-0">
              <p className="font-medium">{s.title}</p>
              <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">Shot</dt>
                <dd>{s.shot}</dd>
                <dt className="text-muted">Action</dt>
                <dd>{s.action}</dd>
                <dt className="text-muted">Say</dt>
                <dd className="italic">“{s.narration}”</dd>
                {s.on_screen_text && (
                  <>
                    <dt className="text-muted">On screen</dt>
                    <dd className="font-medium">{s.on_screen_text}</dd>
                  </>
                )}
              </dl>
            </div>
          </li>
        ))}
      </ol>
      <details className="rounded-lg border border-line bg-surface shadow-card p-3">
        <summary className="cursor-pointer text-sm font-medium">Full narration script</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{out.script}</pre>
        <Button size="sm" className="mt-2" onClick={copyScript}>
          {copied ? "Copied" : "Copy script"}
        </Button>
      </details>
      {out.tutorial_videos.length > 0 && (
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Real tutorials showing these steps</p>
          <ul className="mt-2 space-y-2">
            {out.tutorial_videos.map((v) => (
              <VideoCard key={v.video_id} video={v} compact />
            ))}
          </ul>
        </section>
      )}
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
