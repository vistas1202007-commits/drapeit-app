import { describe, expect, it } from "vitest";
import { byPhase, clock, embedUrl, knownTicks, playLabel, progress } from "./stitching";
import type { GuideStep, GuideVideo } from "./types";

function step(key: string, phase: GuideStep["phase"], label: string = phase): GuideStep {
  return {
    key, number: 1, phase, phase_label: label, title: key, module_slug: key, module_title: key, why: "", instructions: [],
    tips: [], fabric_tips: [], video: null, more_videos: [], video_status: "none", search_query: "", search_url: "",
  };
}

function video(over: Partial<GuideVideo> = {}): GuideVideo {
  return {
    video_id: "DDDDDDDDDDD", title: "Darts", channel: "Sew School", url: "", thumbnail_url: "", duration: "9:30",
    start_seconds: 0, end_seconds: null, timing: "whole_video", chapter_title: "", relevance: [], ...over,
  };
}

describe("clock", () => {
  it("formats seconds like YouTube does", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(190)).toBe("3:10");
    expect(clock(3723)).toBe("1:02:03");
  });
});

describe("embedUrl", () => {
  it("starts and ends the privacy-friendly player at the step", () => {
    const url = new URL(embedUrl(video({ start_seconds: 190, end_seconds: 400 }))!);
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe("/embed/DDDDDDDDDDD");
    expect(url.searchParams.get("start")).toBe("190");
    expect(url.searchParams.get("end")).toBe("400");
    expect(url.searchParams.get("autoplay")).toBe("1");
  });

  it("leaves out start and end for a whole video", () => {
    const url = new URL(embedUrl(video(), false)!);
    expect(url.searchParams.has("start")).toBe(false);
    expect(url.searchParams.has("end")).toBe(false);
    expect(url.searchParams.has("autoplay")).toBe(false);
  });

  it("refuses anything that is not a real video id", () => {
    expect(embedUrl(video({ video_id: "x\"><script>" }))).toBeNull();
    expect(embedUrl(video({ video_id: "short" }))).toBeNull();
  });
});

describe("playLabel", () => {
  it("says where the video starts", () => {
    expect(playLabel(video())).toBe("Play video");
    expect(playLabel(video({ start_seconds: 190, end_seconds: 400 }))).toBe("Play from 3:10 (to 6:40)");
    expect(playLabel(video({ start_seconds: 95 }))).toBe("Play from 1:35");
  });
});

describe("progress and grouping", () => {
  const steps = [step("prepare", "prep", "Prep & cutting"), step("cut", "prep", "Prep & cutting"), step("darts", "shaping", "Shaping"), step("hem", "hem", "Hem")];

  it("counts ticks and finds the next step", () => {
    expect(progress(steps, new Set())).toMatchObject({ done: 0, total: 4, percent: 0 });
    const half = progress(steps, new Set(["prepare", "cut"]));
    expect(half).toMatchObject({ done: 2, percent: 50 });
    expect(half.next?.key).toBe("darts");
    expect(progress(steps, new Set(steps.map((s) => s.key))).next).toBeNull();
    expect(progress([], new Set()).percent).toBe(0);
  });

  it("groups steps under their phase in order", () => {
    expect(byPhase(steps).map((g) => [g.label, g.steps.length])).toEqual([["Prep & cutting", 2], ["Shaping", 1], ["Hem", 1]]);
  });

  it("ignores ticks for steps that are no longer in the guide", () => {
    expect([...knownTicks(steps, ["darts", "old-step"])]).toEqual(["darts"]);
  });
});
