"""Notifications, their settings, and the unread numbers on the menu (Phase 6C).

The notifications themselves are written by database triggers (migration 0008)
whenever someone likes, comments, replies, follows, asks to follow, mentions,
reposts or sends a message. This file only reads them for ONE signed-in user;
Row Level Security shows that user only their own, and only about things they
may still see.
"""

from __future__ import annotations

from typing import Any

from app.schemas.chat import Badges, NotificationItem, NotificationPage, NotificationSettings
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso
from app.storage.social_repository import _decode_cursor, _encode_cursor, person

PAGE_SIZE = 30
SETTING_NAMES = list(NotificationSettings.model_fields)

NOTIFICATION_SELECT = """
SELECT n.*, a.id AS a_id, a.username, a.display_name, a.avatar_path, a.verified,
       (SELECT i.id FROM post_images i WHERE i.post_id = n.post_id ORDER BY i.position LIMIT 1) AS post_image,
       (SELECT left(c.body, 120) FROM comments c WHERE c.id = n.comment_id) AS comment_excerpt,
       (n.type = 'follow_request' AND EXISTS (SELECT 1 FROM follow_requests r
                                             WHERE r.requester_id = n.actor_id AND r.target_id = %(me)s)) AS pending,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = %(me)s AND f.following_id = n.actor_id) AS following_actor
FROM notifications n
LEFT JOIN profiles a ON a.id = n.actor_id
WHERE n.user_id = %(me)s
"""


class NotificationRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    @staticmethod
    def _item(row: dict[str, Any]) -> NotificationItem:
        return NotificationItem(
            id=row["id"], type=row["type"], actor=person({**row, "id": row["a_id"]}) if row["a_id"] else None,
            post_id=row["post_id"], post_image_id=row["post_image"], comment_id=row["comment_id"],
            comment_excerpt=row["comment_excerpt"], conversation_id=row["conversation_id"],
            created_at=iso(row["created_at"]) or "", read=row["read_at"] is not None,
            request_pending=row["pending"], following_actor=row["following_actor"],
        )

    def list(self, cursor: str | None) -> NotificationPage:
        """Newest first, PAGE_SIZE at a time."""
        after = _decode_cursor(cursor)
        query, values = NOTIFICATION_SELECT, {"me": self.user_id, "limit": PAGE_SIZE + 1}
        if after:
            query += " AND (n.created_at, n.id) < (%(t)s, %(i)s)"
            values |= {"t": after[0], "i": after[1]}
        with self._conn() as conn:
            rows = conn.execute(query + " ORDER BY n.created_at DESC, n.id DESC LIMIT %(limit)s", values).fetchall()
        more = len(rows) > PAGE_SIZE
        rows = rows[:PAGE_SIZE]
        next_cursor = _encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if more and rows else None
        return NotificationPage(notifications=[self._item(r) for r in rows], next_cursor=next_cursor)

    def mark_all_read(self) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
                         (self.user_id,))

    def mark_read(self, notification_id: str) -> None:
        with self._conn() as conn:
            done = conn.execute("UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = %s"
                                " AND user_id = %s RETURNING id",
                                (check_id(notification_id, "Notification"), self.user_id)).fetchone()
        if done is None:
            raise NotFoundError("Notification not found")

    def badges(self) -> Badges:
        """Unread notifications (messages have their own number), chats with unread messages, and
        message requests."""
        query = """
        SELECT
          (SELECT count(*) FROM notifications n WHERE n.user_id = %(me)s AND n.read_at IS NULL
             AND n.type <> 'message') AS notifications,
          (SELECT count(*) FROM conversation_members mm
             JOIN conversation_members o ON o.conversation_id = mm.conversation_id AND o.user_id <> mm.user_id
             WHERE mm.user_id = %(me)s AND mm.status = 'accepted' AND NOT has_blocked(o.user_id, %(me)s)
               AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = mm.conversation_id
                             AND m.sender_id <> %(me)s AND m.created_at > COALESCE(mm.last_read_at, '-infinity'))
          ) AS chats,
          (SELECT count(*) FROM conversation_members mm
             JOIN conversation_members o ON o.conversation_id = mm.conversation_id AND o.user_id <> mm.user_id
             WHERE mm.user_id = %(me)s AND mm.status = 'request' AND NOT has_blocked(o.user_id, %(me)s)
               AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = mm.conversation_id)) AS requests
        """
        with self._conn() as conn:
            row = conn.execute(query, {"me": self.user_id}).fetchone()
        return Badges(notifications=row["notifications"], chats=row["chats"], requests=row["requests"])

    # ---------- settings ----------

    def settings(self) -> NotificationSettings:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM notification_settings WHERE user_id = %s", (self.user_id,)).fetchone()
        return NotificationSettings(**{k: row[k] for k in SETTING_NAMES}) if row else NotificationSettings()

    def save_settings(self, choice: NotificationSettings) -> NotificationSettings:
        values = choice.model_dump()
        columns = ", ".join(SETTING_NAMES)
        placeholders = ", ".join(f"%({k})s" for k in SETTING_NAMES)
        updates = ", ".join(f"{k} = excluded.{k}" for k in SETTING_NAMES)
        with self._conn() as conn:
            # Column names come from NotificationSettings, never from the request.
            conn.execute(f"INSERT INTO notification_settings (user_id, {columns}) VALUES (%(me)s, {placeholders})"
                         f" ON CONFLICT (user_id) DO UPDATE SET {updates}, updated_at = now()",
                         values | {"me": self.user_id})
        return self.settings()
