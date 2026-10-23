"""Profiles, follows, close friends, posts, likes and saves (Phase 6A); private
accounts and follow requests, follower lists, block / restrict / mute, reposts and
Explore (Phase 6B).

Like `Repository`, this works for ONE signed-in user and every query runs in
that user's database session, so the Row Level Security rules in
`supabase/migrations/0006_profiles_and_posts.sql` and `0007_social_features.sql`
decide which posts and people they see. The explicit conditions below repeat those
rules where it helps (defence in depth).
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

import psycopg
from psycopg import Connection, sql
from psycopg.types.json import Jsonb

from app.schemas.social import (
    ExploreFilters,
    FabricChoice,
    FilterOption,
    PaletteColour,
    PeoplePage,
    PersonListItem,
    PersonSummary,
    Post,
    PostImage,
    PostPage,
    PostTags,
    Profile,
    ProfileDetail,
    ProfileUpdate,
    SearchResults,
    TagResult,
)
from app.storage.appearance_repository import profile_appearance
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso, new_id, now

PAGE_SIZE = 12
MAX_PINNED = 3
PEOPLE_PAGE_SIZE = 50
TRENDING_SIZE = 24
FILTER_OPTIONS = 15


class SocialError(Exception):
    """A request that cannot be done as asked. The message is safe to show."""


class UsernameTaken(SocialError):
    pass


class PrivateAccount(SocialError):
    """You may not see this (a private account you do not follow)."""


def _encode_cursor(when: datetime, row_id: str) -> str:
    return base64.urlsafe_b64encode(f"{when.isoformat()}|{row_id}".encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        when, row_id = raw.split("|", 1)
        return datetime.fromisoformat(when), check_id(row_id)
    except (ValueError, NotFoundError):
        raise SocialError("That page link is not valid any more. Please reload.") from None


def _version(path: str | None) -> str | None:
    return path.rsplit("/", 1)[-1].split(".", 1)[0] if path else None


def _like_pattern(text: str, anywhere: bool = False) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%" if anywhere else f"{escaped}%"


def profile_row(conn: Connection, username: str) -> dict[str, Any]:
    """A profile by username (hidden, so "not found", if that person blocked you)."""
    row = conn.execute("SELECT * FROM profiles WHERE username = %s", (username.strip().lstrip("@").lower(),)).fetchone()
    if row is None:
        raise NotFoundError("Profile not found")
    return row


def person(row: dict[str, Any]) -> PersonSummary:
    return PersonSummary(user_id=row["id"], username=row["username"], display_name=row["display_name"],
                         has_avatar=bool(row["avatar_path"]), avatar_version=_version(row["avatar_path"]),
                         verified=bool(row.get("verified")))


def _person_json(user_expr: str) -> str:
    """SQL for one person's public name and picture as JSON (null if hidden from you)."""
    return ("(SELECT json_build_object('id', x.id, 'username', x.username, 'display_name', x.display_name,"
            f" 'avatar_path', x.avatar_path, 'verified', x.verified) FROM profiles x WHERE x.id = {user_expr})")


# Posts by people you muted are left out of your feed and Explore.
NOT_MUTED = "NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = %(me)s AND m.muted_id = p.author_id)"
# Explore only shows Public posts from public accounts.
EXPLORE_WHERE = f"p.status = 'published' AND p.visibility = 'public' AND NOT pr.is_private AND {NOT_MUTED}"

# Explore filters: each one is fixed SQL with a named value.
FILTERS = {
    "garment": "lower(p.tag_garment) = lower(%(garment)s)",
    "occasion": "lower(p.tag_occasion) = lower(%(occasion)s)",
    "fabric": "(lower(p.tag_fabric) = lower(%(fabric)s) OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.fabrics) f"
              " WHERE lower(f->>'name') = lower(%(fabric)s)))",
    "colour": "EXISTS (SELECT 1 FROM jsonb_array_elements(p.palette) c WHERE lower(c->>'name') = lower(%(colour)s))",
}
TEXT_MATCH = ("(p.caption ILIKE %(q)s OR p.tag_garment ILIKE %(q)s OR p.tag_fabric ILIKE %(q)s"
              " OR p.tag_occasion ILIKE %(q)s)")

