/* eslint-disable @next/next/no-img-element -- profile pictures are served by our own API */
import { api } from "@/lib/api";
import { initials } from "@/lib/social";
import type { PersonSummary } from "@/lib/types";

const SIZES = { sm: "h-8 w-8 text-xs", md: "h-11 w-11 text-sm", lg: "h-20 w-20 text-2xl sm:h-24 sm:w-24" } as const;

export function Avatar({ person, size = "md" }: { person: Pick<PersonSummary, "user_id" | "username" | "display_name" | "has_avatar" | "avatar_version">; size?: keyof typeof SIZES }) {
  const label = person.display_name || person.username;
  if (person.has_avatar) {
    return <img src={api.avatarUrl(person.user_id, person.avatar_version)} alt={`${label}'s profile picture`} className={`${SIZES[size]} shrink-0 rounded-full border border-line bg-sunken object-cover`} />;
  }
  return (
    <span aria-hidden className={`${SIZES[size]} flex shrink-0 items-center justify-center rounded-full border border-wine/20 bg-wine-soft font-display text-wine`}>
      {initials(label)}
    </span>
  );
}
