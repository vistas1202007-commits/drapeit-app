"""Direct messages: chats, message requests, "Seen", sharing posts and design
pictures, and the "Who can message me" setting (Phase 6C).

Like the other repositories this works for ONE signed-in user, in that user's
database session, so the Row Level Security rules in
`supabase/migrations/0008_chats_and_notifications.sql` decide what they may read
and send: only the two people in a chat see its messages, and sending is refused
across a block or when the other person does not accept messages from you.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg import Connection

from app.schemas.chat import ChatDetail, ChatList, ChatSummary, Message, MessagePage, SharedPost
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso
from app.storage.social_repository import SocialError, _decode_cursor, _encode_cursor, person, profile_row

MESSAGE_PAGE = 40
INBOX_SIZE = 100
PREVIEW_LENGTH = 80

# The other person in a chat, with their profile (null if it is gone or hidden from you).
CHAT_SELECT = """
SELECT c.id, mm.status, mm.last_read_at, mm.cleared_at, o.user_id AS other_id, o.last_read_at AS other_read_at,
       op.id AS op_id, op.username, op.display_name, op.avatar_path, op.verified
FROM conversation_members mm
JOIN conversations c ON c.id = mm.conversation_id
JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> mm.user_id
LEFT JOIN profiles op ON op.id = o.user_id
WHERE mm.user_id = %(me)s AND {where}
"""

# A message with the post it shares (null when the post is gone or you may not see it).
MESSAGE_SELECT = """
SELECT m.*, p.id AS p_id, p.caption AS p_caption, p.author_id AS p_author,
       pa.username, pa.display_name, pa.avatar_path, pa.verified,
       (SELECT i.id FROM post_images i WHERE i.post_id = p.id ORDER BY i.position LIMIT 1) AS p_image
