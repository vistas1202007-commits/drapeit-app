/* eslint-disable @next/next/no-img-element -- thumbnails come straight from YouTube's image server */
import type { TutorialVideo } from "@/lib/types";

/** A real video from the search provider. Opens on YouTube in a new tab. */
export function VideoCard({ video, compact = false }: { video: TutorialVideo; compact?: boolean }) {
  return (
    <li className="@container rounded-lg border border-line bg-surface shadow-card p-2.5">
      <div className="flex flex-col gap-2 @min-[22rem]:flex-row @min-[22rem]:gap-3">
      <a href={video.url} target="_blank" rel="noopener noreferrer" className="relative block w-full max-w-60 shrink-0 self-start overflow-hidden rounded @min-[22rem]:w-36 @lg:w-44">
        <img src={video.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-full bg-sunken object-cover" />
        {video.duration && <span className="absolute bottom-1 right-1 rounded bg-overlay/75 px-1 text-[11px] text-on-overlay">{video.duration}</span>}
      </a>
      <div className="min-w-0 text-sm">
        <a href={video.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-medium hover:text-wine hover:underline">
          {video.title}
        </a>
        <p className="mt-0.5 text-xs text-muted">
          {video.channel}
          {video.published_at && ` · ${video.published_at}`}
        </p>
        {!compact && video.relevance.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {video.relevance.map((r) => (
              <li key={r} className="text-muted">
                <span className="text-ok">✓</span> {r}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </li>
  );
}
