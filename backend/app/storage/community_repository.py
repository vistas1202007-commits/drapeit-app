"""Comments (with one level of replies), comment likes and reports (Phase 6B).

Works for ONE signed-in user, in that user's database session, so the Row Level
Security rules in `supabase/migrations/0007_social_features.sql` decide which
comments they see: never across a block, and a restricted person's comment only
for its writer and the post's owner until the owner approves it.
"""

from __future__ import annotations

from typing import Any

import psycopg

from app.schemas.social import Comment, CommentList, ReportReceipt
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso
from app.storage.social_repository import SocialError, person, profile_row

MAX_COMMENTS = 500

COMMENT_SELECT = """
SELECT c.*, pr.username, pr.display_name, pr.avatar_path, pr.verified, p.author_id AS post_author,
       (SELECT count(*) FROM comment_likes l WHERE l.comment_id = c.id) AS like_count,
       EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = %(me)s) AS liked_by_me,
       has_hidden_word(c.post_id, c.body) AS hidden_word
FROM comments c
JOIN profiles pr ON pr.id = c.author_id
JOIN posts p ON p.id = c.post_id
WHERE {where}
ORDER BY c.created_at, c.id
"""


class CommunityRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    def _comment(self, row: dict[str, Any]) -> Comment:
        mine = row["author_id"] == self.user_id
        my_post = row["post_author"] == self.user_id
        return Comment(
            id=row["id"], post_id=row["post_id"], parent_id=row["parent_id"],
            author=person({**row, "id": row["author_id"]}), body=row["body"], approved=row["approved"],
            like_count=row["like_count"], liked_by_me=row["liked_by_me"], is_mine=mine,
            can_delete=mine or my_post, can_approve=my_post and not row["approved"],
            hidden=row["hidden_word"] and (mine or my_post), created_at=iso(row["created_at"]) or "",
        )

    def _one(self, comment_id: str) -> Comment:
        with self._conn() as conn:
            row = conn.execute(COMMENT_SELECT.format(where="c.id = %(id)s"),
                               {"me": self.user_id, "id": check_id(comment_id, "Comment")}).fetchone()
        if row is None:
            raise NotFoundError("Comment not found")
        return self._comment(row)

    # ---------- comments ----------

    def list(self, post_id: str) -> CommentList:
        """The comments you may see on a post, oldest first, replies under their comment."""
        pid = check_id(post_id, "Post")
        with self._conn() as conn:
            if conn.execute("SELECT 1 FROM posts WHERE id = %s", (pid,)).fetchone() is None:
                raise NotFoundError("Post not found")
            rows = conn.execute(COMMENT_SELECT.format(where="c.post_id = %(post)s") + " LIMIT %(limit)s",
                                {"me": self.user_id, "post": pid, "limit": MAX_COMMENTS + 1}).fetchall()
        truncated = len(rows) > MAX_COMMENTS
        comments = [self._comment(r) for r in rows[:MAX_COMMENTS]]
        top = {c.id: c for c in comments if c.parent_id is None}
        for c in comments:
            # A reply whose comment you cannot see (deleted, blocked, waiting) is left out too.
            if c.parent_id is not None and c.parent_id in top:
                top[c.parent_id].replies.append(c)
        shown = list(top.values())
        return CommentList(comments=shown, total=len(shown) + sum(len(c.replies) for c in shown), truncated=truncated)

    def add(self, post_id: str, body: str, parent_id: str | None) -> Comment:
        pid = check_id(post_id, "Post")
        with self._conn() as conn:
            if conn.execute("SELECT 1 FROM profiles WHERE id = %s", (self.user_id,)).fetchone() is None:
                raise SocialError("Set up your profile (choose a username) before commenting.")
            post = conn.execute("SELECT status FROM posts WHERE id = %s", (pid,)).fetchone()
            if post is None:
                raise NotFoundError("Post not found")
            if post["status"] != "published":
                raise SocialError("Comments open once the post is published.")
            if not conn.execute("SELECT comment_allowed(%s) AS ok", (pid,)).fetchone()["ok"]:
                raise SocialError("The designer has limited who can comment on this post.")
            parent = None
            if parent_id:
                parent = conn.execute("SELECT id, parent_id FROM comments WHERE id = %s AND post_id = %s",
                                      (check_id(parent_id, "Comment"), pid)).fetchone()
                if parent is None:
                    raise NotFoundError("Comment not found")
                if parent["parent_id"] is not None:
                    raise SocialError("You can reply to a comment, but not to a reply.")
            try:
                row = conn.execute("INSERT INTO comments (post_id, author_id, parent_id, body) VALUES (%s, %s, %s, %s)"
                                   " RETURNING id", (pid, self.user_id, parent["id"] if parent else None, body)).fetchone()
            except psycopg.errors.InsufficientPrivilege:
                raise NotFoundError("Post not found") from None
            except psycopg.errors.CheckViolation:
                raise SocialError("Write between 1 and 1000 characters.") from None
        return self._one(row["id"])

    def delete(self, comment_id: str) -> None:
        """Your own comment, or any comment on your post (its replies go too)."""
        with self._conn() as conn:
            gone = conn.execute("DELETE FROM comments WHERE id = %s RETURNING id",
                                (check_id(comment_id, "Comment"),)).fetchone()
        if gone is None:
            raise NotFoundError("Comment not found")

    def approve(self, comment_id: str) -> Comment:
        """The post owner lets a restricted person's comment be seen by everyone."""
        with self._conn() as conn:
            done = conn.execute("UPDATE comments SET approved = true WHERE id = %s RETURNING id",
                                (check_id(comment_id, "Comment"),)).fetchone()
        if done is None:
            raise NotFoundError("Comment not found")
        return self._one(comment_id)

    def set_like(self, comment_id: str, on: bool) -> Comment:
        current = self._one(comment_id)  # "not found" if you may not see it
        with self._conn() as conn:
            if on:
                conn.execute("INSERT INTO comment_likes (comment_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                             (current.id, self.user_id))
            else:
                conn.execute("DELETE FROM comment_likes WHERE comment_id = %s AND user_id = %s", (current.id, self.user_id))
        return self._one(current.id)

    # ---------- reports ----------

    def report(self, target_type: str, target: str, reason: str, details: str) -> ReportReceipt:
        """Save a report for a later admin review. Reporting the same thing twice returns the first report."""
        with self._conn() as conn:
            post_id = comment_id = message_id = None
            if target_type == "post":
                row = conn.execute("SELECT id, author_id, caption AS text FROM posts WHERE id = %s AND status = 'published'",
                                   (check_id(target, "Post"),)).fetchone()
                if row is None:
                    raise NotFoundError("Post not found")
                post_id, reported, excerpt = row["id"], row["author_id"], row["text"]
            elif target_type == "comment":
                row = conn.execute("SELECT id, author_id, body AS text FROM comments WHERE id = %s",
                                   (check_id(target, "Comment"),)).fetchone()
                if row is None:
                    raise NotFoundError("Comment not found")
                comment_id, reported, excerpt = row["id"], row["author_id"], row["text"]
            elif target_type == "message":
                row = conn.execute("SELECT id, sender_id, kind, body FROM messages WHERE id = %s",
                                   (check_id(target, "Message"),)).fetchone()
                if row is None:
                    raise NotFoundError("Message not found")
                message_id, reported = row["id"], row["sender_id"]
                excerpt = row["body"] or {"post": "[a shared post]", "design": "[a design picture]"}.get(row["kind"], "")
            else:
                row = profile_row(conn, target)
                reported, excerpt = row["id"], f"@{row['username']}"
            if reported == self.user_id:
                raise SocialError("You cannot report yourself or your own posts and comments.")
            same = conn.execute(
                "SELECT id, status, created_at FROM reports WHERE reporter_id = %s AND target_type = %s"
                " AND post_id IS NOT DISTINCT FROM %s AND comment_id IS NOT DISTINCT FROM %s"
                " AND message_id IS NOT DISTINCT FROM %s AND reported_user_id = %s AND status IN ('open', 'reviewing')",
                (self.user_id, target_type, post_id, comment_id, message_id, reported),
            ).fetchone()
            if same is None:
                same = conn.execute(
                    "INSERT INTO reports (reporter_id, target_type, post_id, comment_id, message_id, reported_user_id,"
                    " reason, details, excerpt) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, status, created_at",
                    (self.user_id, target_type, post_id, comment_id, message_id, reported, reason, details,
                     (excerpt or "")[:300]),
                ).fetchone()
        return ReportReceipt(id=same["id"], status=same["status"], created_at=iso(same["created_at"]) or "")