FROM messages m
LEFT JOIN posts p ON p.id = m.post_id AND p.status = 'published'
LEFT JOIN profiles pa ON pa.id = p.author_id
WHERE {where}
"""


def _other(row: dict[str, Any]) -> Any:
    return person({**row, "id": row["op_id"]}) if row.get("op_id") else None


def preview(kind: str, body: str, mine: bool) -> str:
    """The short line shown under a name in the inbox."""
    if kind == "post":
        text = "Sent a post" if mine else "Shared a post"
    elif kind == "design":
        text = "Sent a design"
    else:
        text = body
    text = " ".join(text.split())
    return text if len(text) <= PREVIEW_LENGTH else text[: PREVIEW_LENGTH - 1] + "…"


class ChatRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    # ---------- settings ----------

    def messaging_setting(self) -> str:
        with self._conn() as conn:
            row = conn.execute("SELECT allow_messages_from FROM profiles WHERE id = %s", (self.user_id,)).fetchone()
        if row is None:
            raise SocialError("Set up your profile (choose a username) first.")
        return row["allow_messages_from"]

    def set_messaging_setting(self, value: str) -> str:
        with self._conn() as conn:
            row = conn.execute("UPDATE profiles SET allow_messages_from = %s, updated_at = now() WHERE id = %s"
                               " RETURNING allow_messages_from", (value, self.user_id)).fetchone()
        if row is None:
            raise SocialError("Set up your profile (choose a username) first.")
        return row["allow_messages_from"]

    # ---------- starting and listing chats ----------

    def _has_profile(self, conn: Connection) -> bool:
        return conn.execute("SELECT 1 FROM profiles WHERE id = %s", (self.user_id,)).fetchone() is not None

    def start(self, username: str) -> str:
        """The chat with this person (started now if the rules allow). Returns its id."""
        with self._conn() as conn:
            row = profile_row(conn, username)  # "not found" if they blocked you
            if row["id"] == self.user_id:
                raise SocialError("You cannot send messages to yourself.")
            if not self._has_profile(conn):
                raise SocialError("Set up your profile (choose a username) first, so people can see who is writing.")
            if conn.execute("SELECT 1 FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                            (self.user_id, row["id"])).fetchone():
                raise SocialError(f"You blocked @{row['username']}. Unblock them to send messages.")
            try:
                with conn.transaction():
                    return conn.execute("SELECT start_conversation(%s) AS id", (row["id"],)).fetchone()["id"]
            except psycopg.errors.InsufficientPrivilege:
                raise SocialError(f"@{row['username']} is not accepting messages from you.") from None

    def chats(self, status: str) -> ChatList:
        """Your chats ("accepted") or message requests ("request"), newest message first.
        A chat only shows once it has a message you can see (deleting it hides older ones)."""
        query = """
        SELECT c.id, mm.status, mm.last_read_at, mm.cleared_at, op.id AS op_id, op.username, op.display_name,
               op.avatar_path, op.verified, lm.kind, lm.body, lm.sender_id, lm.created_at AS lm_at,
               (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.sender_id <> %(me)s
                  AND x.created_at > COALESCE(mm.last_read_at, '-infinity')) AS unread
        FROM conversation_members mm
        JOIN conversations c ON c.id = mm.conversation_id
        JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> mm.user_id
        LEFT JOIN profiles op ON op.id = o.user_id
        JOIN LATERAL (SELECT m.kind, m.body, m.sender_id, m.created_at FROM messages m WHERE m.conversation_id = c.id
                      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) lm ON true
        WHERE mm.user_id = %(me)s AND mm.status = %(status)s AND NOT has_blocked(o.user_id, %(me)s)
        ORDER BY lm.created_at DESC, c.id
        LIMIT %(limit)s
        """
        with self._conn() as conn:
            rows = conn.execute(query, {"me": self.user_id, "status": status, "limit": INBOX_SIZE}).fetchall()
        chats = [
            ChatSummary(id=r["id"], other=_other(r), status=r["status"],
                        last_message=preview(r["kind"], r["body"], r["sender_id"] == self.user_id),
                        last_message_mine=r["sender_id"] == self.user_id, last_message_at=iso(r["lm_at"]) or "",
                        unread_count=r["unread"])
            for r in rows
        ]
        return ChatList(chats=chats, request_count=self.request_count())

    def request_count(self) -> int:
        with self._conn() as conn:
            return conn.execute(
                "SELECT count(*) AS n FROM conversation_members mm"
                " JOIN conversation_members o ON o.conversation_id = mm.conversation_id AND o.user_id <> mm.user_id"
                " WHERE mm.user_id = %(me)s AND mm.status = 'request' AND NOT has_blocked(o.user_id, %(me)s)"
                " AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = mm.conversation_id)",
                {"me": self.user_id},
            ).fetchone()["n"]

    def _chat_row(self, conn: Connection, conversation_id: str) -> dict[str, Any]:
        row = conn.execute(CHAT_SELECT.format(where="c.id = %(c)s"),
                           {"me": self.user_id, "c": check_id(conversation_id, "Chat")}).fetchone()
        if row is None or conn.execute("SELECT has_blocked(%s, %s) AS b", (row["other_id"], self.user_id)).fetchone()["b"]:
            raise NotFoundError("Chat not found")
        return row

    def detail(self, conversation_id: str) -> ChatDetail:
        with self._conn() as conn:
            row = self._chat_row(conn, conversation_id)
            info = conn.execute(
                "SELECT can_send_message(%(c)s) AS can_send,"
                " EXISTS (SELECT 1 FROM blocks WHERE blocker_id = %(me)s AND blocked_id = %(u)s) AS blocked,"
                " (SELECT m.id FROM messages m WHERE m.conversation_id = %(c)s AND m.sender_id = %(me)s"
                "  AND m.created_at <= %(read)s ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS seen",
                {"c": row["id"], "me": self.user_id, "u": row["other_id"], "read": row["other_read_at"]},
            ).fetchone()
            has_profile = self._has_profile(conn)
        other = _other(row)
        reason = None
        if not info["can_send"]:
            if info["blocked"]:
                reason = f"You blocked @{other.username if other else 'this person'}. Unblock them to send messages."
            elif not has_profile:
                reason = "Set up your profile (choose a username) to send messages."
            elif other is None:
                reason = "This account is no longer available."
            else:
                reason = f"@{other.username} is not accepting messages from you right now."
        return ChatDetail(id=row["id"], other=other, status=row["status"], can_send=info["can_send"],
                          cannot_send_reason=reason, blocked_by_me=info["blocked"], seen_message_id=info["seen"])

    # ---------- messages ----------

    def _message(self, row: dict[str, Any]) -> Message:
        post = None
        if row["p_id"] and row["username"]:
            post = SharedPost(id=row["p_id"], author=person({**row, "id": row["p_author"]}), image_id=row["p_image"],
                              caption=(row["p_caption"] or "")[:200])
        return Message(
            id=row["id"], conversation_id=row["conversation_id"], sender_id=row["sender_id"],
            is_mine=row["sender_id"] == self.user_id, kind=row["kind"], body=row["body"], post=post,
            post_unavailable=row["kind"] == "post" and post is None, has_image=bool(row["image_path"]),
            created_at=iso(row["created_at"]) or "",
        )

    def messages(self, conversation_id: str, before: str | None) -> MessagePage:
        """A page of messages, newest page first (each page is returned oldest first)."""
        after = _decode_cursor(before)
        with self._conn() as conn:
            row = self._chat_row(conn, conversation_id)
            where, values = "m.conversation_id = %(c)s", {"c": row["id"], "limit": MESSAGE_PAGE + 1}
            if after:
                where += " AND (m.created_at, m.id) < (%(t)s, %(i)s)"
                values |= {"t": after[0], "i": after[1]}
            rows = conn.execute(MESSAGE_SELECT.format(where=where) + " ORDER BY m.created_at DESC, m.id DESC LIMIT %(limit)s",
                                values).fetchall()
        more = len(rows) > MESSAGE_PAGE
        rows = rows[:MESSAGE_PAGE]
        cursor = _encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if more and rows else None
        return MessagePage(messages=[self._message(r) for r in reversed(rows)], next_cursor=cursor)

    def _one(self, message_id: str) -> Message:
        with self._conn() as conn:
            row = conn.execute(MESSAGE_SELECT.format(where="m.id = %(id)s"), {"id": message_id}).fetchone()
        if row is None:
            raise NotFoundError("Message not found")
        return self._message(row)

    def _refused(self, conversation_id: str) -> SocialError:
        return SocialError(self.detail(conversation_id).cannot_send_reason or "You cannot send messages in this chat.")

    def send(self, conversation_id: str, body: str, post_id: str | None = None, *, message_id: str | None = None,
             image: tuple[str, str] | None = None) -> Message:
        """Send words, a shared post, or (image = (storage path, type)) a design picture."""
        kind = "design" if image else "post" if post_id else "text"
        if kind == "text" and not body:
            raise SocialError("Write something first.")
        with self._conn() as conn:
            row = self._chat_row(conn, conversation_id)
            pid = None
            if post_id:
                pid = check_id(post_id, "Post")
                if conn.execute("SELECT 1 FROM posts WHERE id = %s AND status = 'published'", (pid,)).fetchone() is None:
                    raise NotFoundError("Post not found")
            try:
                with conn.transaction():
                    new = conn.execute(
                        "INSERT INTO messages (id, conversation_id, sender_id, kind, body, post_id, image_path, image_mime)"
                        " VALUES (COALESCE(%s::uuid, gen_random_uuid()), %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                        (message_id, row["id"], self.user_id, kind, body, pid,
                         image[0] if image else None, image[1] if image else None),
                    ).fetchone()
            except psycopg.errors.InsufficientPrivilege:
                refused = True
            else:
                refused = False
        if refused:
            raise self._refused(conversation_id)
        return self._one(new["id"])

    def can_send(self, conversation_id: str) -> None:
        """Raise the reason if you may not send in this chat now (checked before copying a picture)."""
        detail = self.detail(conversation_id)
        if not detail.can_send:
            raise SocialError(detail.cannot_send_reason or "You cannot send messages in this chat.")

    def unsend(self, message_id: str) -> str | None:
        """Delete your own message for both people. Returns its picture's storage path, if any."""
        with self._conn() as conn:
            gone = conn.execute("DELETE FROM messages WHERE id = %s AND sender_id = %s RETURNING image_path",
                                (check_id(message_id, "Message"), self.user_id)).fetchone()
        if gone is None:
            raise NotFoundError("Message not found")
        return gone["image_path"]

    def image(self, message_id: str) -> tuple[str, str]:
        """(storage path, type) of a design picture in one of your chats."""
        with self._conn() as conn:
            row = conn.execute("SELECT image_path, image_mime FROM messages WHERE id = %s AND image_path IS NOT NULL",
                               (check_id(message_id, "Message"),)).fetchone()
        if row is None:
            raise NotFoundError("Picture not found")
        return row["image_path"], row["image_mime"]

    # ---------- your side of a chat ----------

    def _my_side(self, conversation_id: str, assignments: str) -> None:
        """Change your own row of a chat. `assignments` is fixed SQL from the methods below only."""
        with self._conn() as conn:
            done = conn.execute(f"UPDATE conversation_members SET {assignments}"
                                " WHERE conversation_id = %s AND user_id = %s RETURNING conversation_id",
                                (check_id(conversation_id, "Chat"), self.user_id)).fetchone()
            if done is None:
                raise NotFoundError("Chat not found")
            if "last_read_at" in assignments:
                conn.execute("UPDATE notifications SET read_at = now() WHERE user_id = %s AND conversation_id = %s"
                             " AND read_at IS NULL", (self.user_id, done["conversation_id"]))

    def mark_read(self, conversation_id: str) -> None:
        self._my_side(conversation_id, "last_read_at = now()")

    def accept(self, conversation_id: str) -> None:
        """Move a message request into your chats."""
        self._my_side(conversation_id, "status = 'accepted', last_read_at = now()")

    def delete_for_me(self, conversation_id: str) -> None:
        """Hide the chat and its messages so far, for you only. New messages bring it back."""
        self._my_side(conversation_id, "cleared_at = now(), last_read_at = now()")
