import { describe, expect, it } from "vitest";
import { cleanWords, daysLeft, formatDuration, localDay } from "./activity";
import { LANGUAGES, translate } from "./i18n";

describe("activity helpers", () => {
  it("uses the local date, not UTC", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("formats time spent", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(30)).toBe("less than a minute");
    expect(formatDuration(12 * 60)).toBe("12 min");
    expect(formatDuration(65 * 60)).toBe("1 h 5 min");
    expect(formatDuration(120 * 60)).toBe("2 h");
  });

  it("counts the days left in Recently deleted", () => {
    const now = Date.UTC(2026, 9, 23);
    expect(daysLeft(new Date(now).toISOString(), 30, now)).toBe(30);
    expect(daysLeft(new Date(now - 29.5 * 86_400_000).toISOString(), 30, now)).toBe(1);
    expect(daysLeft(new Date(now - 40 * 86_400_000).toISOString(), 30, now)).toBe(0);
  });

  it("cleans hidden words", () => {
    expect(cleanWords(" Cheap,cheap ,  FAKE copy\n\n,, ")).toEqual(["cheap", "fake copy"]);
  });
});

describe("translations", () => {
  it("translates the menu and falls back to English", () => {
    expect(translate("hi", "nav.settings")).toBe("सेटिंग्स");
    expect(translate("hinglish", "common.save")).toBe("Save karo");
    expect(translate("en", "nav.settings")).toBe("Settings");
    expect(LANGUAGES.map((l) => l.id)).toEqual(["en", "hi", "hinglish"]);
  });
});
