import { api } from "./api";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "3 min ago", "2 days ago", ... */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

export const GARMENT_CATEGORIES = [
  "Anarkali",
  "Kurta",
  "Kurti",
  "Salwar suit",
  "Lehenga",
  "Saree blouse",
  "Blouse",
  "Sherwani",
  "Dress",
  "Maxi dress",
  "Gown",
  "Skirt",
  "Shirt",
  "Top",
  "Jacket",
  "Blazer",
  "Jumpsuit",
  "Trousers",
];

export function svgDataUrl(svg: string): string {
  // Showing SVG through <img src="data:..."> means any script inside it can never run.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Where to load a generated picture from. Real AI images are saved as assets
 * on the backend; built-in (mock) sketches also carry their SVG text inline.
 */
export function generatedImageSrc(out: { asset_id: string | null; svg: string | null } | null | undefined): string | null {
  if (!out) return null;
  if (out.asset_id) return api.assetUrl(out.asset_id);
  if (out.svg) return svgDataUrl(out.svg);
  return null;
}

/** Money in US dollars with a rough rupee value, for cost displays. */
export function formatUsd(usd: number): string {
  const inr = usd * 88; // approximate rate (October 2026)
  return `$${usd.toFixed(usd < 1 ? 3 : 2)} (≈ ₹${inr < 10 ? inr.toFixed(1) : Math.round(inr)})`;
}
