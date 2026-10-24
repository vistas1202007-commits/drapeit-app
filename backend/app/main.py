"""FastAPI application entry point.

Run locally (after filling in backend/.env, see docs/DEPLOYMENT.md) with:
    uvicorn app.main:build --factory --reload --port 8000
Then open http://localhost:8000/docs to see every API endpoint.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import anyio
import httpx
import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth import TokenVerifier
from app.config import ConfigError, Settings, load_settings
from app.providers.registry import Providers, build_providers
from app.services.cleanup import start_cleanup
from app.services.generation import GenerationService
from app.services.rate_limit import RateLimiter
from app.storage.database import Database, DatabaseError
from app.storage.files import StorageError, SupabaseStorage
from app.storage.repository import NotFoundError, Repository, SystemRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every request URL at INFO level; keep it quiet so no URL with a key can reach the logs.
for noisy in ("httpx", "httpcore"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger("app.requests")

SECRET_QUERY = re.compile(r"([?&](?:mt|token|key|apikey)=)[^&\s\"]+", re.IGNORECASE)


class _RedactQuery(logging.Filter):
    """Uvicorn's access log prints full paths; hide media tokens and keys in them."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(SECRET_QUERY.sub(r"\1[hidden]", a) if isinstance(a, str) else a for a in record.args)
        return True


logging.getLogger("uvicorn.access").addFilter(_RedactQuery())


@dataclass
class Container:
    """Everything the API routes need, created once when the app starts."""

    settings: Settings
    db: Database
    system: SystemRepository
    store: SupabaseStorage
    verifier: TokenVerifier
    providers: Providers
    limiter: RateLimiter
    upload_limiter: RateLimiter
    social_limiter: RateLimiter

    def repo_for(self, user_id: str) -> Repository:
        return Repository(self.db, user_id)

    def generation_for(self, user_id: str) -> GenerationService:
        return GenerationService(self.repo_for(user_id), self.system, self.store, self.providers, self.settings)


# AI generation can take a minute: these routes keep using a short transaction per step instead of holding
# one open for the whole request.
LONG_RUNNING = re.compile(r"^/api/projects/[^/]+/(generate/[^/]+|package|jobs/[^/]+/retry)$")


class RequestTransaction:
    """One database connection and transaction per request (see Database.request_scope).
    It is committed just before the answer is sent, so the next request always sees the change;
    an answer of 500 or more rolls it back."""

    def __init__(self, app: ASGIApp, db: Database) -> None:
        self.app, self.db = app, db

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or LONG_RUNNING.match(scope["path"]):
            return await self.app(scope, receive, send)
        with self.db.request_scope() as transaction:

            async def send_after_commit(message: Message) -> None:
                if message["type"] == "http.response.start":
                    await anyio.to_thread.run_sync(self.db.finish, transaction, message["status"] < 500)
                await send(message)

            await self.app(scope, receive, send_after_commit)


class RequestGuard:
    """Gives every request an id, logs it (without query strings), and refuses oversized bodies."""

    def __init__(self, app: ASGIApp, json_limit: int, upload_limit: int, upload_limit_mb: int) -> None:
        self.app, self.json_limit, self.upload_limit = app, json_limit, upload_limit
        self.upload_limit_mb = upload_limit_mb  # the limit users are told (the body may carry a little extra)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = uuid.uuid4().hex[:12]
        scope.setdefault("state", {})["request_id"] = request_id
        is_upload = scope["method"] == "POST" and scope["path"].endswith(("/assets", "/problem-reports"))
        limit = self.upload_limit if is_upload else self.json_limit
        started, status = time.monotonic(), 500
        received = 0

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                headers += [(b"x-request-id", request_id.encode()), (b"x-content-type-options", b"nosniff"),
                            (b"referrer-policy", b"no-referrer"), (b"x-frame-options", b"DENY")]
                message["headers"] = headers
            await send(message)

        async def too_large() -> None:
            mb = self.upload_limit_mb if is_upload else limit // (1024 * 1024)
            what = "The file is too large" if is_upload else "The request is too large"
            await JSONResponse({"detail": f"{what}. The limit is {mb} MB.", "request_id": request_id},
                               status_code=413)(scope, receive, send_with_id)

        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            await too_large()
        else:
            async def counted_receive() -> Message:
                nonlocal received
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > limit:
                        raise _BodyTooLarge
                return message

            try:
                await self.app(scope, counted_receive, send_with_id)
            except _BodyTooLarge:
                await too_large()
        user = scope.get("state", {}).get("user_id", "-")
        log.info("%s %s %s %dms user=%s id=%s", scope["method"], scope["path"], status,
                 int((time.monotonic() - started) * 1000), user[:8], request_id)


class _BodyTooLarge(Exception):
    pass


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "")


