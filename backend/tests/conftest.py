"""Shared test setup: a real PostgreSQL with our migrations, a fake Supabase
(Storage + sign-in keys) on a fake HTTP transport, and signed-in test users."""

from __future__ import annotations

import os
import time
import uuid

import httpx
import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.storage.database import Database
from tests import pg_harness

SUPABASE_URL = "https://test-project.supabase.co"
JWT_SECRET = "test-jwt-secret-for-hs256-signing-0123456789"
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"


def make_token(user_id: str, *, secret: str = JWT_SECRET, expires_in: int = 3600, **overrides) -> str:
    claims = {"sub": user_id, "aud": "authenticated", "role": "authenticated", "iss": f"{SUPABASE_URL}/auth/v1",
              "exp": int(time.time()) + expires_in, "email": f"{user_id[:4]}@example.com"} | overrides
    return jwt.encode(claims, secret, algorithm="HS256")


def make_settings(database_url: str = "postgresql://unused", **kw) -> Settings:
    base = dict(
        database_url=database_url, supabase_url=SUPABASE_URL, supabase_secret_key="sb_secret_test_key",
        supabase_jwt_secret=JWT_SECRET, media_token_secret="m" * 48, frontend_origins=["http://localhost:3000"],
        mock_latency_ms=0, generation_rate_limit_per_minute=100, max_upload_mb=1, purge_interval_hours=0,
    )
    return Settings(**(base | kw))


class FakeSupabase:
    """Just enough of Supabase's HTTP API: Storage objects and the sign-in key list (JWKS)."""

    def __init__(self) -> None:
        self.files: dict[str, tuple[bytes, str]] = {}
        self.jwks: dict = {"keys": []}
        self.requests: list[httpx.Request] = []
        self.fail_storage = False
        self.deleted_users: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/auth/v1/.well-known/jwks.json":
            return httpx.Response(200, json=self.jwks)
        if path.startswith("/auth/v1/admin/users/") and request.method == "DELETE":
            self.deleted_users.append(path.rsplit("/", 1)[-1])
            return httpx.Response(200, json={})
        prefix = "/storage/v1/object/project-assets"
        if not path.startswith(prefix):
            return httpx.Response(404, json={"error": "not found"})
        if self.fail_storage:
            return httpx.Response(500, json={"error": "boom"})
        if request.headers.get("apikey") != "sb_secret_test_key":
            return httpx.Response(403, json={"error": "unauthorized"})
        key = path[len(prefix) + 1:]
        if request.method == "POST":
            self.files[key] = (request.content, request.headers.get("content-type", ""))
            return httpx.Response(200, json={"Key": f"project-assets/{key}"})
        if request.method == "GET":
            if key not in self.files:
                return httpx.Response(404, json={"error": "not found"})
            data, mime = self.files[key]
            return httpx.Response(200, content=data, headers={"content-type": mime})
        if request.method == "DELETE":
            import json

            for p in json.loads(request.content)["prefixes"]:
                self.files.pop(p, None)
            return httpx.Response(200, json=[])
        return httpx.Response(405)


# ---------- database ----------


@pytest.fixture(scope="session")
def database_url():
    server = None
    admin_url = os.environ.get("TEST_DATABASE_URL")
    try:
        if not admin_url:
            server = pg_harness.LocalPostgres()
            admin_url = server.admin_url
    except pg_harness.NoPostgres as exc:
        pytest.exit(str(exc), returncode=2)
    url = pg_harness.prepare_database(admin_url)
    yield url
    if server:
        server.stop()


@pytest.fixture(scope="session")
def db(database_url):
    database = Database(database_url, max_size=4)
    yield database
    database.close()


@pytest.fixture(autouse=True)
def clean_database(request):
    """Every test that touches the database starts empty, with users A and B signed up."""
    if "db" not in request.fixturenames:
        yield
        return
    url = request.getfixturevalue("database_url")
    with psycopg.connect(url, autocommit=True) as conn:
        pg_harness.reset(conn)
        for uid in (USER_A, USER_B):
            conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (uid, f"{uid[:4]}@example.com"))
    yield


# ---------- app and clients ----------


@pytest.fixture()
def supabase():
    return FakeSupabase()


@pytest.fixture()
def app(db, supabase):
    http = httpx.Client(transport=httpx.MockTransport(supabase.handler))
    return create_app(make_settings(), db=db, http_client=http)


@pytest.fixture()
def client(app):
    """Signed in as user A."""
    return TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_A)}"})


@pytest.fixture()
def client_b(app):
    """Signed in as user B, on the same app."""
    return TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_B)}"})


@pytest.fixture()
def anonymous(app):
    return TestClient(app)


@pytest.fixture()
def project(client):
    res = client.post("/api/projects", json={"title": "Wine anarkali", "idea": ""})
    assert res.status_code == 201, res.text
    return res.json()


def repo_for(client: TestClient, user_id: str = USER_A):
    """Direct repository access for setting up unusual states in tests."""
    return client.app.state.container.repo_for(user_id)


@pytest.fixture()
def planned_generator():
    """Every real generator is available since Phase 4, so tests of the "planned for a later
    phase" path add a pretend one for the duration of the test."""
    from app.generators.registry import GENERATORS, GENERATORS_BY_ID, GeneratorDefinition

    definition = GeneratorDefinition("future", "Generate Future Thing", "Not built yet.", "future_service", 5)
    GENERATORS.append(definition)
    GENERATORS_BY_ID["future"] = definition
    yield definition
    GENERATORS.remove(definition)
    del GENERATORS_BY_ID["future"]


def random_uuid() -> str:
    return str(uuid.uuid4())
