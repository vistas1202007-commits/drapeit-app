"""Supabase Postgres connection.

The tables are created by the SQL files in `supabase/migrations/` (run them
once in the Supabase SQL editor, in order). This module only connects.

Per-user access, twice over:
1. Every query in `repository.py` is written for one signed-in user.
2. For those queries the connection switches to the `croquis_app` database
   role and records the user's id for this transaction. Row Level Security
   policies then only let that user see and change their own rows, even if a
   query in the code were wrong.

"System" connections (user_id=None) keep the connection's own role. They are
used only for app-wide jobs such as adding up today's AI spending.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg.adapt import Loader
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

APP_ROLE = "croquis_app"


class _UuidAsText(Loader):
    """Read uuid columns as plain strings, the way the rest of the app uses ids."""

    def load(self, data: bytes) -> str:
        return bytes(data).decode()


def _configure(conn: Connection) -> None:
    conn.adapters.register_loader("uuid", _UuidAsText)


class DatabaseError(Exception):
    """The database could not be reached. The message is safe to show."""


class Database:
    def __init__(self, url: str, max_size: int = 10) -> None:
        # prepare_threshold=None keeps the connection usable through Supabase's
        # connection pooler, which does not support prepared statements in every mode.
        self.pool = ConnectionPool(
            url, min_size=1, max_size=max_size, open=False, configure=_configure,
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
            timeout=15,
        )
        self.pool.open(wait=False)

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def connect(self, user_id: str | None) -> Iterator[Connection]:
        """One transaction: committed if the block finishes, rolled back if it raises."""
        try:
            conn = self.pool.getconn()
        except PoolTimeout as exc:
            raise DatabaseError("The database is not reachable right now. Please try again shortly.") from exc
        try:
            with conn.transaction():
                if user_id is not None:
                    claims = json.dumps({"sub": user_id, "role": "authenticated"})
                    conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
                    conn.execute(
                        "SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                        (claims, user_id),
                    )
                yield conn
        finally:
            # The pool resets the connection (and drops it if it broke) before reuse.
            self.pool.putconn(conn)

    def ping(self) -> bool:
        try:
            with self.connect(None) as conn:
                conn.execute("SELECT 1")
            return True
        except Exception:  # noqa: BLE001 - health check only
            return False
