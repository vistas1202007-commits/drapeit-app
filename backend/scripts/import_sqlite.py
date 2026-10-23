"""Copy projects from the old local SQLite database (Phases 1-4) into Supabase.

Everything is copied to ONE Supabase user (you): projects, design versions, notes,
generated outputs, the drawing canvas, AI spending records and the picture files.
Running it twice is safe: projects that are already in Supabase are skipped.

    python scripts/import_sqlite.py --email you@example.com
    python scripts/import_sqlite.py --email you@example.com --sqlite data/notebook.sqlite3

Sign up in the app once first (so your user exists), and fill in backend/.env.
Nothing is deleted from the old SQLite file.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.storage.database import Database  # noqa: E402
from app.storage.files import StorageError, SupabaseStorage  # noqa: E402

EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg"}


@dataclass
class Report:
    projects: int = 0
    skipped: int = 0
    files: int = 0
    missing_files: list[str] = field(default_factory=list)


def _id(value: str | None) -> str | None:
    """Old ids are 32 hex characters; the same id with dashes is the new UUID, so links inside outputs still work."""
    return str(uuid.UUID(value)) if value else None


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _json(value: str | None) -> Any:
    return json.loads(value) if value else None


def _columns(old: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in old.execute(f"PRAGMA table_info({table})")}


def import_sqlite(sqlite_path: Path, db: Database, store: SupabaseStorage, owner_id: str,
                  uploads_dir: Path | None = None) -> Report:
    report = Report()
    old = sqlite3.connect(sqlite_path)
    old.row_factory = sqlite3.Row
    has_paid = "paid" in _columns(old, "provider_usage")
    with db.connect(None) as conn:
        for p in old.execute("SELECT * FROM projects ORDER BY created_at"):
            pid = _id(p["id"])
            if conn.execute("SELECT 1 FROM projects WHERE id = %s", (pid,)).fetchone():
                report.skipped += 1
                continue
            conn.execute(
                "INSERT INTO projects (id, owner_id, title, garment_category, current_version, created_at, updated_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (pid, owner_id, p["title"][:120] or "Untitled", p["garment_category"], p["current_version"],
                 _time(p["created_at"]), _time(p["updated_at"])),
            )
            for v in old.execute("SELECT * FROM design_versions WHERE project_id = ?", (p["id"],)):
                conn.execute(
                    "INSERT INTO design_versions (id, project_id, version_number, spec, note, created_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    (_id(v["id"]), pid, v["version_number"], Jsonb(_json(v["spec_json"])), v["note"], _time(v["created_at"])),
                )
            for m in old.execute("SELECT * FROM notebook_messages WHERE project_id = ?", (p["id"],)):
                conn.execute(
                    "INSERT INTO notebook_messages (id, project_id, role, content, is_mock, created_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    (_id(m["id"]), pid, m["role"], m["content"][:4000], bool(m["is_mock"]), _time(m["created_at"])),
                )
            for j in old.execute("SELECT * FROM generation_jobs WHERE project_id = ?", (p["id"],)):
                output = _json(j["output_json"])
                conn.execute(
                    "INSERT INTO generation_jobs (id, project_id, generator_id, version_number, status, provider,"
                    " is_mock, options, output, error, created_at, finished_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (_id(j["id"]), pid, j["generator_id"], j["version_number"], j["status"], j["provider"],
                     bool(j["is_mock"]), Jsonb(_json(j["options_json"]) or {}),
                     Jsonb(output) if output is not None else None, j["error"], _time(j["created_at"]),
                     _time(j["finished_at"])),
                )
            for a in old.execute("SELECT * FROM assets WHERE project_id = ?", (p["id"],)):
                aid = _id(a["id"])
                source = Path(a["storage_path"])
                if not source.exists() and uploads_dir is not None:
                    source = uploads_dir / p["id"] / Path(a["storage_path"]).name
                if not source.exists():
                    report.missing_files.append(a["filename"])
                    continue
                path = f"{owner_id}/{pid}/{aid}{EXTENSIONS.get(a['mime_type'], '')}"
                store.put(path, source.read_bytes(), a["mime_type"])
                report.files += 1
                cols = a.keys()
                conn.execute(
                    "INSERT INTO assets (id, project_id, kind, filename, mime_type, size_bytes, storage_path, job_id,"
                    " generator_id, version_number, provider, is_mock, created_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (aid, pid, a["kind"], a["filename"], a["mime_type"], a["size_bytes"], path,
                     _id(a["job_id"]) if "job_id" in cols else None,
                     a["generator_id"] if "generator_id" in cols else None,
                     a["version_number"] if "version_number" in cols else None,
                     a["provider"] if "provider" in cols else None,
                     bool(a["is_mock"]) if "is_mock" in cols else False, _time(a["created_at"])),
                )
            if p["thumbnail_asset_id"]:
                conn.execute(
                    "UPDATE projects SET thumbnail_asset_id = %s WHERE id = %s"
                    " AND EXISTS (SELECT 1 FROM assets WHERE id = %s)",
                    (_id(p["thumbnail_asset_id"]), pid, _id(p["thumbnail_asset_id"])),
                )
            canvas = old.execute("SELECT * FROM canvas_documents WHERE project_id = ?", (p["id"],)).fetchone()
            if canvas:
                conn.execute("INSERT INTO canvas_documents (project_id, data, updated_at) VALUES (%s, %s, %s)",
                             (pid, Jsonb(_json(canvas["data_json"])), _time(canvas["updated_at"])))
            for u in old.execute(
                "SELECT u.* FROM provider_usage u JOIN generation_jobs j ON j.id = u.job_id WHERE j.project_id = ?",
                (p["id"],),
            ):
                paid = bool(u["paid"]) if has_paid else (not u["is_mock"] and u["provider"] != "built-in")
                conn.execute(
                    "INSERT INTO provider_usage (id, owner_id, job_id, service, provider, is_mock, success, duration_ms,"
                    " estimated_cost_usd, error, created_at, paid) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (_id(u["id"]), owner_id, _id(u["job_id"]), u["service"], u["provider"], bool(u["is_mock"]),
                     bool(u["success"]), u["duration_ms"], u["estimated_cost_usd"], u["error"], _time(u["created_at"]), paid),
                )
            report.projects += 1
    old.close()
    return report


def main() -> int:
    from app.config import ConfigError, load_settings

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="the email you signed up with in the app")
    parser.add_argument("--sqlite", default=str(BACKEND / "data" / "notebook.sqlite3"))
    parser.add_argument("--uploads", default=str(BACKEND / "data" / "uploads"))
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        print(f"No old database at {sqlite_path}. Nothing to import.")
        return 1
    try:
        settings = load_settings()
    except ConfigError as exc:
        print(exc)
        return 1
    db = Database(settings.database_url, max_size=2)
    try:
        with db.connect(None) as conn:
            row = conn.execute("SELECT id FROM auth.users WHERE lower(email) = lower(%s)", (args.email,)).fetchone()
        if row is None:
            print(f"No user with the email {args.email}. Sign up in the app first, then run this again.")
            return 1
        store = SupabaseStorage(settings.supabase_url, settings.supabase_secret_key, settings.storage_bucket)
        report = import_sqlite(sqlite_path, db, store, row["id"], Path(args.uploads))
    except StorageError as exc:
        print(f"Stopped: {exc} Nothing was saved in the database; fix the problem and run it again.")
        return 1
    finally:
        db.close()
    print(f"Imported {report.projects} project(s) and {report.files} picture(s). "
          f"Skipped {report.skipped} already imported.")
    if report.missing_files:
        print("These pictures were not found on disk and were left out: " + ", ".join(report.missing_files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
