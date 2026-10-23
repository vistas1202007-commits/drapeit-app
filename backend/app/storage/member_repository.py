"""The signed-in person's own onboarding, verification request, warnings and suspension (Phase 6E).

Works for ONE signed-in user in their own database session, so Row Level Security
(migration 0010) only shows them their own rows.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.schemas.admin import (
    Interests,
    Onboarding,
    OnboardingUpdate,
    SuggestedPerson,
    Suspension,
    VerificationRequest,
    VerificationState,
    Warning,
)
from app.storage.database import Database
from app.storage.repository import NotFoundError, check_id, iso, now
from app.storage.social_repository import SocialError, person

SUGGESTIONS = 10
# The roles worth suggesting to follow.
CREATOR_ROLES = ("designer", "boutique", "tailor")


def suspension_from(row: dict[str, Any]) -> Suspension:
    return Suspension(id=row["id"], reason=row["reason"], starts_at=iso(row["starts_at"]) or "",
                      ends_at=iso(row["ends_at"]), permanent=row["ends_at"] is None)


def suspension_message(s: Suspension) -> str:
    """What a suspended person is told when they try to post, comment, repost or message."""
    when = "permanently" if s.permanent else f"until {s.ends_at[:16].replace('T', ' ')} UTC" if s.ends_at else ""
    return (f"Your account is suspended {when}. Reason: {s.reason} You can still read and browse, but you cannot "
            "post, comment, repost or send messages. If you think this is a mistake, use Help → Report a problem.")


def verification_request(row: dict[str, Any]) -> VerificationRequest:
    return VerificationRequest(id=row["id"], reason=row["reason"], portfolio_url=row["portfolio_url"], status=row["status"],
                               review_note=row["review_note"], created_at=iso(row["created_at"]) or "",
                               reviewed_at=iso(row["reviewed_at"]))


class MemberRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    # ---------- admin, suspension, warnings ----------

    def is_admin(self) -> bool:
        with self._conn() as conn:
            return conn.execute("SELECT is_admin() AS ok").fetchone()["ok"]

    def active_suspension(self) -> Suspension | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM account_suspensions WHERE user_id = %s AND lifted_at IS NULL AND starts_at <= now()"
                " AND (ends_at IS NULL OR ends_at > now()) ORDER BY ends_at DESC NULLS FIRST LIMIT 1", (self.user_id,),
            ).fetchone()
        return suspension_from(row) if row else None

    def warnings(self) -> list[Warning]:
        """Warnings you have not acknowledged yet, newest first."""
        with self._conn() as conn:
            rows = conn.execute("SELECT id, reason, created_at FROM user_warnings WHERE user_id = %s"
                                " AND acknowledged_at IS NULL ORDER BY created_at DESC", (self.user_id,)).fetchall()
        return [Warning(id=r["id"], reason=r["reason"], created_at=iso(r["created_at"]) or "") for r in rows]

    def acknowledge(self, warning_id: str) -> None:
        with self._conn() as conn:
            done = conn.execute("UPDATE user_warnings SET acknowledged_at = now() WHERE id = %s AND user_id = %s"
                                " RETURNING id", (check_id(warning_id, "Warning"), self.user_id)).fetchone()
        if done is None:
            raise NotFoundError("Warning not found")

    # ---------- onboarding ----------

    def onboarding(self) -> Onboarding:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM onboarding_progress WHERE user_id = %s", (self.user_id,)).fetchone()
            has_profile = conn.execute("SELECT 1 FROM profiles WHERE id = %s", (self.user_id,)).fetchone() is not None
        if row is None:
            return Onboarding(step="profile", interests=Interests(), completed=False, skipped=False,
                              has_profile=has_profile, is_new=not has_profile)
        return Onboarding(step=row["step"], interests=Interests(**row["interests"]), completed=row["completed_at"] is not None,
                          skipped=row["skipped_at"] is not None, has_profile=has_profile, started=True, is_new=False)

    def _upsert(self, fields: dict[str, Any]) -> Onboarding:
        """Insert or change your onboarding row. Column names come from the methods below only."""
        columns = ", ".join(fields)
        placeholders = ", ".join(f"%({k})s" for k in fields)
        updates = ", ".join(f"{k} = excluded.{k}" for k in fields)
        with self._conn() as conn:
            conn.execute(f"INSERT INTO onboarding_progress (user_id, {columns}) VALUES (%(me)s, {placeholders})"
                         f" ON CONFLICT (user_id) DO UPDATE SET {updates}, updated_at = now()",
                         fields | {"me": self.user_id})
        return self.onboarding()

    def save_onboarding(self, update: OnboardingUpdate) -> Onboarding:
        current = self.onboarding()
        fields: dict[str, Any] = {"step": update.step or current.step,
                                  "interests": Jsonb((update.interests or current.interests).model_dump())}
        if fields["step"] == "done":
            fields["completed_at"] = now()
        return self._upsert(fields)

    def skip(self) -> Onboarding:
        return self._upsert({"step": self.onboarding().step, "skipped_at": now()})

    def suggestions(self) -> list[SuggestedPerson]:
        """5-10 designers, boutiques and tailors to follow, those matching your interests first."""
        interests = self.onboarding().interests
        garments = [g.lower() for g in interests.garments]
        fabrics = [f.lower() for f in interests.fabrics]
        query = """
        SELECT pr.*, fc.followers,
               (SELECT count(*) FROM posts p WHERE p.author_id = pr.id AND p.status = 'published') AS posts,
               (SELECT count(*) FROM posts p WHERE p.author_id = pr.id AND p.status = 'published'
                  AND (lower(p.tag_garment) = ANY(%(g)s) OR lower(p.tag_fabric) = ANY(%(f)s))) AS matches
        FROM profiles pr CROSS JOIN LATERAL follow_counts(pr.id) fc
        WHERE pr.id <> %(me)s AND pr.role = ANY(%(roles)s)
          AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = %(me)s AND f.following_id = pr.id)
          AND NOT EXISTS (SELECT 1 FROM follow_requests r WHERE r.requester_id = %(me)s AND r.target_id = pr.id)
          AND NOT has_blocked(%(me)s, pr.id)
        ORDER BY matches DESC, pr.verified DESC, fc.followers DESC, posts DESC, pr.username
        LIMIT %(limit)s
        """
        with self._conn() as conn:
            rows = conn.execute(query, {"me": self.user_id, "g": garments, "f": fabrics, "roles": list(CREATOR_ROLES),
                                        "limit": SUGGESTIONS}).fetchall()
        return [SuggestedPerson(**person(r).model_dump(), role=r["role"], is_private=r["is_private"],
                                follower_count=r["followers"], post_count=r["posts"]) for r in rows]

    # ---------- verification ----------

    def verification(self) -> VerificationState:
        with self._conn() as conn:
            badge = conn.execute("SELECT source FROM verified_accounts WHERE user_id = %s", (self.user_id,)).fetchone()
            latest = conn.execute("SELECT * FROM verification_requests WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
                                  (self.user_id,)).fetchone()
        return VerificationState(verified=badge is not None, source=badge["source"] if badge else None,
                                 latest_request=verification_request(latest) if latest else None)

    def request_verification(self, reason: str, portfolio_url: str) -> VerificationState:
        with self._conn() as conn:
            if conn.execute("SELECT 1 FROM profiles WHERE id = %s", (self.user_id,)).fetchone() is None:
                raise SocialError("Set up your profile (choose a username) first.")
        try:
            with self._conn() as conn:
                conn.execute("INSERT INTO verification_requests (user_id, reason, portfolio_url) VALUES (%s, %s, %s)",
                             (self.user_id, reason, portfolio_url))
        except psycopg.errors.UniqueViolation:
            raise SocialError("Your request is already waiting for review.") from None
        except psycopg.errors.InsufficientPrivilege:
            raise SocialError("Your account is already verified.") from None
        return self.verification()
