"""All reading and writing of project data goes through this file.

Keeping database code in one place means the rest of the app never writes SQL.

`Repository` works for ONE signed-in user: every query runs inside that user's
database session (see database.py), so Row Level Security only shows their own
projects. `SystemRepository` is for app-wide bookkeeping (AI spending).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.schemas.api import (
    Asset,
    CanvasDocument,
    DesignVersion,
    GenerationJob,
    NotebookMessage,
    ProjectSummary,
)
from app.schemas.design_spec import DesignSpec
from app.storage.database import Database


class NotFoundError(Exception):
    """Raised when a project (or something inside it) does not exist, or is not yours."""


def now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now_iso() -> str:
    return iso(now()) or ""


def new_id() -> str:
    return str(uuid.uuid4())


def check_id(value: str, what: str = "Item") -> str:
    """Ids are UUIDs. Anything else cannot exist, so it is 'not found' (never a database error)."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise NotFoundError(f"{what} not found") from None


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class Repository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    # ---------- projects ----------

    def _project_row(self, conn: Connection, project_id: str) -> dict[str, Any]:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = %s AND owner_id = %s", (check_id(project_id, "Project"), self.user_id)
        ).fetchone()
        if row is None:
            raise NotFoundError("Project not found")
        return row

    def _summary(self, conn: Connection, row: dict[str, Any]) -> ProjectSummary:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM generation_jobs WHERE project_id = %s AND status = 'succeeded'", (row["id"],)
        ).fetchone()["n"]
        return ProjectSummary(
            id=row["id"], title=row["title"], garment_category=row["garment_category"],
            current_version=row["current_version"], thumbnail_asset_id=row["thumbnail_asset_id"],
            output_count=count, created_at=iso(row["created_at"]), updated_at=iso(row["updated_at"]),
        )

    def list_projects(self, search: str = "", garment_category: str = "") -> list[ProjectSummary]:
        sql = "SELECT * FROM projects WHERE owner_id = %s"
        params: list[Any] = [self.user_id]
        if search:
            sql += " AND (title ILIKE %s OR garment_category ILIKE %s)"
            params += [_like(search), _like(search)]
        if garment_category:
            sql += " AND garment_category = %s"
            params.append(garment_category)
        sql += " ORDER BY updated_at DESC"
        with self._conn() as conn:
            return [self._summary(conn, r) for r in conn.execute(sql, params).fetchall()]

    def create_project(self, title: str, garment_category: str, spec: DesignSpec) -> ProjectSummary:
        pid, ts = new_id(), now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO projects (id, owner_id, title, garment_category, current_version, created_at, updated_at)"
                " VALUES (%s, %s, %s, %s, 1, %s, %s)",
                (pid, self.user_id, title, garment_category, ts, ts),
            )
            conn.execute(
                "INSERT INTO design_versions (id, project_id, version_number, spec, note, created_at)"
                " VALUES (%s, %s, 1, %s, %s, %s)",
                (new_id(), pid, Jsonb(spec.model_dump(mode="json")), "Project created", ts),
            )
            return self._summary(conn, self._project_row(conn, pid))

    def get_project(self, project_id: str) -> ProjectSummary:
        with self._conn() as conn:
            return self._summary(conn, self._project_row(conn, project_id))

    def rename_project(self, project_id: str, title: str) -> ProjectSummary:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            conn.execute("UPDATE projects SET title = %s, updated_at = %s WHERE id = %s", (title, now(), row["id"]))
            return self._summary(conn, self._project_row(conn, project_id))

    def _touch(self, conn: Connection, project_id: str) -> None:
        conn.execute("UPDATE projects SET updated_at = %s WHERE id = %s", (now(), project_id))

    def delete_project(self, project_id: str) -> list[str]:
        """Delete a project and return the storage paths of its files (to remove from Storage)."""
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            paths = [r["storage_path"] for r in conn.execute(
                "SELECT storage_path FROM assets WHERE project_id = %s", (row["id"],)).fetchall()]
            # The thumbnail points at an asset; clear it first so the cascade can delete assets.
            conn.execute("UPDATE projects SET thumbnail_asset_id = NULL WHERE id = %s", (row["id"],))
            conn.execute("DELETE FROM projects WHERE id = %s", (row["id"],))
            return paths

    # ---------- versions ----------

    @staticmethod
    def _version(row: dict[str, Any]) -> DesignVersion:
        return DesignVersion(
            id=row["id"], project_id=row["project_id"], version_number=row["version_number"],
            spec=DesignSpec.model_validate(row["spec"]), note=row["note"], created_at=iso(row["created_at"]),
        )

    def list_versions(self, project_id: str) -> list[DesignVersion]:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            rows = conn.execute(
                "SELECT * FROM design_versions WHERE project_id = %s ORDER BY version_number DESC", (row["id"],)
            ).fetchall()
            return [self._version(r) for r in rows]

    def get_version(self, project_id: str, version_number: int) -> DesignVersion:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            version = conn.execute(
                "SELECT * FROM design_versions WHERE project_id = %s AND version_number = %s",
                (row["id"], version_number),
            ).fetchone()
            if version is None:
                raise NotFoundError(f"Version {version_number} not found")
            return self._version(version)

    def current_version(self, project_id: str) -> DesignVersion:
        project = self.get_project(project_id)
        return self.get_version(project_id, project.current_version)

    def add_version(self, project_id: str, spec: DesignSpec, note: str) -> DesignVersion:
        """Save a new version of the design. Older versions are kept untouched."""
        ts = now()
        with self._conn() as conn:
            # Lock the project row so two saves at once cannot both take the same number.
            row = conn.execute(
                "SELECT * FROM projects WHERE id = %s AND owner_id = %s FOR UPDATE",
                (check_id(project_id, "Project"), self.user_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("Project not found")
            number = row["current_version"] + 1
            version = conn.execute(
                "INSERT INTO design_versions (id, project_id, version_number, spec, note, created_at)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                (new_id(), row["id"], number, Jsonb(spec.model_dump(mode="json")), note, ts),
            ).fetchone()
            # Keep the project's listed category in sync with the spec.
            conn.execute(
                "UPDATE projects SET current_version = %s, garment_category = %s, updated_at = %s WHERE id = %s",
                (number, spec.garment_category, ts, row["id"]),
            )
            return self._version(version)

    # ---------- notebook messages ----------

    def list_messages(self, project_id: str) -> list[NotebookMessage]:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            rows = conn.execute(
                "SELECT * FROM notebook_messages WHERE project_id = %s ORDER BY created_at, id", (row["id"],)
            ).fetchall()
            return [
                NotebookMessage(id=r["id"], project_id=r["project_id"], role=r["role"], content=r["content"],
                                is_mock=r["is_mock"], created_at=iso(r["created_at"]))
                for r in rows
            ]

    def add_message(self, project_id: str, role: str, content: str, is_mock: bool = False) -> NotebookMessage:
        mid, ts = new_id(), now()
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            conn.execute(
                "INSERT INTO notebook_messages (id, project_id, role, content, is_mock, created_at)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (mid, row["id"], role, content, is_mock, ts),
            )
            self._touch(conn, row["id"])
        return NotebookMessage(id=mid, project_id=row["id"], role=role, content=content, is_mock=is_mock,
                               created_at=iso(ts))

    def delete_message(self, project_id: str, message_id: str) -> None:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            cur = conn.execute("DELETE FROM notebook_messages WHERE id = %s AND project_id = %s",
                               (check_id(message_id, "Message"), row["id"]))
            if cur.rowcount == 0:
                raise NotFoundError("Message not found")

    # ---------- generation jobs ----------

    @staticmethod
    def _job(row: dict[str, Any]) -> GenerationJob:
        return GenerationJob(
            id=row["id"], project_id=row["project_id"], generator_id=row["generator_id"],
            version_number=row["version_number"], status=row["status"], provider=row["provider"],
            is_mock=row["is_mock"], output=row["output"], error=row["error"], created_at=iso(row["created_at"]),
            finished_at=iso(row["finished_at"]),
        )

    def create_job(
        self, project_id: str, generator_id: str, version_number: int, provider: str, is_mock: bool,
        options: dict[str, Any],
    ) -> GenerationJob:
        with self._conn() as conn:
            row = self._project_row(conn, project_id)
            job = conn.execute(
                "INSERT INTO generation_jobs (id, project_id, generator_id, version_number, status, provider,"
                " is_mock, options, created_at) VALUES (%s, %s, %s, %s, 'running', %s, %s, %s, %s) RETURNING *",
                (new_id(), row["id"], generator_id, version_number, provider, is_mock, Jsonb(options), now()),
            ).fetchone()
            return self._job(job)

    def finish_job(self, job_id: str, output: dict[str, Any] | None, error: str | None) -> GenerationJob:
        status = "failed" if error else "succeeded"
        with self._conn() as conn:
            row = conn.execute(
                "UPDATE generation_jobs SET status = %s, output = %s, error = %s, finished_at = %s WHERE id = %s"
                " RETURNING *",
                (status, Jsonb(output) if output is not None else None, error, now(), check_id(job_id, "Job")),
            ).fetchone()
            if row is None:
                raise NotFoundError("Job not found")
            self._touch(conn, row["project_id"])
            return self._job(row)

    def get_job(self, project_id: str, job_id: str) -> GenerationJob:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            row = conn.execute("SELECT * FROM generation_jobs WHERE id = %s AND project_id = %s",
                               (check_id(job_id, "Job"), project["id"])).fetchone()
            if row is None:
                raise NotFoundError("Job not found")
            return self._job(row)

    def get_job_options(self, job_id: str) -> dict[str, Any]:
        with self._conn() as conn:
            row = conn.execute("SELECT options FROM generation_jobs WHERE id = %s", (check_id(job_id, "Job"),)).fetchone()
            return row["options"] if row else {}

    def list_jobs(self, project_id: str) -> list[GenerationJob]:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            rows = conn.execute(
                "SELECT * FROM generation_jobs WHERE project_id = %s ORDER BY created_at DESC, id DESC", (project["id"],)
            ).fetchall()
            return [self._job(r) for r in rows]

    def latest_output(self, project_id: str, generator_id: str) -> dict[str, Any] | None:
        """The newest successful output of one generator in a project."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT output FROM generation_jobs WHERE project_id = %s AND generator_id = %s"
                " AND status = 'succeeded' ORDER BY created_at DESC, id DESC LIMIT 1",
                (check_id(project_id, "Project"), generator_id),
            ).fetchone()
            return row["output"] if row else None

    def delete_job(self, project_id: str, job_id: str) -> None:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            cur = conn.execute("DELETE FROM generation_jobs WHERE id = %s AND project_id = %s",
                               (check_id(job_id, "Job"), project["id"]))
            if cur.rowcount == 0:
                raise NotFoundError("Job not found")

    # ---------- assets ----------

    @staticmethod
    def _asset(row: dict[str, Any]) -> Asset:
        return Asset(
            id=row["id"], project_id=row["project_id"], kind=row["kind"], filename=row["filename"],
            mime_type=row["mime_type"], size_bytes=row["size_bytes"], created_at=iso(row["created_at"]),
            job_id=row["job_id"], generator_id=row["generator_id"], version_number=row["version_number"],
            provider=row["provider"], is_mock=row["is_mock"],
        )

    def storage_path(self, project_id: str, asset_id: str, extension: str) -> str:
        """Where a new file goes in Storage: <owner>/<project>/<asset><ext>."""
        return f"{self.user_id}/{check_id(project_id, 'Project')}/{check_id(asset_id, 'Asset')}{extension}"

    def add_asset(
        self, project_id: str, kind: str, filename: str, mime_type: str, size_bytes: int, storage_path: str,
        asset_id: str | None = None, job_id: str | None = None, generator_id: str | None = None,
        version_number: int | None = None, provider: str | None = None, is_mock: bool = False,
    ) -> Asset:
        aid = check_id(asset_id, "Asset") if asset_id else new_id()
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            row = conn.execute(
                "INSERT INTO assets (id, project_id, kind, filename, mime_type, size_bytes, storage_path,"
                " job_id, generator_id, version_number, provider, is_mock, created_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
                (aid, project["id"], kind, filename, mime_type, size_bytes, storage_path,
                 job_id, generator_id, version_number, provider, is_mock, now()),
            ).fetchone()
            if kind == "sketch":
                conn.execute("UPDATE projects SET thumbnail_asset_id = %s WHERE id = %s", (aid, project["id"]))
            elif kind == "generated":
                # A generated picture becomes the thumbnail only if the project has none yet.
                conn.execute(
                    "UPDATE projects SET thumbnail_asset_id = %s WHERE id = %s AND thumbnail_asset_id IS NULL",
                    (aid, project["id"]),
                )
            self._touch(conn, project["id"])
            return self._asset(row)

    def list_assets(self, project_id: str) -> list[Asset]:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            rows = conn.execute(
                "SELECT * FROM assets WHERE project_id = %s ORDER BY created_at DESC, id DESC", (project["id"],)
            ).fetchall()
            return [self._asset(r) for r in rows]

    def get_asset_with_path(self, asset_id: str) -> tuple[Asset, str]:
        """An asset of one of this user's projects (anyone else's is 'not found')."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT a.* FROM assets a JOIN projects p ON p.id = a.project_id"
                " WHERE a.id = %s AND p.owner_id = %s",
                (check_id(asset_id, "Asset"), self.user_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("Picture not found")
            return self._asset(row), row["storage_path"]

    def delete_asset(self, project_id: str, asset_id: str) -> str:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            aid = check_id(asset_id, "Asset")
            conn.execute(
                "UPDATE projects SET thumbnail_asset_id = NULL WHERE id = %s AND thumbnail_asset_id = %s",
                (project["id"], aid),
            )
            row = conn.execute("DELETE FROM assets WHERE id = %s AND project_id = %s RETURNING storage_path",
                               (aid, project["id"])).fetchone()
            if row is None:
                raise NotFoundError("Picture not found")
            return row["storage_path"]

    # ---------- canvas ----------

    # ---------- stitching guide checklist ----------

    def stitch_progress(self, project_id: str, version_number: int) -> list[str]:
        """The ticked steps of one design version's stitching guide."""
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            rows = conn.execute(
                "SELECT step_key FROM stitch_progress WHERE project_id = %s AND version_number = %s ORDER BY done_at",
                (project["id"], version_number),
            ).fetchall()
            return [r["step_key"] for r in rows]

    def set_stitch_step(self, project_id: str, version_number: int, step_key: str, done: bool) -> list[str]:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            if version_number > project["current_version"]:
                raise NotFoundError("Design version not found")
            if done:
                conn.execute(
                    "INSERT INTO stitch_progress (project_id, version_number, step_key) VALUES (%s, %s, %s)"
                    " ON CONFLICT DO NOTHING", (project["id"], version_number, step_key),
                )
            else:
                conn.execute(
                    "DELETE FROM stitch_progress WHERE project_id = %s AND version_number = %s AND step_key = %s",
                    (project["id"], version_number, step_key),
                )
        return self.stitch_progress(project_id, version_number)

    def get_canvas(self, project_id: str) -> CanvasDocument:
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            row = conn.execute("SELECT * FROM canvas_documents WHERE project_id = %s", (project["id"],)).fetchone()
            if row is None:
                return CanvasDocument(data={}, updated_at=None)
            return CanvasDocument(data=row["data"], updated_at=iso(row["updated_at"]))

    def save_canvas(self, project_id: str, data: dict[str, Any]) -> CanvasDocument:
        ts = now()
        with self._conn() as conn:
            project = self._project_row(conn, project_id)
            conn.execute(
                "INSERT INTO canvas_documents (project_id, data, updated_at) VALUES (%s, %s, %s)"
                " ON CONFLICT (project_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                (project["id"], Jsonb(data), ts),
            )
            self._touch(conn, project["id"])
        return CanvasDocument(data=data, updated_at=iso(ts))

    # ---------- usage (this user's own rows) ----------

    def recent_usage(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT u.created_at, u.service, u.provider, u.success, u.estimated_cost_usd, u.duration_ms,"
                " j.generator_id FROM provider_usage u LEFT JOIN generation_jobs j ON j.id = u.job_id"
                " WHERE u.owner_id = %s AND u.paid ORDER BY u.created_at DESC LIMIT %s",
                (self.user_id, limit),
            ).fetchall()
            return [r | {"created_at": iso(r["created_at"]), "estimated_cost_usd": float(r["estimated_cost_usd"])}
                    for r in rows]


class SystemRepository:
    """App-wide bookkeeping that is not about one user's projects."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def record_usage(
        self, owner_id: str | None, job_id: str | None, service: str, provider: str, is_mock: bool, success: bool,
        duration_ms: int, error: str | None, estimated_cost_usd: float = 0.0, paid: bool = False,
    ) -> None:
        with self.db.connect(None) as conn:
            conn.execute(
                "INSERT INTO provider_usage (id, owner_id, job_id, service, provider, is_mock, success, duration_ms,"
                " estimated_cost_usd, error, created_at, paid) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (new_id(), owner_id, job_id, service, provider, is_mock, success, duration_ms,
                 estimated_cost_usd, error, now(), paid),
            )

    def paid_spend_since(self, since: datetime) -> float:
        """Estimated US dollars spent on paid providers since a time, by all users together."""
        with self.db.connect(None) as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM provider_usage WHERE paid AND created_at >= %s",
                (since,),
            ).fetchone()
            return float(row["total"])

    def usage_totals(self, since: datetime) -> dict[str, Any]:
        with self.db.connect(None) as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= %s), 0) AS today_usd,"
                " COALESCE(SUM(estimated_cost_usd), 0) AS total_usd,"
                " COUNT(*) FILTER (WHERE created_at >= %s) AS paid_calls_today, COUNT(*) AS paid_calls_total"
                " FROM provider_usage WHERE paid",
                (since, since),
            ).fetchone()
            return {"today_usd": float(row["today_usd"]), "total_usd": float(row["total_usd"]),
                    "paid_calls_today": int(row["paid_calls_today"]), "paid_calls_total": int(row["paid_calls_total"])}