def _error(request: Request, status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail, "request_id": _rid(request)}, status_code=status)


def _field(loc: tuple) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return " → ".join(parts) or "request"


def create_app(settings: Settings | None = None, *, db: Database | None = None,
               http_client: httpx.Client | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.check()
    db = db or Database(settings.database_url, settings.db_pool_max, settings.db_pool_min)
    providers = build_providers(settings)
    http = http_client or httpx.Client(timeout=60.0)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Phase 6D: remove posts and accounts whose 30-day grace period is over (see app/services/cleanup.py).
        stop = None
        if settings.purge_interval_hours > 0:
            c = app.state.container
            stop = start_cleanup(c.db, c.store, http, settings.supabase_url, settings.supabase_secret_key,
                                 settings.purge_interval_hours)
        yield
        if stop:
            stop.set()

    app = FastAPI(
        title="Drapeit by Vistas Atelier API",
        version="0.6.0",
        description="Phase 5 backend on Supabase (Postgres, Auth, Storage). Every project route needs a signed-in user.",
        lifespan=lifespan,
    )
    app.state.container = Container(
        settings=settings,
        db=db,
        system=SystemRepository(db),
        store=SupabaseStorage(settings.supabase_url, settings.supabase_secret_key, settings.storage_bucket,
                              client=http_client),
        verifier=TokenVerifier(settings.supabase_url, settings.supabase_jwt_secret, client=http_client),
        providers=providers,
        limiter=RateLimiter(settings.generation_rate_limit_per_minute),
        upload_limiter=RateLimiter(settings.upload_rate_limit_per_minute),
        social_limiter=RateLimiter(settings.social_rate_limit_per_minute),
    )
    app.add_middleware(RequestTransaction, db=db)
    app.add_middleware(RequestGuard, json_limit=settings.max_json_body_mb * 1024 * 1024,
                       upload_limit=(settings.max_upload_mb + 1) * 1024 * 1024, upload_limit_mb=settings.max_upload_mb)
    # Added last = outermost, so even "too large" answers carry CORS headers and the
    # browser can show the real message.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["X-Request-ID", "Content-Disposition"],
    )

    @app.exception_handler(NotFoundError)
    def handle_not_found(request: Request, exc: NotFoundError) -> JSONResponse:
        return _error(request, 404, f"{exc}. It may have been deleted, or it belongs to another account.")

    @app.exception_handler(RequestValidationError)
    def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        problems = [f"{_field(tuple(e['loc']))}: {e['msg']}" for e in exc.errors()[:5]]
        return _error(request, 422, "Please check: " + "; ".join(problems))

    @app.exception_handler(StarletteHTTPException)
    def handle_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        response = _error(request, exc.status_code, str(exc.detail))
        for key, value in (exc.headers or {}).items():
            response.headers[key] = value
        return response

    @app.exception_handler(DatabaseError)
    @app.exception_handler(psycopg.OperationalError)
    def handle_database(request: Request, exc: Exception) -> JSONResponse:
        log.warning("Database unavailable: %s (id=%s)", type(exc).__name__, _rid(request))
        return _error(request, 503, "The database is not reachable right now. Please try again in a minute.")

    @app.exception_handler(StorageError)
    def handle_storage(request: Request, exc: StorageError) -> JSONResponse:
        return _error(request, 502, str(exc))

    @app.exception_handler(Exception)
    def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unexpected error (id=%s)", _rid(request))
        return _error(request, 500, f"Something went wrong on the server. Please try again. "
                                    f"If it keeps happening, share this reference: {_rid(request)}")

    @app.get("/api/health", tags=["system"])
    def health() -> dict[str, str]:
        """Is the API up? (No sign-in needed; used by the host's health check.)"""
        return {"status": "ok"}

    @app.get("/api/health/ready", tags=["system"])
    def ready() -> JSONResponse:
        """Is the database reachable too?"""
        ok = app.state.container.db.ping()
        return JSONResponse({"status": "ok" if ok else "database unreachable"}, status_code=200 if ok else 503)

    from app.routers import account, admin, bootstrap, chats, community, generators, members, projects, social

    app.include_router(projects.router)
    app.include_router(generators.router)
    app.include_router(social.router)
    app.include_router(community.router)
    app.include_router(chats.router)
    app.include_router(account.router)
    app.include_router(members.router)
    app.include_router(admin.router)
    app.include_router(bootstrap.router)
    return app


def build() -> FastAPI:
    """App factory for uvicorn (`uvicorn app.main:build --factory`).

    A missing setting stops the server with a readable list instead of a long traceback.
    """
    try:
        return create_app()
    except ConfigError as exc:
        logging.getLogger("app").error("%s", exc)
        raise SystemExit(1) from None