# One query shape for every list of posts. {order} is the time the list is sorted by;
# {reposter} is the person shown as "reposted by" (or NULL).
POST_SELECT = """
SELECT p.*, pr.username, pr.display_name, pr.avatar_path, pr.verified, pr.is_private AS author_private,
       COALESCE(c.likes, 0) AS like_count, COALESCE(c.saves, 0) AS save_count,
       COALESCE(c.reposts, 0) AS repost_count,
       EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = %(me)s) AS liked_by_me,
       EXISTS (SELECT 1 FROM post_saves s WHERE s.post_id = p.id AND s.user_id = %(me)s) AS saved_by_me,
       EXISTS (SELECT 1 FROM reposts r0 WHERE r0.post_id = p.id AND r0.user_id = %(me)s) AS reposted_by_me,
       (SELECT count(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count,
       comment_allowed(p.id) AS can_comment,
       COALESCE((SELECT json_agg(json_build_object('id', i.id, 'kind', i.kind) ORDER BY i.position)
                 FROM post_images i WHERE i.post_id = p.id), '[]'::json) AS images,
       {reposter} AS reposter,
       {order} AS sort_time
FROM posts p
JOIN profiles pr ON pr.id = p.author_id
LEFT JOIN LATERAL post_counts(p.id) c ON true
{join}
WHERE {where}
"""


class SocialRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    # ---------- profiles ----------

    @staticmethod
    def _profile(row: dict[str, Any]) -> Profile:
        return Profile(user_id=row["id"], username=row["username"], display_name=row["display_name"], bio=row["bio"],
                       role=row["role"], has_avatar=bool(row["avatar_path"]), avatar_version=_version(row["avatar_path"]),
                       is_private=row["is_private"], verified=row["verified"])

    def my_profile(self) -> Profile | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM profiles WHERE id = %s", (self.user_id,)).fetchone()
            return self._profile(row) if row else None

    def save_profile(self, update: ProfileUpdate) -> Profile:
        try:
            with self._conn() as conn:
                row = conn.execute(
                    "INSERT INTO profiles (id, username, display_name, bio, role, updated_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s)"
                    " ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,"
                    " bio = excluded.bio, role = excluded.role, updated_at = excluded.updated_at RETURNING *",
                    (self.user_id, update.username, update.display_name, update.bio, update.role, now()),
                ).fetchone()
                return self._profile(row)
        except psycopg.errors.UniqueViolation:
            raise UsernameTaken(f"The username @{update.username} is already taken. Please choose another.") from None
        except psycopg.errors.CheckViolation:
            raise SocialError("Usernames use 3 to 30 lowercase letters, numbers, dots or underscores.") from None

    def set_privacy(self, is_private: bool) -> Profile:
        """Turn the private account on or off. Going public accepts every waiting request."""
        with self._conn() as conn:
            row = conn.execute("UPDATE profiles SET is_private = %s, updated_at = %s WHERE id = %s RETURNING *",
                               (is_private, now(), self.user_id)).fetchone()
            if row is None:
                raise SocialError("Set up your profile (choose a username) first.")
            if not is_private:
                conn.execute("INSERT INTO follows (follower_id, following_id) SELECT requester_id, target_id"
                             " FROM follow_requests WHERE target_id = %s ON CONFLICT DO NOTHING", (self.user_id,))
                conn.execute("DELETE FROM follow_requests WHERE target_id = %s", (self.user_id,))
            return self._profile(row)

    def set_avatar(self, path: str) -> str | None:
        """Store the new picture's place; returns the old one (to delete from Storage)."""
        with self._conn() as conn:
            old = conn.execute("SELECT avatar_path FROM profiles WHERE id = %s", (self.user_id,)).fetchone()
            if old is None:
                raise SocialError("Set up your profile (choose a username) first.")
            conn.execute("UPDATE profiles SET avatar_path = %s, updated_at = %s WHERE id = %s", (path, now(), self.user_id))
            return old["avatar_path"]

    def avatar_path(self, user_id: str) -> str:
        with self._conn() as conn:
            row = conn.execute("SELECT avatar_path FROM profiles WHERE id = %s", (check_id(user_id, "Profile"),)).fetchone()
            if not row or not row["avatar_path"]:
                raise NotFoundError("Profile picture not found")
            return row["avatar_path"]

    def _profile_row(self, conn: Connection, username: str) -> dict[str, Any]:
        return profile_row(conn, username)

    def _other_id(self, conn: Connection, username: str, own_message: str) -> str:
        uid = self._profile_row(conn, username)["id"]
        if uid == self.user_id:
            raise SocialError(own_message)
        return uid

    def profile_detail(self, username: str) -> ProfileDetail:
        with self._conn() as conn:
            row = self._profile_row(conn, username)
            uid = row["id"]
            # Row Level Security hides posts you may not see, so post_count is what *you* can see.
            info = conn.execute(
                "SELECT (SELECT count(*) FROM posts WHERE author_id = %(u)s AND status = 'published') AS posts,"
                " fc.followers, fc.following,"
                " EXISTS (SELECT 1 FROM follows WHERE follower_id = %(me)s AND following_id = %(u)s) AS is_following,"
                " EXISTS (SELECT 1 FROM follows WHERE follower_id = %(u)s AND following_id = %(me)s) AS follows_me,"
                " EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = %(me)s AND target_id = %(u)s) AS requested,"
                " EXISTS (SELECT 1 FROM close_friends WHERE owner_id = %(me)s AND friend_id = %(u)s) AS is_close_friend,"
                " EXISTS (SELECT 1 FROM blocks WHERE blocker_id = %(me)s AND blocked_id = %(u)s) AS blocked,"
                " EXISTS (SELECT 1 FROM restricts WHERE owner_id = %(me)s AND restricted_id = %(u)s) AS restricted,"
                " EXISTS (SELECT 1 FROM mutes WHERE muter_id = %(me)s AND muted_id = %(u)s) AS muted,"
                " can_see_activity(%(u)s) AS can_see,"
                " (SELECT count(*) FROM follow_requests WHERE target_id = %(me)s) AS requests,"
                " (EXISTS (SELECT 1 FROM conversations WHERE user_low = least(%(me)s::uuid, %(u)s::uuid)"
                "  AND user_high = greatest(%(me)s::uuid, %(u)s::uuid)) OR messaging_allowed(%(me)s, %(u)s)) AS can_message"
                " FROM follow_counts(%(u)s) fc",
                {"u": uid, "me": self.user_id},
            ).fetchone()
            is_me = uid == self.user_id
            status = "following" if info["is_following"] else "requested" if info["requested"] else "none"
            return ProfileDetail(
                **self._profile(row).model_dump(), post_count=info["posts"], follower_count=info["followers"],
                following_count=info["following"], is_me=is_me,
                is_following=info["is_following"], is_close_friend=info["is_close_friend"],
                follow_status=status, follows_me=info["follows_me"],
                can_see_posts=info["can_see"] and not info["blocked"],
                blocked_by_me=info["blocked"], restricted_by_me=info["restricted"], muted_by_me=info["muted"],
                request_count=info["requests"] if is_me else 0,
                can_message=not is_me and not info["blocked"] and info["can_message"],
                appearance=profile_appearance(conn, uid),
            )

    def search_people(self, query: str, limit: int = 10) -> list[PersonSummary]:
        text = query.strip().lstrip("@").lower()
        if len(text) < 2:
            return []
        like = _like_pattern(text)
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM profiles WHERE id <> %s AND (username LIKE %s OR lower(display_name) LIKE %s)"
                " ORDER BY username LIMIT %s",
                (self.user_id, like, like, limit),
            ).fetchall()
            return [self._person(r) for r in rows]

    @staticmethod
    def _person(row: dict[str, Any]) -> PersonSummary:
        return person(row)

    @staticmethod
    def _list_item(row: dict[str, Any]) -> PersonListItem:
        return PersonListItem(**person(row).model_dump(), since=iso(row["since"]) or "")

    # ---------- follows and follow requests ----------

    def set_following(self, username: str, follow: bool) -> ProfileDetail:
        """Follow (or ask to follow a private account), or unfollow / cancel the request."""
        with self._conn() as conn:
            row = self._profile_row(conn, username)
            uid = row["id"]
            if uid == self.user_id:
                raise SocialError("You cannot follow yourself.")
            if follow:
                if conn.execute("SELECT 1 FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                                (self.user_id, uid)).fetchone():
                    raise SocialError(f"You blocked @{row['username']}. Unblock them first to follow.")
                following = conn.execute("SELECT 1 FROM follows WHERE follower_id = %s AND following_id = %s",
                                         (self.user_id, uid)).fetchone()
                if row["is_private"] and not following:
                    if conn.execute("SELECT 1 FROM profiles WHERE id = %s", (self.user_id,)).fetchone() is None:
                        raise SocialError("Set up your profile (choose a username) first, so they can see who is asking.")
                    conn.execute("INSERT INTO follow_requests (requester_id, target_id) VALUES (%s, %s)"
                                 " ON CONFLICT DO NOTHING", (self.user_id, uid))
                elif not following:
                    conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                                 (self.user_id, uid))
            else:
                conn.execute("DELETE FROM follows WHERE follower_id = %s AND following_id = %s", (self.user_id, uid))
                conn.execute("DELETE FROM follow_requests WHERE requester_id = %s AND target_id = %s", (self.user_id, uid))
        return self.profile_detail(username)

    def _people(self, username: str, offset: int, direction: str) -> PeoplePage:
        """A profile's followers ("followers") or the people it follows ("following"), newest first."""
        person_col, profile_col = ("follower_id", "following_id") if direction == "followers" else ("following_id", "follower_id")
        with self._conn() as conn:
            uid = self._profile_row(conn, username)["id"]
            if not conn.execute("SELECT can_see_activity(%s) AS ok", (uid,)).fetchone()["ok"]:
                raise PrivateAccount("This account is private. Follow it to see who it follows and who follows it.")
            rows = conn.execute(
                sql.SQL("SELECT pr.*, f.created_at AS since FROM follows f JOIN profiles pr ON pr.id = f.{person}"
                        " WHERE f.{profile} = %s ORDER BY f.created_at DESC, pr.id LIMIT %s OFFSET %s")
                .format(person=sql.Identifier(person_col), profile=sql.Identifier(profile_col)),
                (uid, PEOPLE_PAGE_SIZE + 1, max(offset, 0)),
            ).fetchall()
        more = len(rows) > PEOPLE_PAGE_SIZE
        return PeoplePage(people=[self._list_item(r) for r in rows[:PEOPLE_PAGE_SIZE]],
                          next_offset=max(offset, 0) + PEOPLE_PAGE_SIZE if more else None)

    def followers(self, username: str, offset: int = 0) -> PeoplePage:
        return self._people(username, offset, "followers")

    def following(self, username: str, offset: int = 0) -> PeoplePage:
        return self._people(username, offset, "following")

    def remove_follower(self, username: str) -> None:
        with self._conn() as conn:
            uid = self._other_id(conn, username, "You do not follow yourself.")
            conn.execute("DELETE FROM follows WHERE follower_id = %s AND following_id = %s", (uid, self.user_id))

    def follow_requests(self) -> list[PersonListItem]:
        """Requests waiting for you to accept or decline, newest first."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT pr.*, r.created_at AS since FROM follow_requests r JOIN profiles pr ON pr.id = r.requester_id"
                " WHERE r.target_id = %s ORDER BY r.created_at DESC LIMIT 500", (self.user_id,),
            ).fetchall()
            return [self._list_item(r) for r in rows]

    def answer_request(self, username: str, accept: bool) -> list[PersonListItem]:
        with self._conn() as conn:
            uid = self._profile_row(conn, username)["id"]
            waiting = conn.execute("SELECT 1 FROM follow_requests WHERE requester_id = %s AND target_id = %s",
                                   (uid, self.user_id)).fetchone()
            if waiting is None:
                raise NotFoundError("Follow request not found")
            if accept:  # the database only allows this follow while the request exists
                conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                             (uid, self.user_id))
            conn.execute("DELETE FROM follow_requests WHERE requester_id = %s AND target_id = %s", (uid, self.user_id))
        return self.follow_requests()

    # ---------- block, restrict, mute ----------

    _SAFETY = {"blocks": ("blocker_id", "blocked_id"), "restricts": ("owner_id", "restricted_id"),
               "mutes": ("muter_id", "muted_id")}

    def set_safety(self, table: str, username: str, on: bool) -> ProfileDetail:
        """Block / restrict / mute someone, or undo it. Blocking also ends follows both ways."""
        owner_col, other_col = self._SAFETY[table]
        own_message = {"blocks": "You cannot block yourself.", "restricts": "You cannot restrict yourself.",
                       "mutes": "You cannot mute yourself."}[table]
        with self._conn() as conn:
            uid = self._other_id(conn, username, own_message)
            if on:
                conn.execute(sql.SQL("INSERT INTO {} ({}, {}) VALUES (%s, %s) ON CONFLICT DO NOTHING").format(
                    sql.Identifier(table), sql.Identifier(owner_col), sql.Identifier(other_col)), (self.user_id, uid))
                if table == "blocks":
                    pair = {"me": self.user_id, "u": uid}
                    conn.execute("DELETE FROM follows WHERE (follower_id = %(me)s AND following_id = %(u)s)"
                                 " OR (follower_id = %(u)s AND following_id = %(me)s)", pair)
                    conn.execute("DELETE FROM follow_requests WHERE (requester_id = %(me)s AND target_id = %(u)s)"
                                 " OR (requester_id = %(u)s AND target_id = %(me)s)", pair)
                    conn.execute("DELETE FROM close_friends WHERE owner_id = %(me)s AND friend_id = %(u)s", pair)
            else:
                conn.execute(sql.SQL("DELETE FROM {} WHERE {} = %s AND {} = %s").format(
                    sql.Identifier(table), sql.Identifier(owner_col), sql.Identifier(other_col)), (self.user_id, uid))
        return self.profile_detail(username)

    def safety_list(self, table: str) -> list[PersonListItem]:
        """The people you blocked / restricted / muted, newest first."""
        owner_col, other_col = self._SAFETY[table]
        with self._conn() as conn:
            rows = conn.execute(
                sql.SQL("SELECT pr.*, t.created_at AS since FROM {} t JOIN profiles pr ON pr.id = t.{}"
                        " WHERE t.{} = %s ORDER BY t.created_at DESC LIMIT 500")
                .format(sql.Identifier(table), sql.Identifier(other_col), sql.Identifier(owner_col)),
                (self.user_id,),
            ).fetchall()
            return [self._list_item(r) for r in rows]

    # ---------- close friends ----------

    def close_friends(self) -> list[PersonSummary]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT pr.* FROM close_friends c JOIN profiles pr ON pr.id = c.friend_id"
                " WHERE c.owner_id = %s ORDER BY pr.username", (self.user_id,),
            ).fetchall()
            return [self._person(r) for r in rows]

    def set_close_friend(self, username: str, add: bool) -> list[PersonSummary]:
        with self._conn() as conn:
            uid = self._profile_row(conn, username)["id"]
            if uid == self.user_id:
                raise SocialError("You are always on your own Close Friends list.")
            if add:
                if conn.execute("SELECT 1 FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                                (self.user_id, uid)).fetchone():
                    raise SocialError("You blocked this person. Unblock them first.")
                conn.execute("INSERT INTO close_friends (owner_id, friend_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                             (self.user_id, uid))
            else:
                conn.execute("DELETE FROM close_friends WHERE owner_id = %s AND friend_id = %s", (self.user_id, uid))
        return self.close_friends()

    # ---------- posts: writing ----------

    def require_profile(self) -> None:
        if self.my_profile() is None:
            raise SocialError("Set up your profile (choose a username) before posting.")

    def create_post(self, project_id: str, status: str, visibility: str, caption: str, tags: PostTags,
                    palette: list[PaletteColour], fabrics: list[FabricChoice]) -> str:
        pid, ts = new_id(), now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO posts (id, author_id, project_id, status, visibility, caption, tag_garment, tag_fabric,"
                " tag_occasion, palette, fabrics, published_at, created_at, updated_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (pid, self.user_id, check_id(project_id, "Project"), status, visibility, caption, tags.garment,
                 tags.fabric, tags.occasion, Jsonb([c.model_dump() for c in palette]),
                 Jsonb([f.model_dump() for f in fabrics]), ts if status == "published" else None, ts, ts),
            )
        return pid

    def image_path(self, post_id: str, image_id: str, extension: str) -> str:
        return f"posts/{self.user_id}/{check_id(post_id, 'Post')}/{check_id(image_id, 'Picture')}{extension}"

    def replace_images(self, post_id: str, images: list[dict[str, Any]]) -> list[str]:
        """Swap the post's pictures; returns the storage paths of the old ones."""
        with self._conn() as conn:
            self._my_post(conn, post_id)
            old = [r["storage_path"] for r in conn.execute(
                "DELETE FROM post_images WHERE post_id = %s RETURNING storage_path", (post_id,)).fetchall()]
            for position, img in enumerate(images):
                conn.execute(
                    "INSERT INTO post_images (id, post_id, position, kind, mime_type, size_bytes, storage_path)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (img["id"], post_id, position, img["kind"], img["mime_type"], img["size_bytes"], img["storage_path"]),
                )
            return old

    def _my_post(self, conn: Connection, post_id: str) -> dict[str, Any]:
        row = conn.execute("SELECT * FROM posts WHERE id = %s AND author_id = %s FOR UPDATE",
                           (check_id(post_id, "Post"), self.user_id)).fetchone()
        if row is None:
            raise NotFoundError("Post not found")
        return row

    def update_post(self, post_id: str, changes: dict[str, Any]) -> None:
        with self._conn() as conn:
            row = self._my_post(conn, post_id)
            if row["status"] == "deleted":
                raise SocialError("This post is in Recently deleted. Restore it first.")
            status = changes.get("status", row["status"])
            allowed = {("draft", "published"), ("published", "archived"), ("archived", "published")}
            if status != row["status"] and (row["status"], status) not in allowed:
                raise SocialError({"draft": "A draft can only be published or deleted.",
                                   "published": "A published post can be archived (hidden) or deleted.",
                                   "archived": "An archived post can be published again or deleted."}[row["status"]])
            pinned = changes.get("pinned", row["pinned"])
            if status != "published":
                pinned = False
            if pinned and not row["pinned"]:
                count = conn.execute("SELECT count(*) AS n FROM posts WHERE author_id = %s AND pinned",
                                     (self.user_id,)).fetchone()["n"]
                if count >= MAX_PINNED:
                    raise SocialError(f"You can pin up to {MAX_PINNED} posts. Unpin one first.")
            if changes.get("pinned") and status != "published":
                raise SocialError("Only published posts can be pinned.")
            tags = changes.get("tags")
            fields: dict[str, Any] = {
                "status": status, "pinned": pinned, "updated_at": now(),
                "visibility": changes.get("visibility", row["visibility"]),
                "caption": changes.get("caption", row["caption"]),
                "tag_garment": tags.garment if tags else row["tag_garment"],
                "tag_fabric": tags.fabric if tags else row["tag_fabric"],
                "tag_occasion": tags.occasion if tags else row["tag_occasion"],
                "published_at": row["published_at"] or (now() if status == "published" else None),
            }
            if "palette" in changes:
                fields["palette"] = Jsonb([c.model_dump() for c in changes["palette"]])
            if "fabrics" in changes:
                fields["fabrics"] = Jsonb([f.model_dump() for f in changes["fabrics"]])
            assignments = sql.SQL(", ").join(sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in fields)
            conn.execute(sql.SQL("UPDATE posts SET {} WHERE id = %(id)s").format(assignments), fields | {"id": row["id"]})

    def move_to_deleted(self, post_id: str) -> None:
        """Phase 6D: "Delete" moves a post to Recently deleted for 30 days (only you see it there)."""
        with self._conn() as conn:
            row = self._my_post(conn, post_id)
            if row["status"] == "deleted":
                return
            conn.execute("UPDATE posts SET status = 'deleted', status_before_delete = %s, deleted_at = now(),"
                         " pinned = false, updated_at = now() WHERE id = %s", (row["status"], row["id"]))

    def restore_post(self, post_id: str) -> None:
        """Put a recently deleted post back where it was (published, draft or archived)."""
        with self._conn() as conn:
            row = self._my_post(conn, post_id)
            if row["status"] != "deleted":
                raise SocialError("This post is not in Recently deleted.")
            conn.execute("UPDATE posts SET status = COALESCE(status_before_delete, 'draft'), status_before_delete = NULL,"
                         " deleted_at = NULL, updated_at = now() WHERE id = %s", (row["id"],))

    def delete_post(self, post_id: str) -> list[str]:
        """Delete for good. Returns the storage paths of its pictures (to remove them too)."""
        with self._conn() as conn:
            row = self._my_post(conn, post_id)
            paths = [r["storage_path"] for r in conn.execute(
                "SELECT storage_path FROM post_images WHERE post_id = %s", (row["id"],)).fetchall()]
            conn.execute("DELETE FROM posts WHERE id = %s", (row["id"],))
            return paths

    def post_project(self, post_id: str) -> str | None:
        with self._conn() as conn:
            return self._my_post(conn, post_id)["project_id"]

    # ---------- posts: reading ----------

    def _post(self, row: dict[str, Any]) -> Post:
        mine = row["author_id"] == self.user_id
        reposter = row.get("reposter")
        return Post(
            id=row["id"],
            author=PersonSummary(user_id=row["author_id"], username=row["username"], display_name=row["display_name"],
                                 has_avatar=bool(row["avatar_path"]), avatar_version=_version(row["avatar_path"]),
                                 verified=row["verified"]),
            status=row["status"], visibility=row["visibility"], caption=row["caption"],
            tags=PostTags(garment=row["tag_garment"], fabric=row["tag_fabric"], occasion=row["tag_occasion"]),
            palette=row["palette"], fabrics=row["fabrics"],
            images=[PostImage(id=i["id"], kind=i["kind"]) for i in row["images"]],
            pinned=row["pinned"], like_count=row["like_count"], save_count=row["save_count"],
            liked_by_me=row["liked_by_me"], saved_by_me=row["saved_by_me"], is_mine=mine,
            repost_count=row["repost_count"], reposted_by_me=row["reposted_by_me"],
            can_repost=(row["status"] == "published" and row["visibility"] == "public"
                        and not row["author_private"] and not mine),
            comment_count=row["comment_count"],
            can_comment=row["status"] == "published" and row["can_comment"],
            deleted_at=iso(row["deleted_at"]) if mine else None,
            reposted_by=person(reposter) if reposter else None,
            project_id=row["project_id"] if mine else None,
            published_at=iso(row["published_at"]), created_at=iso(row["created_at"]), updated_at=iso(row["updated_at"]),
        )

    def _rows(self, where: str, values: dict[str, Any], order: str, order_by: str, join: str, reposter: str,
              limit: int) -> list[dict[str, Any]]:
        """Run the shared post query. Every SQL piece passed in is fixed text from this file only."""
        query = POST_SELECT.format(order=order, join=join, where=where, reposter=reposter)
        query += f" ORDER BY {order_by} LIMIT %(limit)s"
        with self._conn() as conn:
            return conn.execute(query, {"me": self.user_id, **values, "limit": limit}).fetchall()

    def _page(self, where: str, params: dict[str, Any], order: str, cursor: str | None,
              join: str = "", limit: int = PAGE_SIZE, reposter: str = "NULL::json") -> PostPage:
        """Newest first, `limit` at a time."""
        after = _decode_cursor(cursor)
        clauses = [where]
        values = dict(params)
        if after:
            clauses.append(f"({order}, p.id) < (%(after_time)s, %(after_id)s)")
            values |= {"after_time": after[0], "after_id": after[1]}
        rows = self._rows(" AND ".join(clauses), values, order, f"{order} DESC, p.id DESC", join, reposter, limit + 1)
        more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = _encode_cursor(rows[-1]["sort_time"], rows[-1]["id"]) if more and rows else None
        return PostPage(posts=[self._post(r) for r in rows], next_cursor=next_cursor)

    def get_post(self, post_id: str, include_deleted: bool = False) -> Post:
        where = "p.id = %(id)s" if include_deleted else "p.id = %(id)s AND p.status <> 'deleted'"
        page = self._page(where, {"id": check_id(post_id, "Post")}, "p.created_at", None, limit=1)
        if not page.posts:
            raise NotFoundError("Post not found")
        return page.posts[0]

    def feed(self, cursor: str | None) -> PostPage:
        """Every published post you may see (Row Level Security hides the rest), minus muted people.
        A post that someone you follow reposted moves up to the time of that repost and says so."""
        join = (
            "LEFT JOIN LATERAL (SELECT r.user_id, r.created_at FROM reposts r"
            " JOIN follows f ON f.follower_id = %(me)s AND f.following_id = r.user_id"
            " WHERE r.post_id = p.id AND NOT EXISTS (SELECT 1 FROM mutes m2 WHERE m2.muter_id = %(me)s"
            " AND m2.muted_id = r.user_id) ORDER BY r.created_at DESC LIMIT 1) rp ON true"
        )
        order = "GREATEST(p.published_at, COALESCE(rp.created_at, p.published_at))"
        return self._page(f"p.status = 'published' AND {NOT_MUTED}", {}, order, cursor, join=join,
                          reposter=_person_json("rp.user_id"))

    def profile_posts(self, username: str, cursor: str | None) -> tuple[list[Post], PostPage]:
        """(pinned posts, a page of the other published posts) for a profile grid."""
        with self._conn() as conn:
            uid = self._profile_row(conn, username)["id"]
        pinned = [] if cursor else self._page("p.author_id = %(u)s AND p.status = 'published' AND p.pinned",
                                             {"u": uid}, "p.published_at", None, limit=MAX_PINNED).posts
        rest = self._page("p.author_id = %(u)s AND p.status = 'published' AND NOT p.pinned", {"u": uid},
                          "p.published_at", cursor)
        return pinned, rest

    def profile_reposts(self, username: str, cursor: str | None) -> PostPage:
        """Posts this person reposted, newest repost first (hidden for a private account you do not follow)."""
        with self._conn() as conn:
            uid = self._profile_row(conn, username)["id"]
        return self._page("p.status = 'published'", {"u": uid}, "r.created_at", cursor,
                          join="JOIN reposts r ON r.post_id = p.id AND r.user_id = %(u)s",
                          reposter=_person_json("r.user_id"))

    def my_posts(self, status: str, cursor: str | None) -> PostPage:
        order = "p.deleted_at" if status == "deleted" else "p.updated_at"
        return self._page("p.author_id = %(me)s AND p.status = %(status)s", {"status": status}, order, cursor)

    def liked(self, cursor: str | None) -> PostPage:
        """Posts you liked (that you may still see), newest like first."""
        return self._page("p.status = 'published'", {}, "l.created_at", cursor,
                          join="JOIN post_likes l ON l.post_id = p.id AND l.user_id = %(me)s")

    def saved(self, cursor: str | None) -> PostPage:
        return self._page("p.status = 'published'", {}, "s.created_at", cursor,
                          join="JOIN post_saves s ON s.post_id = p.id AND s.user_id = %(me)s")

    def image(self, image_id: str) -> tuple[str, str]:
        """(storage path, type) of a post picture you are allowed to see."""
        with self._conn() as conn:
            row = conn.execute("SELECT storage_path, mime_type FROM post_images WHERE id = %s",
                               (check_id(image_id, "Picture"),)).fetchone()
            if row is None:
                raise NotFoundError("Picture not found")
            return row["storage_path"], row["mime_type"]

    # ---------- likes, saves and reposts ----------

    def set_reaction(self, post_id: str, table: str, on: bool) -> Post:
        if table not in ("post_likes", "post_saves"):
            raise ValueError(table)
        pid = check_id(post_id, "Post")
        with self._conn() as conn:
            visible = conn.execute("SELECT 1 FROM posts WHERE id = %s AND status = 'published'", (pid,)).fetchone()
            if visible is None:
                raise NotFoundError("Post not found")
            target = sql.Identifier(table)
            if on:
                conn.execute(sql.SQL("INSERT INTO {} (post_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING")
                             .format(target), (pid, self.user_id))
            else:
                conn.execute(sql.SQL("DELETE FROM {} WHERE post_id = %s AND user_id = %s").format(target),
                             (pid, self.user_id))
        return self.get_post(pid)

    def set_repost(self, post_id: str, on: bool) -> Post:
        post = self.get_post(post_id)  # "not found" if you may not see it
        if on:
            if post.status != "published":
                raise NotFoundError("Post not found")
            if post.is_mine:
                raise SocialError("You cannot repost your own post.")
            if not post.can_repost:
                raise SocialError("Only Public posts from public accounts can be reposted.")
            self.require_profile()
        with self._conn() as conn:
            if on:
                conn.execute("INSERT INTO reposts (user_id, post_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                             (self.user_id, post.id))
            else:
                conn.execute("DELETE FROM reposts WHERE user_id = %s AND post_id = %s", (self.user_id, post.id))
        return self.get_post(post.id)

    # ---------- Explore and search ----------

    @staticmethod
    def _explore_where(filters: dict[str, str], text: str = "") -> tuple[str, dict[str, Any]]:
        clauses, values = [EXPLORE_WHERE], {}
        for name, value in filters.items():
            if value and value.strip():
                clauses.append(FILTERS[name])
                values[name] = value.strip()
        if text:
            clauses.append(TEXT_MATCH)
            values["q"] = _like_pattern(text, anywhere=True)
        return " AND ".join(clauses), values

    def explore(self, cursor: str | None, filters: dict[str, str]) -> PostPage:
        """Newest Public posts from public accounts, optionally filtered."""
        where, values = self._explore_where(filters)
        return self._page(where, values, "p.published_at", cursor)

    def trending(self, filters: dict[str, str]) -> PostPage:
        """The most liked + saved Explore posts of the last 7 days (one list, no pages)."""
        where, values = self._explore_where(filters)
        rows = self._rows(f"{where} AND trending_score(p.id) > 0", values, "p.published_at",
                          "trending_score(p.id) DESC, p.published_at DESC, p.id DESC", "", "NULL::json", TRENDING_SIZE)
        return PostPage(posts=[self._post(r) for r in rows], next_cursor=None)

    def explore_filters(self) -> ExploreFilters:
        """The most used garments, occasions, colours and fabrics in Explore posts."""
        query = f"""
        WITH ep AS (SELECT p.* FROM posts p JOIN profiles pr ON pr.id = p.author_id WHERE {EXPLORE_WHERE}),
        vals AS (
          SELECT 'garment' AS kind, id, tag_garment AS v FROM ep
          UNION ALL SELECT 'occasion', id, tag_occasion FROM ep
          UNION ALL SELECT 'colour', id, c->>'name' FROM ep, jsonb_array_elements(ep.palette) c
          UNION ALL SELECT 'fabric', id, tag_fabric FROM ep
          UNION ALL SELECT 'fabric', id, f->>'name' FROM ep, jsonb_array_elements(ep.fabrics) f
        )
        SELECT kind, min(btrim(v)) AS value, count(DISTINCT id) AS n FROM vals
        WHERE btrim(coalesce(v, '')) <> '' GROUP BY kind, lower(btrim(v)) ORDER BY n DESC, value
        """
        with self._conn() as conn:
            rows = conn.execute(query, {"me": self.user_id}).fetchall()
        out: dict[str, list[FilterOption]] = {"garment": [], "occasion": [], "colour": [], "fabric": []}
        for r in rows:
            if len(out[r["kind"]]) < FILTER_OPTIONS:
                out[r["kind"]].append(FilterOption(value=r["value"], count=r["n"]))
        return ExploreFilters(garments=out["garment"], occasions=out["occasion"], colours=out["colour"],
                              fabrics=out["fabric"])

    def search(self, query: str) -> SearchResults:
        """People, tags and Explore posts matching the words."""
        text = query.strip().lstrip("#@")
        if len(text) < 2:
            return SearchResults(people=[], tags=[], posts=[])
        tag_query = f"""
        WITH ep AS (SELECT p.* FROM posts p JOIN profiles pr ON pr.id = p.author_id WHERE {EXPLORE_WHERE}),
        vals AS (
          SELECT 'garment' AS kind, tag_garment AS v FROM ep
          UNION ALL SELECT 'fabric', tag_fabric FROM ep
          UNION ALL SELECT 'occasion', tag_occasion FROM ep
        )
        SELECT kind, min(btrim(v)) AS value, count(*) AS n FROM vals
        WHERE btrim(v) <> '' AND v ILIKE %(q)s GROUP BY kind, lower(btrim(v)) ORDER BY n DESC, value LIMIT 10
        """
        with self._conn() as conn:
            tags = conn.execute(tag_query, {"me": self.user_id, "q": _like_pattern(text, anywhere=True)}).fetchall()
        where, values = self._explore_where({}, text)
        posts = self._page(where, values, "p.published_at", None).posts
        return SearchResults(people=self.search_people(text),
                             tags=[TagResult(kind=t["kind"], value=t["value"], count=t["n"]) for t in tags],
                             posts=posts)
