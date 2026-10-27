"""TEST ONLY: a throwaway local PostgreSQL with our real migrations applied.

Where the database comes from, in this order:
1. TEST_DATABASE_URL: any empty PostgreSQL you point us at (it is wiped by the tests!).
2. PostgreSQL programs in PG_BIN, or in backend/.pgtest/bin (fetch them once with
   `python scripts/get_test_postgres.py`). A temporary database is started and
   removed again after the tests.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import psycopg

BACKEND = Path(__file__).resolve().parent.parent
MIGRATIONS = BACKEND.parent / "supabase" / "migrations"
SHIM = Path(__file__).with_name("supabase_shim.sql")
EXE = ".exe" if os.name == "nt" else ""

# Everything else cascades from projects (and video_segments from video_index_runs).
APP_TABLES = ["projects", "provider_usage", "sewing_modules", "sewing_fabric_rules", "video_search_cache", "video_index_runs"]


class NoPostgres(Exception):
    pass


def _bin_dir() -> Path:
    for candidate in (os.environ.get("PG_BIN"), BACKEND / ".pgtest" / "bin"):
        if candidate and (Path(candidate) / f"initdb{EXE}").exists():
            return Path(candidate)
    raise NoPostgres(
        "No PostgreSQL for the tests. Either set TEST_DATABASE_URL to an empty test database, or run\n"
        "    python scripts/get_test_postgres.py\n"
        "once (it downloads PostgreSQL programs into backend/.pgtest), then run pytest again."
    )


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LocalPostgres:
    def __init__(self) -> None:
        self.bin = _bin_dir()
        self.base = Path(tempfile.mkdtemp(prefix="croquis-pg-"))
        self.data = self.base / "data"
        self.port = _free_port()
        quiet = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        subprocess.run([str(self.bin / f"initdb{EXE}"), "-D", str(self.data), "-U", "postgres", "-A", "trust",
                        "-E", "UTF8"], check=True, **quiet)
        # stdout must not be a pipe: on Windows the server would keep it open and hang the caller.
        subprocess.run([str(self.bin / f"pg_ctl{EXE}"), "-D", str(self.data), "-o", f"-p {self.port} -h 127.0.0.1",
                        "-l", str(self.base / "server.log"), "-w", "start"], check=True, timeout=60, **quiet)
        self.admin_url = f"postgresql://postgres@127.0.0.1:{self.port}/postgres"

    def stop(self) -> None:
        subprocess.run([str(self.bin / f"pg_ctl{EXE}"), "-D", str(self.data), "-m", "fast", "stop"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        shutil.rmtree(self.base, ignore_errors=True)


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


def prepare_database(admin_url: str) -> str:
    """Create a fresh 'croquis_test' database with the shim and every migration applied."""
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute("DROP DATABASE IF EXISTS croquis_test WITH (FORCE)")
        conn.execute("CREATE DATABASE croquis_test")
    url = admin_url.rsplit("/", 1)[0] + "/croquis_test"
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(SHIM.read_text(encoding="utf-8"))
        for path in migration_files():
            conn.execute(path.read_text(encoding="utf-8"))
    return url


def reset(conn: psycopg.Connection) -> None:
    conn.execute("TRUNCATE " + ", ".join(f"public.{t}" for t in APP_TABLES) + ", auth.users, realtime.messages CASCADE")
