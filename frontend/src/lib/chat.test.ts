import { describe, expect, it } from "vitest";
import { badgeLabel, dayLabel, mergeMessages, newDay, notificationText } from "./chat";
import type { NotificationItem } from "./types";

const base: NotificationItem = {
  id: "n1",
  type: "like",
  actor: { user_id: "u1", username: "meera", display_name: "Meera", has_avatar: false, avatar_version: null },
  post_id: "p1",
  post_image_id: null,
  comment_id: null,
  comment_excerpt: null,
  conversation_id: null,
  created_at: "2026-10-23T10:00:00.000Z",
  read: false,
  request_pending: false,
  following_actor: false,
};

describe("notificationText", () => {
  it("links each kind to the right page", () => {
    expect(notificationText(base)).toEqual({ text: "liked your post.", href: "/p/p1" });
    expect(notificationText({ ...base, type: "comment" }).href).toBe("/p/p1#comments");
    expect(notificationText({ ...base, type: "follow", post_id: null }).href).toBe("/u/meera");
    expect(notificationText({ ...base, type: "message", post_id: null, conversation_id: "c1" }).href).toBe("/messages/c1");
    expect(notificationText({ ...base, type: "follow_request", request_pending: true }).text).toBe("asked to follow you.");
  });

  it("tells mentions in comments and captions apart", () => {
    expect(notificationText({ ...base, type: "mention", comment_id: "c1" }).text).toBe("mentioned you in a comment:");
    expect(notificationText({ ...base, type: "mention" }).text).toBe("mentioned you in a post.");
  });
});

describe("chat helpers", () => {
  it("caps the badge number", () => {
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(12)).toBe("9+");
  });

  it("names today and yesterday", () => {
    const now = new Date(2026, 9, 23, 18, 0);
    expect(dayLabel(new Date(2026, 9, 23, 9, 0).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 22, 23, 30).toISOString(), now)).toBe("Yesterday");
    expect(newDay(null, now.toISOString())).toBe(true);
    expect(newDay(new Date(2026, 9, 23, 9).toISOString(), now.toISOString())).toBe(false);
  });

  it("merges pages and live updates without duplicates, oldest first", () => {
    const a = { id: "a", created_at: "2026-10-23T10:00:00.000Z" };
    const b = { id: "b", created_at: "2026-10-23T10:01:00.000Z" };
    const c = { id: "c", created_at: "2026-10-23T10:02:00.000Z" };
    expect(mergeMessages([a, b], [b, c]).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mergeMessages([c], [a]).map((m) => m.id)).toEqual(["a", "c"]);
  });
});
