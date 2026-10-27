// Small helpers for the Stitching Guide, kept free of React so they can be tested.
import type { GuidePhase, GuideStep, GuideVideo } from "./types";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** "190" -> "3:10", "3723" -> "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/**
 * The privacy-friendly YouTube player address for a video, starting (and ending) where the step is shown.
 * Returns null for anything that is not a real video id, so nothing else can ever be put in the frame.
 */
export function embedUrl(video: Pick<GuideVideo, "video_id" | "start_seconds" | "end_seconds">, autoplay = true): string | null {
  if (!VIDEO_ID.test(video.video_id)) return null;
  const params = new URLSearchParams({ rel: "0", playsinline: "1" });
  if (video.start_seconds > 0) params.set("start", String(Math.floor(video.start_seconds)));
  if (video.end_seconds && video.end_seconds > video.start_seconds) params.set("end", String(Math.floor(video.end_seconds)));
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${video.video_id}?${params.toString()}`;
}

/** What the play button says: where the video starts, and for how long the step runs. */
export function playLabel(video: GuideVideo): string {
  if (video.start_seconds <= 0 && !video.end_seconds) return "Play video";
  const range = video.end_seconds ? ` (to ${clock(video.end_seconds)})` : "";
  return `Play from ${clock(video.start_seconds)}${range}`;
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
  /** The first step not yet ticked, or null when everything is done. */
  next: GuideStep | null;
}

export function progress(steps: GuideStep[], done: Set<string>): Progress {
  const total = steps.length;
  const count = steps.filter((s) => done.has(s.key)).length;
  return { done: count, total, percent: total ? Math.round((count / total) * 100) : 0, next: steps.find((s) => !done.has(s.key)) ?? null };
}

/** Steps grouped under their phase, in the order the guide gives them. */
export function byPhase(steps: GuideStep[]): { phase: GuidePhase; label: string; steps: GuideStep[] }[] {
  const groups: { phase: GuidePhase; label: string; steps: GuideStep[] }[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.phase === step.phase) last.steps.push(step);
    else groups.push({ phase: step.phase, label: step.phase_label, steps: [step] });
  }
  return groups;
}

/** Ticks that still belong to this guide (a step can disappear when the guide is regenerated). */
export function knownTicks(steps: GuideStep[], keys: string[]): Set<string> {
  const valid = new Set(steps.map((s) => s.key));
  return new Set(keys.filter((k) => valid.has(k)));
}
