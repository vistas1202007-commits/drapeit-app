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

One web request = one connection and one transaction (see `request_scope`):
every database step of the request shares it, so the role and the user are set
once instead of once per step. Each step still runs in its own savepoint, so a
step that fails (and is handled) does not undo the others. Outside a request
scope (background jobs, tests that call repositories directly) every step is
its own transaction, as before.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from psycopg import Connection
from psycopg.adapt import Loader
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

APP_ROLE = "croquis_app"


class RequestScope:
    """The connection and transaction shared by every database step of one web request."""

    def __init__(self) -> None:
        self.conn: Connection | None = None
        self.user_id: str | None = None
        self.transaction: Any = None
        self.depth = 0


_scope: ContextVar[RequestScope | None] = ContextVar("db_request_scope", default=None)


class _UuidAsText(Loader):
    """Read uuid columns as plain strings, the way the rest of the app uses ids."""

    def load(self, data: bytes) -> str:
        return bytes(data).decode()


def _configure(conn: Connection) -> None:
    conn.adapters.register_loader("uuid", _UuidAsText)


class DatabaseError(Exception):
    """The database could not be reached. The message is safe to show."""


class Database:
    def __init__(self, url: str, max_size: int = 10, min_size: int = 4) -> None:
        # prepare_threshold=None keeps the connection usable through Supabase's
        # connection pooler, which does not support prepared statements in every mode.
        # A few connections are kept open: opening a new one takes over a second.
        self.pool = ConnectionPool(
            url, min_size=min(min_size, max_size), max_size=max_size, open=False, configure=_configure,
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
            timeout=15,
        )
        self.pool.open(wait=False)

    def close(self) -> None:
        self.pool.close()

    def _getconn(self) -> Connection:
        try:
            return self.pool.getconn()
        except PoolTimeout as exc:
            raise DatabaseError("The database is not reachable right now. Please try again shortly.") from exc

    @staticmethod
    def _become(conn: Connection, user_id: str) -> None:
        """Switch this transaction to the app role and record the user, in one round trip."""
        claims = json.dumps({"sub": user_id, "role": "authenticated"})
        conn.execute(
            "SELECT set_config('role', %s, true), set_config('request.jwt.claims', %s, true),"
            " set_config('request.jwt.claim.sub', %s, true)",
            (APP_ROLE, claims, user_id),
        )

    @contextmanager
    def connect(self, user_id: str | None) -> Iterator[Connection]:
        """A database step for one user (or a system step when user_id is None).

        Inside a request scope it shares the request's transaction (in a savepoint); otherwise it is one
        transaction of its own: committed if the block finishes, rolled back if it raises."""
        scope = _scope.get()
        if scope is not None and user_id is not None and scope.user_id in (None, user_id):
            with self._shared(scope, user_id) as conn:
                yield conn
            return
        conn = self._getconn()
        try:
            with conn.transaction():
                if user_id is not None:
                    self._become(conn, user_id)
                yield conn
        finally:
            # The pool resets the connection (and drops it if it broke) before reuse.
            self.pool.putconn(conn)

    @contextmanager
    def _shared(self, scope: RequestScope, user_id: str) -> Iterator[Connection]:
        if scope.conn is None:
            conn = self._getconn()
            transaction = conn.transaction()
            try:
                transaction.__enter__()
                self._become(conn, user_id)
            except BaseException as exc:
                transaction.__exit__(type(exc), exc, exc.__traceback__)
                self.pool.putconn(conn)
                raise
            scope.conn, scope.user_id, scope.transaction = conn, user_id, transaction
        conn = scope.conn
        if scope.depth:
            # A step inside another step (e.g. the start-up summary reading several things): no extra savepoint.
            scope.depth += 1
            try:
                yield conn
            finally:
                scope.depth -= 1
            return
        scope.depth = 1
        try:
            with conn.transaction():  # a savepoint: a failing step is undone on its own
                yield conn
        finally:
            scope.depth = 0

    @contextmanager
    def request_scope(self) -> Iterator[RequestScope]:
        """Share one connection and transaction between the database steps of one web request.
        Call `finish` when the answer is ready (before it is sent)."""
        scope = RequestScope()
        token = _scope.set(scope)
        try:
            yield scope
        finally:
            _scope.reset(token)
            self.finish(scope, commit=False)

    def finish(self, scope: RequestScope, commit: bool) -> None:
        """Commit (or roll back) the request's transaction and give the connection back. Safe to call twice."""
        conn, transaction = scope.conn, scope.transaction
        scope.conn = scope.transaction = None
        if conn is None:
            return
        try:
            if commit:
                transaction.__exit__(None, None, None)
            else:
                error = RuntimeError("request did not finish")
                transaction.__exit__(RuntimeError, error, None)
        finally:
            self.pool.putconn(conn)

    def ping(self) -> bool:
        try:
            with self.connect(None) as conn:
                conn.execute("SELECT 1")
            return True
        except Exception:  # noqa: BLE001 - health check only
            return False
