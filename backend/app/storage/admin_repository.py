"""The admin panel (Phase 6E): reports queue, removing content, warnings, suspensions, problem
reports, verification requests, stats and the action log.

Moderation has to see and change other people's things, which Row Level Security
(rightly) forbids for normal sessions. So: `require_admin` in routers/admin.py first
checks is_admin() in the signed-in person's own session, and only then is this class
used. It runs on the "system" connection, and every change it makes is written to
admin_actions in the same transaction.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.schemas.admin import (
    AdminAction,
    AdminProblemReport,
    AdminReport,
    AdminStats,
    AdminSuspension,
    VerificationRequest,
)
from app.schemas.social import PersonSummary
from app.storage.database import Database
from app.storage.member_repository import suspension_from, verification_request
from app.storage.repository import NotFoundError, check_id, iso, now
from app.storage.social_repository import SocialError, _version

LIST_SIZE = 100


def _who(row: dict[str, Any], prefix: str) -> PersonSummary | None:
    """A person from columns named <prefix>id, <prefix>username, ... (null when they have no profile)."""
    if not row.get(f"{prefix}username"):
        return None
    return PersonSummary(user_id=row[f"{prefix}id"], username=row[f"{prefix}username"],
                         display_name=row[f"{prefix}display_name"], has_avatar=bool(row[f"{prefix}avatar_path"]),
                         avatar_version=_version(row[f"{prefix}avatar_path"]), verified=row[f"{prefix}verified"])


def _person_cols(alias: str, prefix: str) -> str:
    return ", ".join(f"{alias}.{c} AS {prefix}{c}" for c in ("id", "username", "display_name", "avatar_path", "verified"))


class AdminRepository:
    def __init__(self, db: Database, admin_id: str) -> None:
        self.db = db
        self.admin_id = check_id(admin_id, "User")

    def _conn(self):
        return self.db.connect(None)

    def _log(self, conn: Connection, action: str, *, user: str | None = None, report: str | None = None,
             target: str | None = None, note: str = "", details: dict[str, Any] | None = None) -> None:
        conn.execute("INSERT INTO admin_actions (admin_id, action, target_user_id, report_id, target_id, note, details)"
                     " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                     (self.admin_id, action, user, report, target, note[:1000], Jsonb(details or {})))

    # ---------- stats ----------

    def stats(self) -> AdminStats:
        query = """
        SELECT (SELECT count(*) FROM auth.users) AS total_users,
               (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days') AS new_users,
               (SELECT count(*) FROM profiles) AS profiles,
               (SELECT count(*) FROM posts WHERE status = 'published') AS posts,
               (SELECT count(*) FROM reports WHERE status IN ('open', 'reviewing')) AS reports,
               (SELECT count(*) FROM problem_reports WHERE status IN ('open', 'reviewing')) AS problems,
               (SELECT count(*) FROM verification_requests WHERE status = 'pending') AS verifications,
               (SELECT count(*) FROM account_suspensions WHERE lifted_at IS NULL AND starts_at <= now()
                  AND (ends_at IS NULL OR ends_at > now())) AS suspensions
        """
        with self._conn() as conn:
            r = conn.execute(query).fetchone()
        return AdminStats(total_users=r["total_users"], new_users_this_week=r["new_users"], profiles=r["profiles"],
                          published_posts=r["posts"], open_reports=r["reports"], open_problem_reports=r["problems"],
                          pending_verifications=r["verifications"], active_suspensions=r["suspensions"])

    # ---------- reports ----------

    def reports(self, status: str, target_type: str = "") -> list[AdminReport]:
        """Reports, oldest open first (newest first for closed ones)."""
        order = "r.created_at" if status == "open" else "COALESCE(r.resolved_at, r.created_at) DESC"
        query = f"""
        SELECT r.*, {_person_cols('rp', 'rp_')}, {_person_cols('tp', 'tp_')},
               (CASE r.target_type
                  WHEN 'post' THEN EXISTS (SELECT 1 FROM posts p WHERE p.id = r.post_id AND p.status <> 'deleted')
                  WHEN 'comment' THEN EXISTS (SELECT 1 FROM comments c WHERE c.id = r.comment_id)
                  WHEN 'message' THEN EXISTS (SELECT 1 FROM messages m WHERE m.id = r.message_id)
                  ELSE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.reported_user_id) END) AS target_exists,
               (SELECT count(*) FROM reports o WHERE o.reported_user_id = r.reported_user_id
                  AND o.status IN ('open', 'reviewing')) AS about_person
        FROM reports r
        LEFT JOIN profiles rp ON rp.id = r.reporter_id
        LEFT JOIN profiles tp ON tp.id = r.reported_user_id
        WHERE (r.status IN ('open', 'reviewing')) = %(open)s AND (%(type)s = '' OR r.target_type = %(type)s)
        ORDER BY {order} LIMIT %(limit)s
        """
        with self._conn() as conn:
            rows = conn.execute(query, {"open": status == "open", "type": target_type, "limit": LIST_SIZE}).fetchall()
        return [AdminReport(id=r["id"], target_type=r["target_type"], reason=r["reason"], details=r["details"],
                            excerpt=r["excerpt"], status=r["status"], created_at=iso(r["created_at"]) or "",
                            reporter=_who(r, "rp_"), reported=_who(r, "tp_"), reported_user_id=r["reported_user_id"],
                            post_id=r["post_id"], comment_id=r["comment_id"], message_id=r["message_id"],
                            target_exists=r["target_exists"], reports_about_person=r["about_person"],
                            resolution_note=r["resolution_note"], resolved_at=iso(r["resolved_at"])) for r in rows]

    def _report(self, conn: Connection, report_id: str) -> dict[str, Any]:
        row = conn.execute("SELECT * FROM reports WHERE id = %s FOR UPDATE", (check_id(report_id, "Report"),)).fetchone()
        if row is None:
            raise NotFoundError("Report not found")
        return row

    def _close(self, conn: Connection, report: dict[str, Any], status: str, note: str) -> None:
        conn.execute("UPDATE reports SET status = %s, resolved_at = now(), resolved_by = %s, resolution_note = %s"
                     " WHERE id = %s", (status, self.admin_id, note[:1000], report["id"]))

    def dismiss(self, report_id: str, note: str) -> None:
        with self._conn() as conn:
            report = self._report(conn, report_id)
            self._close(conn, report, "dismissed", note)
            self._log(conn, "dismiss_report", user=report["reported_user_id"], report=report["id"], note=note)

    def resolve(self, report_id: str, note: str) -> None:
        with self._conn() as conn:
            report = self._report(conn, report_id)
            self._close(conn, report, "resolved", note)
            self._log(conn, "resolve_report", user=report["reported_user_id"], report=report["id"], note=note)

    def remove_content(self, report_id: str, note: str) -> list[str]:
        """Delete the reported post, comment or message for good, close this report and every other open
        report about the same thing. Returns storage paths to delete."""
        tables = {"post": ("posts", "post_id"), "comment": ("comments", "comment_id"), "message": ("messages", "message_id")}
        with self._conn() as conn:
            report = self._report(conn, report_id)
            kind = report["target_type"]
            if kind == "user":
                raise SocialError("An account cannot be removed from here. Warn or suspend the person instead.")
            table, column = tables[kind]
            target = report[column]
            if target is None or conn.execute(f"SELECT 1 FROM {table} WHERE id = %s", (target,)).fetchone() is None:
                raise SocialError("It is already gone (deleted by its author or another admin).")
            note = note or "Removed by an admin"
            # Close the other reports first: deleting sets their link to the content to empty.
            conn.execute(f"UPDATE reports SET status = 'resolved', resolved_at = now(), resolved_by = %s,"
                         f" resolution_note = %s WHERE {column} = %s AND status IN ('open', 'reviewing')",
                         (self.admin_id, note[:1000], target))
            paths: list[str] = []
            if kind == "post":
                paths = [r["storage_path"] for r in conn.execute(
                    "SELECT storage_path FROM post_images WHERE post_id = %s", (target,)).fetchall()]
            elif kind == "message":
                image = conn.execute("SELECT image_path FROM messages WHERE id = %s", (target,)).fetchone()["image_path"]
                paths = [image] if image else []
            conn.execute(f"DELETE FROM {table} WHERE id = %s", (target,))  # table and column come from `tables` above
            self._close(conn, report, "resolved", note)
            self._log(conn, f"remove_{kind}", user=report["reported_user_id"], report=report["id"], target=target,
                      note=note, details={"excerpt": report["excerpt"]})
            return paths

    # ---------- people: warn, suspend ----------

    def _exists(self, conn: Connection, user_id: str) -> str:
        uid = check_id(user_id, "User")
        if conn.execute("SELECT 1 FROM auth.users WHERE id = %s", (uid,)).fetchone() is None:
            raise NotFoundError("Account not found")
        if uid == self.admin_id:
            raise SocialError("You cannot do this to your own account.")
        return uid

    def warn(self, user_id: str, reason: str, report_id: str | None) -> None:
        with self._conn() as conn:
            uid = self._exists(conn, user_id)
            report = self._report(conn, report_id) if report_id else None
            conn.execute("INSERT INTO user_warnings (user_id, reason, report_id, created_by) VALUES (%s, %s, %s, %s)",
                         (uid, reason.strip(), report["id"] if report else None, self.admin_id))
            if report:
                self._close(conn, report, "resolved", f"Warned: {reason.strip()}")
            self._log(conn, "warn_user", user=uid, report=report["id"] if report else None, note=reason.strip())

    def suspend(self, user_id: str, reason: str, days: int | None, report_id: str | None) -> None:
        with self._conn() as conn:
            uid = self._exists(conn, user_id)
            report = self._report(conn, report_id) if report_id else None
            ends = now() + timedelta(days=days) if days else None
            conn.execute("INSERT INTO account_suspensions (user_id, reason, ends_at, created_by) VALUES (%s, %s, %s, %s)",
                         (uid, reason.strip(), ends, self.admin_id))
            if report:
                self._close(conn, report, "resolved", f"Suspended ({f'{days} days' if days else 'permanently'}): {reason.strip()}")
            self._log(conn, "suspend_user", user=uid, report=report["id"] if report else None, note=reason.strip(),
                      details={"days": days, "permanent": days is None})

    def lift(self, suspension_id: str, note: str) -> None:
        with self._conn() as conn:
            row = conn.execute("UPDATE account_suspensions SET lifted_at = now(), lifted_by = %s WHERE id = %s"
                               " AND lifted_at IS NULL RETURNING user_id", (self.admin_id, check_id(suspension_id, "Suspension"))
                               ).fetchone()
            if row is None:
                raise NotFoundError("Suspension not found")
            self._log(conn, "lift_suspension", user=row["user_id"], target=suspension_id, note=note)

    def suspensions(self) -> list[AdminSuspension]:
        """Suspensions that are active now, newest first."""
        query = f"""
        SELECT s.*, {_person_cols('p', 'p_')} FROM account_suspensions s LEFT JOIN profiles p ON p.id = s.user_id
        WHERE s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())
        ORDER BY s.created_at DESC LIMIT %s
        """
        with self._conn() as conn:
            rows = conn.execute(query, (LIST_SIZE,)).fetchall()
        return [AdminSuspension(**suspension_from(r).model_dump(), user_id=r["user_id"], person=_who(r, "p_"),
                                lifted_at=iso(r["lifted_at"])) for r in rows]

    # ---------- problem reports ----------

    def problem_reports(self, status: str) -> list[AdminProblemReport]:
        query = f"""
        SELECT pr.*, u.email, {_person_cols('p', 'p_')} FROM problem_reports pr
        LEFT JOIN auth.users u ON u.id = pr.user_id LEFT JOIN profiles p ON p.id = pr.user_id
        WHERE (pr.status IN ('open', 'reviewing')) = %s ORDER BY pr.created_at DESC LIMIT %s
        """
        with self._conn() as conn:
            rows = conn.execute(query, (status == "open", LIST_SIZE)).fetchall()
        return [AdminProblemReport(id=r["id"], category=r["category"], description=r["description"], page=r["page"],
                                   browser=r["browser"], status=r["status"], has_screenshot=bool(r["screenshot_path"]),
                                   created_at=iso(r["created_at"]) or "", person=_who(r, "p_"), email=r["email"])
                for r in rows]

    def set_problem_status(self, report_id: str, status: str, note: str) -> None:
        with self._conn() as conn:
            done = conn.execute("UPDATE problem_reports SET status = %s WHERE id = %s RETURNING user_id",
                                (status, check_id(report_id, "Problem report"))).fetchone()
            if done is None:
                raise NotFoundError("Problem report not found")
            self._log(conn, "update_problem_report", user=done["user_id"], target=report_id, note=note,
                      details={"status": status})

    def problem_screenshot(self, report_id: str) -> tuple[str, str]:
        with self._conn() as conn:
            row = conn.execute("SELECT screenshot_path, screenshot_mime FROM problem_reports WHERE id = %s",
                               (check_id(report_id, "Problem report"),)).fetchone()
        if row is None or not row["screenshot_path"]:
            raise NotFoundError("Screenshot not found")
        return row["screenshot_path"], row["screenshot_mime"]

    # ---------- verification ----------

    def verification_requests(self, status: str) -> list[VerificationRequest]:
        query = f"""
        SELECT v.*, {_person_cols('p', 'p_')} FROM verification_requests v LEFT JOIN profiles p ON p.id = v.user_id
        WHERE v.status = %s ORDER BY v.created_at {'' if status == 'pending' else 'DESC'} LIMIT %s
        """
        with self._conn() as conn:
            rows = conn.execute(query, (status, LIST_SIZE)).fetchall()
        return [verification_request(r).model_copy(update={"person": _who(r, "p_")}) for r in rows]

    def review_verification(self, request_id: str, approve: bool, note: str) -> None:
        with self._conn() as conn:
            row = conn.execute("UPDATE verification_requests SET status = %s, review_note = %s, reviewed_by = %s,"
                               " reviewed_at = now() WHERE id = %s AND status = 'pending' RETURNING user_id",
                               ("approved" if approve else "rejected", note[:500], self.admin_id,
                                check_id(request_id, "Request"))).fetchone()
            if row is None:
                raise NotFoundError("Waiting request not found")
            if approve:
                conn.execute("INSERT INTO verified_accounts (user_id, source, granted_by) VALUES (%s, 'admin', %s)"
                             " ON CONFLICT (user_id) DO NOTHING", (row["user_id"], self.admin_id))
            self._log(conn, "approve_verification" if approve else "reject_verification", user=row["user_id"],
                      target=request_id, note=note)

    def remove_verification(self, user_id: str, note: str) -> None:
        with self._conn() as conn:
            gone = conn.execute("DELETE FROM verified_accounts WHERE user_id = %s RETURNING user_id",
                                (check_id(user_id, "User"),)).fetchone()
            if gone is None:
                raise NotFoundError("This account is not verified")
            self._log(conn, "remove_verification", user=gone["user_id"], note=note)

    # ---------- log ----------

    def actions(self) -> list[AdminAction]:
        query = f"""
        SELECT a.*, {_person_cols('ap', 'a_')}, {_person_cols('tp', 't_')} FROM admin_actions a
        LEFT JOIN profiles ap ON ap.id = a.admin_id LEFT JOIN profiles tp ON tp.id = a.target_user_id
        ORDER BY a.created_at DESC LIMIT %s
        """
        with self._conn() as conn:
            rows = conn.execute(query, (LIST_SIZE,)).fetchall()
        return [AdminAction(id=r["id"], action=r["action"], admin=_who(r, "a_"), target=_who(r, "t_"), note=r["note"],
                            details=r["details"], created_at=iso(r["created_at"]) or "") for r in rows]
