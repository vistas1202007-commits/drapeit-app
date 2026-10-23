import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import type { GenerationJob, TutorialOutput } from "@/lib/types";
import { VideoCard } from "./VideoCard";

const LANGUAGE: Record<string, string> = { any: "any language", en: "English", hi: "Hindi" };

export function TutorialView({ job }: { job: GenerationJob }) {
  const out = job.output as unknown as TutorialOutput;
  const byId = new Map(out.videos.map((v) => [v.video_id, v]));
  return (
    <div className="space-y-4 text-sm">
      {!out.connected && (
        <Notice tone="warn" title="Tutorial search is not connected">
          No videos are shown, because the app never makes up video titles or links. Add a free <code>YOUTUBE_API_KEY</code> to <code>backend/.env</code> (see the README), restart
          the backend and generate again. Until then, each step below links to the same search on YouTube.
        </Notice>
      )}
      <p className="text-xs text-muted">
        Learning guide · {out.source} · {LANGUAGE[out.language] ?? out.language}
      </p>
      <ol className="space-y-4">
        {out.steps.map((step, i) => (
          <li key={step.topic}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                <span className="mr-1.5 font-display italic text-wine">{i + 1}.</span>
                {step.topic}
              </p>
              <a href={step.search_url} target="_blank" rel="noopener noreferrer" className="text-xs text-wine hover:underline">
                Search “{step.search_query}” on YouTube ↗
              </a>
            </div>
            <p className="text-xs text-muted">{step.why}</p>
            {step.video_ids.length > 0 && (
              <ul className="mt-2 space-y-2">
                {step.video_ids.map((id) => {
                  const video = byId.get(id);
                  return video ? <VideoCard key={id} video={video} /> : null;
                })}
              </ul>
            )}
            {out.connected && step.video_ids.length === 0 && <p className="mt-1 text-xs text-faint">No suitable video found for this step. Try the search link.</p>}
          </li>
        ))}
      </ol>
      {out.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
      <p className="text-xs text-muted">
        Search for anything else in the{" "}
        <Link href="/resources" className="text-wine hover:underline">
          Learning Library
        </Link>
        .
      </p>
    </div>
  );
}
