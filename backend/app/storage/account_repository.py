"""Account settings, extra privacy controls, "Your activity" and Help (Phase 6D).

Works for ONE signed-in user, in that user's database session, so the Row Level
Security rules in `supabase/migrations/0009_settings_and_activity.sql` only let
them read and change their own rows. Deleting an account for good happens later,
in `app/services/cleanup.py` (30 days after the request).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.schemas.account import (
    GRACE_DAYS,
    AccountStatus,
    MyComment,
    MyCommentPage,
    PrivacyChoices,
    ProblemReceipt,
    SearchEntry,
    TimeDay,
)
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso
from app.storage.social_repository import SocialError, _decode_cursor, _encode_cursor, person

COMMENT_PAGE = 30
SEARCH_HISTORY_SIZE = 50
# A ping adds at most this many seconds (the app pings about once a minute).
MAX_PING_SECONDS = 60


class AccountRepository:
    def __init__(self, db: Database, user_id: str, email: str = "") -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")
        self.email = email

    def _conn(self):
        return self.db.connect(self.user_id)

    # ---------- account: deactivate and delete ----------

    def status(self) -> AccountStatus:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT pr.username, s.deactivated_at, s.delete_requested_at FROM (SELECT %(me)s::uuid AS id) me"
                " LEFT JOIN profiles pr ON pr.id = me.id LEFT JOIN account_status s ON s.user_id = me.id",
                {"me": self.user_id},
            ).fetchone()
        requested = row["delete_requested_at"]
        return AccountStatus(
            email=self.email, has_profile=row["username"] is not None, username=row["username"],
            deactivated=row["deactivated_at"] is not None, delete_requested_at=iso(requested),
            delete_after=iso(requested + timedelta(days=GRACE_DAYS)) if requested else None,
        )

    def _set(self, assignments: str) -> AccountStatus:
        """Upsert your account_status row. `assignments` is fixed SQL from the methods below only."""
        with self._conn() as conn:
            conn.execute("INSERT INTO account_status (user_id) VALUES (%s) ON CONFLICT (user_id) DO NOTHING",
                         (self.user_id,))
            conn.execute(f"UPDATE account_status SET {assignments}, updated_at = now() WHERE user_id = %s",
                         (self.user_id,))
        return self.status()

    def deactivate(self) -> AccountStatus:
        """Hide your profile, posts and comments until you sign in again."""
        return self._set("deactivated_at = COALESCE(deactivated_at, now())")

    def reactivate(self) -> AccountStatus:
        """Called when you sign in again: the account shows again (a pending deletion stays pending)."""
        return self._set("deactivated_at = NULL")

    def request_delete(self, confirm: str) -> AccountStatus:
        """Hide the account now and delete it for good after GRACE_DAYS, unless cancelled."""
        current = self.status()
        expected = current.username if current.has_profile else self.email
        typed = confirm.strip().lstrip("@")
        if not expected or typed.lower() != expected.lower():
            what = "your username" if current.has_profile else "your email address"
            raise SocialError(f"To confirm, type {what} exactly as shown.")
        return self._set("delete_requested_at = COALESCE(delete_requested_at, now())")

    def cancel_delete(self) -> AccountStatus:
        return self._set("delete_requested_at = NULL, deactivated_at = NULL")

    # ---------- privacy ----------

    def privacy(self) -> PrivacyChoices:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM privacy_settings WHERE user_id = %s", (self.user_id,)).fetchone()
        if row is None:
            return PrivacyChoices()
        return PrivacyChoices(allow_comments_from=row["allow_comments_from"],
                              allow_mentions_from=row["allow_mentions_from"], hidden_words=row["hidden_words"])

    def save_privacy(self, choice: PrivacyChoices) -> PrivacyChoices:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO privacy_settings (user_id, allow_comments_from, allow_mentions_from, hidden_words)"
                " VALUES (%s, %s, %s, %s) ON CONFLICT (user_id) DO UPDATE SET"
                " allow_comments_from = excluded.allow_comments_from, allow_mentions_from = excluded.allow_mentions_from,"
                " hidden_words = excluded.hidden_words, updated_at = now()",
                (self.user_id, choice.allow_comments_from, choice.allow_mentions_from, choice.hidden_words),
            )
        return self.privacy()

    # ---------- search history ----------

    def searches(self) -> list[SearchEntry]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM search_history WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
                                (self.user_id, SEARCH_HISTORY_SIZE)).fetchall()
        return [SearchEntry(id=r["id"], query=r["query"], created_at=iso(r["created_at"]) or "") for r in rows]

    def save_search(self, query: str) -> None:
        """Remember a search (moved to the top if it is already there). Half-typed versions of it
        from the last few minutes are replaced, and only the newest SEARCH_HISTORY_SIZE are kept."""
        with self._conn() as conn:
            conn.execute("DELETE FROM search_history WHERE user_id = %s AND created_at > now() - interval '5 minutes'"
                         " AND lower(%s) LIKE lower(query) || '%%' AND lower(query) <> lower(%s)",
                         (self.user_id, query, query))
            conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, %s)"
                         " ON CONFLICT (user_id, lower(query)) DO UPDATE SET query = excluded.query, created_at = now()",
                         (self.user_id, query))
            conn.execute("DELETE FROM search_history WHERE user_id = %s AND id NOT IN (SELECT id FROM search_history"
                         " WHERE user_id = %s ORDER BY created_at DESC LIMIT %s)",
                         (self.user_id, self.user_id, SEARCH_HISTORY_SIZE))

    def delete_search(self, entry_id: str | None) -> None:
        """One search, or (None) all of them."""
        with self._conn() as conn:
            if entry_id is None:
                conn.execute("DELETE FROM search_history WHERE user_id = %s", (self.user_id,))
            elif conn.execute("DELETE FROM search_history WHERE id = %s AND user_id = %s RETURNING id",
                              (check_id(entry_id, "Search"), self.user_id)).fetchone() is None:
                raise NotFoundError("Search not found")

    # ---------- time spent ----------

    def ping(self, day: date) -> None:
        """'The app is open.' Adds the time since the last ping (at most a minute) to today."""
        today = date.today()
        if abs((day - today).days) > 1:  # the user's own date, so at most a day either side of ours
            raise SocialError("Your device's date looks wrong.")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO time_spent (user_id, day, seconds, last_ping_at) VALUES (%s, %s, 0, now())"
                " ON CONFLICT (user_id, day) DO UPDATE SET last_ping_at = now(), seconds = LEAST(86400,"
                " time_spent.seconds + LEAST(%s, GREATEST(0, extract(epoch FROM now() - time_spent.last_ping_at)))::int)",
                (self.user_id, day, MAX_PING_SECONDS),
            )

    def time_spent(self, until: date, days: int = 7) -> list[TimeDay]:
        start = until - timedelta(days=days - 1)
        with self._conn() as conn:
            rows = {r["day"]: r["seconds"] for r in conn.execute(
                "SELECT day, seconds FROM time_spent WHERE user_id = %s AND day BETWEEN %s AND %s",
                (self.user_id, start, until)).fetchall()}
        return [TimeDay(day=(start + timedelta(days=i)).isoformat(), seconds=rows.get(start + timedelta(days=i), 0))
                for i in range(days)]

    # ---------- your comments ----------

    def my_comments(self, cursor: str | None) -> MyCommentPage:
        """Comments you wrote on posts you may still see, newest first."""
        after = _decode_cursor(cursor)
        query = (
            "SELECT c.id, c.body, c.approved, c.created_at, c.post_id, pa.id AS a_id, pa.username, pa.display_name,"
            " pa.avatar_path, pa.verified, (SELECT i.id FROM post_images i WHERE i.post_id = c.post_id ORDER BY i.position LIMIT 1)"
            " AS post_image FROM comments c JOIN posts p ON p.id = c.post_id LEFT JOIN profiles pa ON pa.id = p.author_id"
            " WHERE c.author_id = %(me)s"
        )
        values: dict[str, Any] = {"me": self.user_id, "limit": COMMENT_PAGE + 1}
        if after:
            query += " AND (c.created_at, c.id) < (%(t)s, %(i)s)"
            values |= {"t": after[0], "i": after[1]}
        with self._conn() as conn:
            rows = conn.execute(query + " ORDER BY c.created_at DESC, c.id DESC LIMIT %(limit)s", values).fetchall()
        more = len(rows) > COMMENT_PAGE
        rows = rows[:COMMENT_PAGE]
        return MyCommentPage(
            comments=[MyComment(id=r["id"], body=r["body"], approved=r["approved"], created_at=iso(r["created_at"]) or "",
                                post_id=r["post_id"], post_image_id=r["post_image"],
                                post_author=person({**r, "id": r["a_id"]}) if r["a_id"] else None) for r in rows],
            next_cursor=_encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if more and rows else None,
        )

    # ---------- download my data ----------

    def social_export(self) -> dict[str, Any]:
        """Everything social about you, as plain data (designs are added by the router)."""
        me = {"me": self.user_id}
        queries = {
            "profile": "SELECT username, display_name, bio, role, is_private, allow_messages_from, created_at, updated_at"
                       " FROM profiles WHERE id = %(me)s",
            "account_status": "SELECT deactivated_at, delete_requested_at FROM account_status WHERE user_id = %(me)s",
            "privacy_settings": "SELECT allow_comments_from, allow_mentions_from, hidden_words FROM privacy_settings"
                                " WHERE user_id = %(me)s",
            "notification_settings": "SELECT * FROM notification_settings WHERE user_id = %(me)s",
            "posts": "SELECT id, status, visibility, caption, tag_garment, tag_fabric, tag_occasion, palette, fabrics,"
                     " pinned, published_at, created_at, updated_at, deleted_at FROM posts WHERE author_id = %(me)s"
                     " ORDER BY created_at",
            "comments": "SELECT id, post_id, parent_id, body, approved, created_at FROM comments WHERE author_id = %(me)s"
                        " ORDER BY created_at",
            "liked_posts": "SELECT post_id, created_at FROM post_likes WHERE user_id = %(me)s ORDER BY created_at",
            "saved_posts": "SELECT post_id, created_at FROM post_saves WHERE user_id = %(me)s ORDER BY created_at",
            "reposts": "SELECT post_id, created_at FROM reposts WHERE user_id = %(me)s ORDER BY created_at",
            "following": "SELECT pr.username, f.created_at FROM follows f LEFT JOIN profiles pr ON pr.id = f.following_id"
                         " WHERE f.follower_id = %(me)s ORDER BY f.created_at",
            "followers": "SELECT pr.username, f.created_at FROM follows f LEFT JOIN profiles pr ON pr.id = f.follower_id"
                         " WHERE f.following_id = %(me)s ORDER BY f.created_at",
            "close_friends": "SELECT pr.username FROM close_friends c LEFT JOIN profiles pr ON pr.id = c.friend_id"
                             " WHERE c.owner_id = %(me)s",
            "blocked": "SELECT pr.username, b.created_at FROM blocks b LEFT JOIN profiles pr ON pr.id = b.blocked_id"
                       " WHERE b.blocker_id = %(me)s",
            "messages": "SELECT m.conversation_id, pr.username AS sender, m.kind, m.body, m.post_id, m.created_at"
                        " FROM messages m LEFT JOIN profiles pr ON pr.id = m.sender_id ORDER BY m.conversation_id,"
                        " m.created_at",
            "reports_you_sent": "SELECT target_type, reason, details, status, created_at FROM reports"
                                " WHERE reporter_id = %(me)s",
            "search_history": "SELECT query, created_at FROM search_history WHERE user_id = %(me)s ORDER BY created_at DESC",
            "time_spent": "SELECT day, seconds FROM time_spent WHERE user_id = %(me)s ORDER BY day",
        }
        out: dict[str, Any] = {}
        with self._conn() as conn:  # Row Level Security: only your own rows (messages: only your chats)
            for name, sql_text in queries.items():
                out[name] = conn.execute(sql_text, me).fetchall()
        out["profile"] = out["profile"][0] if out["profile"] else None
        return out

    # ---------- report a problem ----------

    def add_problem_report(self, report_id: str, category: str, description: str, page: str, browser: str,
                           screenshot: tuple[str, str] | None) -> ProblemReceipt:
        with self._conn() as conn:
            row = conn.execute(
                "INSERT INTO problem_reports (id, user_id, category, description, page, browser, screenshot_path,"
                " screenshot_mime) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, created_at",
                (report_id, self.user_id, category, description, page[:300], browser[:300],
                 screenshot[0] if screenshot else None, screenshot[1] if screenshot else None),
            ).fetchone()
        return ProblemReceipt(id=row["id"], created_at=iso(row["created_at"]) or "")
