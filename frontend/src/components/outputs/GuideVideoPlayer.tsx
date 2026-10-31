/* eslint-disable @next/next/no-img-element -- thumbnails come straight from YouTube's image server */
"use client";

import { useRef, useState } from "react";
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
  const [mediaError, setMediaError] = useState("");
  const correctingSeek = useRef(false);
  const video = step.video;

  function seekToStart(player: HTMLVideoElement) {
    if (!video || player.seeking) return;
    if (!Number.isFinite(player.duration) || video.start_seconds >= player.duration
        || (video.end_seconds && video.end_seconds > player.duration + 0.05)) {
      player.pause();
      setMediaError("This source cannot play the selected clip range. Check the source video.");
      return;
    }
    correctingSeek.current = true;
    player.currentTime = video.start_seconds;
  }

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

  if (video.source === "hosted" && video.media_url?.startsWith("https://")) {
    return (
      <div className="space-y-2">
        <video controls playsInline preload="metadata" className="aspect-video w-full rounded-md bg-sunken"
          aria-label={video.title} src={video.media_url}
          onLoadedMetadata={(e) => {
            correctingSeek.current = false;
            setMediaError("");
            if (video.start_seconds > 0) seekToStart(e.currentTarget);
          }}
          onPlay={(e) => {
            if (e.currentTarget.currentTime < video.start_seconds || (video.end_seconds && e.currentTarget.currentTime >= video.end_seconds))
              seekToStart(e.currentTarget);
          }}
          onSeeked={(e) => {
            // A seeking event still reports the previous position. Correct only after completion.
            if (e.currentTarget.currentTime < video.start_seconds - 0.05) {
              if (correctingSeek.current) {
                correctingSeek.current = false;
                e.currentTarget.pause();
                setMediaError("This source could not seek to the selected demonstration.");
              } else seekToStart(e.currentTarget);
            } else correctingSeek.current = false;
          }}
          onError={() => setMediaError("This video is unavailable or unsupported by your browser. Open the source below.")}
          onTimeUpdate={(e) => {
            if (video.end_seconds && e.currentTarget.currentTime >= video.end_seconds) e.currentTarget.pause();
          }} />
        {mediaError && <p role="alert" className="text-xs text-wine">{mediaError}</p>}
        <p className="text-xs">Reviewed demonstration: {video.title}</p>
        <p className="text-xs text-muted">Reviewed by {video.reviewed_by}. {video.license_note}</p>
        <a className="text-xs text-wine" href={video.url} target="_blank" rel="noopener noreferrer">Source and attribution ↗</a>
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
            {video.thumbnail_url && <img src={video.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
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
        <p className="mt-1 text-muted">
          {video.evidence === "reviewed" ? `Reviewed by ${video.reviewed_by}. ${video.license_note}`
            : video.evidence === "indexed" ? "AI located this technique; check that its method fits your pattern."
            : video.timing === "chapter" ? "Chapter matched by its title; check the demonstrated method before following it."
            : "Unverified search result: no matching demonstration has been confirmed for this step."}
        </p>
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
