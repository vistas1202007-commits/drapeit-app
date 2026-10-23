// Helpers for Settings → Your activity and Account (Phase 6D), kept free of React so they can be tested.

/** Today's date where the user is, as YYYY-MM-DD (not UTC). */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "1 h 5 min", "12 min", "less than a minute" */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return seconds > 0 ? "less than a minute" : "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Short weekday name for a YYYY-MM-DD date ("Mon"). */
export function weekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

/** Whole days left before something removed `deletedAt` is gone for good (never below 0). */
export function daysLeft(deletedAt: string, graceDays = 30, now = Date.now()): number {
  const end = new Date(deletedAt).getTime() + graceDays * 86_400_000;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

/** Clean up words typed into the hidden-words box: trimmed, lowercase, no repeats, no empties. */
export function cleanWords(text: string): string[] {
  const words = text
    .split(/[,\n]/)
    .map((w) => w.trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean);
  return [...new Set(words)];
}
