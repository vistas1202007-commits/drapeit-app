// Small helpers for chats and notifications (Phase 6C), kept free of React so they can be tested.

import type { AllowMessages, NotificationItem, NotificationSettings } from "./types";

export const MESSAGING_CHOICES: { id: AllowMessages; label: string; help: string }[] = [
  { id: "everyone", label: "Everyone", help: "Anyone with a profile can write to you. People you do not follow land in Requests." },
  { id: "followers", label: "Followers", help: "Only people who follow you can start a chat." },
  { id: "nobody", label: "Nobody", help: "Nobody can start a new chat with you." },
];

export const NOTIFICATION_SETTINGS: { id: keyof NotificationSettings; label: string; help: string }[] = [
  { id: "likes", label: "Likes", help: "Someone likes your post." },
  { id: "comments", label: "Comments", help: "Someone comments on your post." },
  { id: "replies", label: "Replies", help: "Someone replies to your comment." },
  { id: "mentions", label: "Mentions", help: "Someone writes your @username in a comment or caption." },
  { id: "reposts", label: "Reposts", help: "Someone reposts your design." },
  { id: "follows", label: "New followers", help: "Someone starts following you." },
  { id: "follow_requests", label: "Follow requests", help: "Someone asks to follow your private account." },
  { id: "messages", label: "Messages", help: "Someone sends you a message or a message request." },
];

/** What a notification says (after the person's name) and where pressing it goes. */
export function notificationText(n: NotificationItem): { text: string; href: string } {
  const post = n.post_id ? `/p/${n.post_id}` : "/notifications";
  const profile = n.actor ? `/u/${n.actor.username}` : "/notifications";
  switch (n.type) {
    case "like":
      return { text: "liked your post.", href: post };
    case "comment":
      return { text: "commented on your post:", href: `${post}#comments` };
    case "reply":
      return { text: "replied to your comment:", href: `${post}#comments` };
    case "mention":
      return { text: n.comment_id ? "mentioned you in a comment:" : "mentioned you in a post.", href: n.comment_id ? `${post}#comments` : post };
    case "repost":
      return { text: "reposted your design.", href: post };
    case "follow":
      return { text: "started following you.", href: profile };
    case "follow_request":
      return { text: n.request_pending ? "asked to follow you." : "asked to follow you (answered).", href: "/requests" };
    case "message":
      return { text: "sent you a message.", href: n.conversation_id ? `/messages/${n.conversation_id}` : "/messages" };
  }
}

/** "3", or "9+" when there are many. */
export function badgeLabel(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/** "Today", "Yesterday" or a date, for the day lines in a chat. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** "10:42 am", the time under a message. */
export function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** True when two times fall on different days (a day line goes between them). */
export function newDay(previous: string | null, current: string): boolean {
  if (!previous) return true;
  return new Date(previous).toDateString() !== new Date(current).toDateString();
}

/** Messages by id, oldest first, without duplicates (live updates and pages can overlap). */
export function mergeMessages<T extends { id: string; created_at: string }>(older: T[], newer: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of [...older, ...newer]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
