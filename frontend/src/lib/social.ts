import type { ExploreFilterChoice, FollowStatus, PostTags, ReportReason, Role, Visibility } from "./types";

export const VISIBILITY: { id: Visibility; label: string; help: string }[] = [
  { id: "public", label: "Public", help: "Everyone with a Drapeit account can see it." },
  { id: "followers", label: "Followers", help: "Only people who follow you (and your Close Friends)." },
  { id: "close_friends", label: "Close Friends", help: "Only the people on your Close Friends list." },
  { id: "private", label: "Private", help: "Only you." },
];

export const VISIBILITY_LABEL: Record<Visibility, string> = Object.fromEntries(VISIBILITY.map((v) => [v.id, v.label])) as Record<Visibility, string>;

export const ROLES: { id: Role; label: string }[] = [
  { id: "designer", label: "Designer" },
  { id: "tailor", label: "Tailor" },
  { id: "boutique", label: "Boutique" },
  { id: "student", label: "Student" },
  { id: "other", label: "Other" },
];

export const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.id, r.label])) as Record<Role, string>;

export const USERNAME_RULE = /^[a-z0-9_.]{3,30}$/;

/** What the username box should hold: no @, lowercase, no spaces. */
export function cleanUsername(text: string): string {
  return text.trim().replace(/^@+/, "").toLowerCase();
}

/** Why a username will be refused, or null if it looks fine. */
export function usernameProblem(text: string): string | null {
  const name = cleanUsername(text);
  if (name.length < 3) return "Use at least 3 characters.";
  if (name.length > 30) return "Use at most 30 characters.";
  if (!USERNAME_RULE.test(name)) return "Use only lowercase letters, numbers, dots and underscores.";
  return null;
}

/** The tags of a post as short labels, skipping empty ones. */
export function tagList(tags: PostTags): string[] {
  return [tags.garment, tags.fabric, tags.occasion].map((t) => t.trim()).filter(Boolean);
}

/** "1 like", "2 likes" */
export function countLabel(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Up to two letters for an avatar placeholder. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

// ----- Phase 6B -----

/** What the follow button says for each state. */
export function followLabel(status: FollowStatus, isPrivate: boolean): string {
  if (status === "following") return "Following";
  if (status === "requested") return "Requested";
  return isPrivate ? "Request to follow" : "Follow";
}

export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: "spam", label: "Spam or fake account" },
  { id: "copied_design", label: "Copied my design (no credit)" },
  { id: "harassment", label: "Bullying or harassment" },
  { id: "hate", label: "Hate speech" },
  { id: "nudity", label: "Nudity or sexual content" },
  { id: "violence", label: "Violence or threats" },
  { id: "scam", label: "Scam or fraud" },
  { id: "false_information", label: "False information" },
  { id: "other", label: "Something else" },
];

/** The full address of a post, for "Copy link". */
export function postLink(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/p/${id}`;
}

/** "#anarkali" style label for a tag. */
export function hashtag(text: string): string {
  return `#${text.replace(/\s+/g, "").toLowerCase()}`;
}

export const NO_FILTERS: ExploreFilterChoice = { garment: "", occasion: "", colour: "", fabric: "" };

/** How many Explore filters are switched on. */
export function activeFilterCount(filters: ExploreFilterChoice): number {
  return Object.values(filters).filter((v) => v.trim()).length;
}
