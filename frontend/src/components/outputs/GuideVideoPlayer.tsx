/* eslint-disable @next/next/no-img-element -- thumbnails come straight from YouTube's image server */
"use client";

import { useState } from "react";
import { clock, embedUrl, playLabel } from "@/lib/stitching";
import type { GuideStep, GuideVideo } from "@/lib/types";

function timingText(video: GuideVideo): string {
  const range = video.end_seconds ? `${clock(video.start_seconds)}–${clock(video.end_seconds)}` : `from ${clock(video.start_seconds)}`;
  if (video.timing === "chapter") return `Video chapter “${video.chapter_title}” · ${range}`;
  if (video.timing === "indexed") return `Start found by an AI that watched the video · ${range}`;
  return "Whole video (it has no chapter for this step)";
}

/**
 * The tutorial for one step. Only the thumbnail loads at first; the YouTube player (privacy-friendly
 * youtube-nocookie.com) is put in when the person presses play, already set to the step's start.
 */
export function GuideVideoPlayer({ step }: { step: GuideStep }) {
  const [playing, setPlaying] = useState(false);
  const video = step.video;

  if (!video) {
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-muted">
        <p>{step.video_status === "not_connected" ? "Video search is not connected, so no video is shown." : "No video found for this step."}</p>
        <a href={step.search_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-wine hover:underline">
          Search “{step.search_query}” on YouTube ↗
        </a>
      </div>
    );
  }

  const src = embedUrl(video);
  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-sunken">
        {playing && src ? (
          <iframe
            src={src}
            title={`${video.title} – ${video.channel}`}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 block h-full w-full"
            aria-label={`${playLabel(video)}: ${video.title}, by ${video.channel}`}
          >
            <img src={video.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            <span className="absolute inset-0 bg-overlay/25 transition group-hover:bg-overlay/40" />
            <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-wine text-on-overlay shadow-lg">
              <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="absolute bottom-2 left-2 right-2 w-fit max-w-[calc(100%-1rem)] rounded bg-overlay/80 px-2 py-0.5 text-xs font-medium text-on-overlay">{playLabel(video)}</span>
            {video.duration && <span className="absolute right-2 top-2 rounded bg-overlay/75 px-1 text-[11px] text-on-overlay">{video.duration}</span>}
          </button>
        )}
      </div>
      <div className="text-xs">
        <a href={video.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-medium hover:text-wine hover:underline">
          {video.title}
        </a>
        <p className="mt-0.5 text-muted">
          Channel: <span className="font-medium text-ink">{video.channel || "unknown"}</span>
        </p>
        <p className="mt-0.5 text-muted">{timingText(video)}</p>
        {video.relevance.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {video.relevance.map((r) => (
              <li key={r} className="text-muted">
                <span className="text-ok">✓</span> {r}
              </li>
            ))}
          </ul>
        )}
      </div>
      {step.more_videos.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-muted">Other videos for this step</p>
          <ul className="mt-1 space-y-1">
            {step.more_videos.map((v) => (
              <li key={v.video_id}>
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-wine hover:underline">
                  {v.title}
                </a>{" "}
                <span className="text-muted">· {v.channel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
