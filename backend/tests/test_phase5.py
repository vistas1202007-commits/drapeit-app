"""Phase 5 tests: sign-in checks, per-user access (in the app AND in the database's
Row Level Security), security limits, clear error messages, the SQLite import,
and one end-to-end run through every core workflow."""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
import time
import uuid

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.auth import TokenVerifier, make_media_token, read_media_token
from app.config import ConfigError, Settings, load_settings
from app.main import _RedactQuery
from app.storage.database import DatabaseError
from tests.conftest import JWT_SECRET, SUPABASE_URL, USER_A, USER_B, make_token, repo_for

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def upload(client, pid, name="ref.png", kind="upload"):
    res = client.post(f"/api/projects/{pid}/assets", data={"kind": kind}, files={"file": (name, PNG, "image/png")})
    assert res.status_code == 201, res.text
    return res.json()


# ---------- signing in ----------


def test_every_project_route_needs_sign_in(anonymous):
    for method, path in [("get", "/api/projects"), ("post", "/api/projects"), ("get", "/api/generators"),
                         ("get", "/api/providers"), ("get", "/api/usage"), ("get", "/api/media-token"),
                         ("get", f"/api/projects/{uuid.uuid4()}"), ("get", "/api/tutorials/search?q=kurta")]:
        res = getattr(anonymous, method)(path)
        assert res.status_code == 401, path
        assert res.json()["detail"] == "Please sign in to continue."
        assert res.headers["www-authenticate"] == "Bearer"
    assert anonymous.get("/api/health").json() == {"status": "ok"}  # the host's health check stays open


@pytest.mark.parametrize(("token", "message"), [
    (make_token(USER_A, expires_in=-120), "expired"),
    (make_token(USER_A, secret="someone-elses-secret-0123456789abcdef"), "not valid"),
    (make_token(USER_A, aud="anon"), "not valid"),
    (make_token(USER_A, iss="https://other.supabase.co/auth/v1"), "not valid"),
    (make_token(USER_A, role="anon"), "user account"),
    (make_token("not-a-uuid"), "user account"),
    ("garbage", "not valid"),
])
def test_bad_tokens_are_refused_with_a_clear_message(app, token, message):
    res = TestClient(app).get("/api/projects", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401
    assert message in res.json()["detail"]


def test_es256_tokens_are_checked_against_supabase_signing_keys(app, supabase):
    key = ec.generate_private_key(ec.SECP256R1())
    public = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))
    supabase.jwks = {"keys": [public | {"kid": "key-1", "alg": "ES256", "use": "sig"}]}
    claims = {"sub": USER_A, "aud": "authenticated", "role": "authenticated", "iss": f"{SUPABASE_URL}/auth/v1",
              "exp": int(time.time()) + 600}
    good = jwt.encode(claims, key, algorithm="ES256", headers={"kid": "key-1"})
    assert TestClient(app).get("/api/projects", headers={"Authorization": f"Bearer {good}"}).status_code == 200

    other = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(claims, other, algorithm="ES256", headers={"kid": "key-1"})
    assert TestClient(app).get("/api/projects", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    unknown = jwt.encode(claims, key, algorithm="ES256", headers={"kid": "key-2"})
    assert TestClient(app).get("/api/projects", headers={"Authorization": f"Bearer {unknown}"}).status_code == 401


def test_hs256_without_a_configured_secret_explains_what_is_missing():
    import httpx

    verifier = TokenVerifier(SUPABASE_URL, None, client=httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"keys": []}))))
    with pytest.raises(Exception, match="SUPABASE_JWT_SECRET"):
        verifier.verify(make_token(USER_A))


def test_media_tokens():
    secret = "s" * 40
    token, expires = make_media_token(USER_A, secret, 60, now=1000)
    assert expires == 1060
    assert read_media_token(token, secret, now=1050) == USER_A
    assert read_media_token(token, secret, now=1061) is None  # expired
    assert read_media_token(token, "x" * 40, now=1050) is None  # wrong secret
    user, exp, sig = token.rsplit(".", 2)
    assert read_media_token(f"{USER_B}.{exp}.{sig}", secret, now=1050) is None  # someone else's id
    assert read_media_token("nonsense", secret) is None


# ---------- per-user access in the app ----------


def test_users_only_ever_see_their_own_projects(client, client_b, project):
    pid = project["id"]
    asset = upload(client, pid)
    job = client.post(f"/api/projects/{pid}/generate/materials", json={"options": {}}).json()
    assert client_b.get("/api/projects").json() == []
    forbidden = [
        client_b.get(f"/api/projects/{pid}"),
        client_b.patch(f"/api/projects/{pid}", json={"title": "Mine now"}),
        client_b.post(f"/api/projects/{pid}/versions", json={"spec": {"title": "x"}}),
        client_b.post(f"/api/projects/{pid}/messages", json={"content": "hello"}),
        client_b.post(f"/api/projects/{pid}/generate/materials", json={"options": {}}),
        client_b.post(f"/api/projects/{pid}/jobs/{job['id']}/retry"),
        client_b.get(f"/api/projects/{pid}/export"),
        client_b.get(f"/api/projects/{pid}/canvas"),
        client_b.post(f"/api/projects/{pid}/duplicate"),
        client_b.post(f"/api/projects/{pid}/assets", files={"file": ("x.png", PNG, "image/png")}),
        client_b.get(f"/api/assets/{asset['id']}"),
        client_b.delete(f"/api/projects/{pid}/assets/{asset['id']}"),
        client_b.delete(f"/api/projects/{pid}/jobs/{job['id']}"),
        client_b.delete(f"/api/projects/{pid}"),
    ]
    assert [r.status_code for r in forbidden] == [404] * len(forbidden)
    assert "belongs to another account" in forbidden[0].json()["detail"]
    # Nothing of A's was changed or deleted.
    detail = client.get(f"/api/projects/{pid}").json()
    assert detail["project"]["title"] == "Wine anarkali" and len(detail["assets"]) == 1 and detail["jobs"]


def test_pictures_load_with_a_media_token_only_for_their_owner(client, client_b, anonymous, project):
    asset = upload(client, project["id"])
    token_a = client.get("/api/media-token").json()["token"]
    token_b = client_b.get("/api/media-token").json()["token"]
    res = anonymous.get(f"/api/assets/{asset['id']}", params={"mt": token_a})
    assert res.status_code == 200 and res.content == PNG
    assert res.headers["cache-control"].startswith("private")
    assert anonymous.get(f"/api/assets/{asset['id']}", params={"mt": token_b}).status_code == 404
    expired = anonymous.get(f"/api/assets/{asset['id']}", params={"mt": token_a[:-3] + "abc"})
    assert expired.status_code == 401 and "expired" in expired.json()["detail"]
    assert anonymous.get(f"/api/assets/{asset['id']}").status_code == 401


def test_files_are_stored_per_user_and_removed_with_the_project(client, supabase, project):
    pid = project["id"]
    asset = upload(client, pid)
    stored = [k for k in supabase.files if k.endswith(asset["id"] + ".png")]
    assert stored == [f"{USER_A}/{pid}/{asset['id']}.png"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert supabase.files == {}


# ---------- per-user access in the database itself (Row Level Security) ----------


def test_row_level_security_blocks_other_users_even_with_raw_sql(client, db, project):
    pid = project["id"]
    with db.connect(USER_B) as conn:
        assert conn.execute("SELECT count(*) AS n FROM projects").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM design_versions").fetchone()["n"] == 0
        assert conn.execute("UPDATE projects SET title = 'stolen' WHERE id = %s", (pid,)).rowcount == 0
        assert conn.execute("DELETE FROM design_versions WHERE project_id = %s", (pid,)).rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot create a project in someone else's name
            conn.execute("INSERT INTO projects (owner_id, title) VALUES (%s, 'fake')", (USER_A,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot add a version to someone else's project
            conn.execute("INSERT INTO design_versions (project_id, version_number, spec) VALUES (%s, 9, '{}')", (pid,))
    with db.connect(USER_A) as conn:
        assert conn.execute("SELECT title FROM projects").fetchone()["title"] == "Wine anarkali"


def test_browser_data_api_roles_cannot_touch_app_tables(db):
    with db.connect(None) as conn:
        for role in ("anon", "authenticated"):
            for table in ("projects", "design_versions", "generation_jobs", "assets", "provider_usage"):
                row = conn.execute("SELECT has_table_privilege(%s, %s, 'SELECT') AS ok", (role, f"public.{table}")).fetchone()
                assert row["ok"] is False, (role, table)


def test_app_role_without_a_user_sees_nothing(client, db, project):
    with db.connect(None) as conn:
        conn.execute("SET LOCAL ROLE croquis_app")
        assert conn.execute("SELECT count(*) AS n FROM projects").fetchone()["n"] == 0


# ---------- security limits ----------


def test_rate_limits_are_per_user(db, supabase):
    import httpx

    from app.main import create_app
    from tests.conftest import make_settings

    app = create_app(make_settings(generation_rate_limit_per_minute=1, upload_rate_limit_per_minute=1), db=db,
                     http_client=httpx.Client(transport=httpx.MockTransport(supabase.handler)))
    a = TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_A)}"})
    b = TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_B)}"})
    pa = a.post("/api/projects", json={"title": "a"}).json()["id"]
    pb = b.post("/api/projects", json={"title": "b"}).json()["id"]
    assert a.post(f"/api/projects/{pa}/generate/materials", json={}).status_code == 200
    second = a.post(f"/api/projects/{pa}/generate/materials", json={})
    assert second.status_code == 429 and "wait a minute" in second.json()["detail"]
    assert b.post(f"/api/projects/{pb}/generate/materials", json={}).status_code == 200  # B is not affected
    assert a.post(f"/api/projects/{pa}/assets", files={"file": ("x.png", PNG, "image/png")}).status_code == 201
    assert a.post(f"/api/projects/{pa}/assets", files={"file": ("x.png", PNG, "image/png")}).status_code == 429


def test_oversized_json_is_refused_before_it_is_read(client, project):
    res = client.put(f"/api/projects/{project['id']}/canvas", content=b"x" * (6 * 1024 * 1024),
                     headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert res.json()["detail"] == "The request is too large. The limit is 5 MB."


def test_security_headers_and_cors(client):
    res = client.get("/api/projects")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert len(res.headers["x-request-id"]) == 12
    ok = client.options("/api/projects", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET",
                                                  "Access-Control-Request-Headers": "authorization"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "authorization" in ok.headers["access-control-allow-headers"].lower()
    evil = client.options("/api/projects", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in evil.headers


def test_logs_hide_media_tokens_and_keys():
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4", "GET", "/api/assets/abc?mt=user.123.SIGNATURE&x=1", "1.1", 200), None)
    _RedactQuery().filter(record)
    assert "SIGNATURE" not in record.getMessage() and "mt=[hidden]&x=1" in record.getMessage()


def test_secrets_are_not_in_settings_repr():
    text = repr(Settings(database_url="postgresql://u:pw@h/db", supabase_secret_key="sb_secret_x",
                         media_token_secret="m" * 40, supabase_jwt_secret="jwt", anthropic_api_key="sk-ant"))
    for secret in ("pw@h", "sb_secret_x", "m" * 40, "sk-ant"):
        assert secret not in text


# ---------- clear error messages ----------


def test_clear_messages_for_bad_input(client, project):
    assert client.get("/api/projects/not-a-real-id").json()["detail"].startswith("Project not found")
    res = client.post("/api/projects", json={"title": "   "})
    assert res.status_code == 422 and res.json()["detail"] == "Please give the design a name."
    res = client.post("/api/projects", json={})
    assert res.status_code == 422 and res.json()["detail"].startswith("Please check: title:")
    assert client.post(f"/api/projects/{project['id']}/messages", json={"content": "  "}).json()["detail"] == "The note is empty."
    assert "request_id" in res.json()


def test_unexpected_errors_give_a_reference_not_a_stack_trace(app, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(app.state.container, "repo_for", boom)
    res = TestClient(app, raise_server_exceptions=False, headers={"Authorization": f"Bearer {make_token(USER_A)}"}).get("/api/projects")
    assert res.status_code == 500
    body = res.json()
    assert "Something went wrong on the server" in body["detail"] and body["request_id"] in body["detail"]
    assert "secret internal detail" not in body["detail"]


def test_database_and_storage_outages_are_explained(app, client, supabase, project, monkeypatch):
    supabase.fail_storage = True
    res = client.post(f"/api/projects/{project['id']}/assets", files={"file": ("x.png", PNG, "image/png")})
    assert res.status_code == 502 and res.json()["detail"].startswith("File storage could not upload")

    def down(*a, **k):
        raise DatabaseError("The database is not reachable right now. Please try again shortly.")

    monkeypatch.setattr(app.state.container, "repo_for", down)
    res = client.get("/api/projects")
    assert res.status_code == 503 and "database is not reachable" in res.json()["detail"]


def test_missing_settings_are_listed(monkeypatch):
    for name in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MEDIA_TOKEN_SECRET"):
        monkeypatch.setenv(name, "")
    with pytest.raises(ConfigError) as err:
        load_settings()
    text = str(err.value)
    assert all(n in text for n in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "MEDIA_TOKEN_SECRET"))
    with pytest.raises(ConfigError, match="at least 32"):
        Settings(database_url="postgresql://x", supabase_url="https://a.supabase.co", supabase_secret_key="k",
                 media_token_secret="short").check()


def test_readiness_check(client):
    assert client.get("/api/health/ready").json() == {"status": "ok"}


# ---------- importing the old SQLite data ----------


def test_old_sqlite_projects_are_imported_once(tmp_path, client, db, supabase):
    from scripts.import_sqlite import import_sqlite

    old_pid, old_aid, old_job = uuid.uuid4().hex, uuid.uuid4().hex, uuid.uuid4().hex
    picture = tmp_path / "pic.png"
    picture.write_bytes(PNG)
    old = sqlite3.connect(tmp_path / "old.sqlite3")
    old.executescript(f"""
        CREATE TABLE projects (id, title, garment_category, current_version, thumbnail_asset_id, created_at, updated_at);
        CREATE TABLE design_versions (id, project_id, version_number, spec_json, note, created_at);
        CREATE TABLE notebook_messages (id, project_id, role, content, is_mock, created_at);
        CREATE TABLE generation_jobs (id, project_id, generator_id, version_number, status, provider, is_mock,
            options_json, output_json, error, created_at, finished_at);
        CREATE TABLE assets (id, project_id, kind, filename, mime_type, size_bytes, storage_path, job_id, generator_id,
            version_number, provider, is_mock, created_at);
        CREATE TABLE canvas_documents (project_id, data_json, updated_at);
        CREATE TABLE provider_usage (id, job_id, service, provider, is_mock, success, duration_ms, estimated_cost_usd,
            error, created_at, paid);
        INSERT INTO projects VALUES ('{old_pid}', 'Old kurta', 'Kurta', 1, '{old_aid}', '2026-10-21T10:00:00.000Z',
            '2026-10-21T11:00:00.000Z');
        INSERT INTO design_versions VALUES ('{uuid.uuid4().hex}', '{old_pid}', 1, '{{"title": "Old kurta"}}',
            'Project created', '2026-10-21T10:00:00.000Z');
        INSERT INTO notebook_messages VALUES ('{uuid.uuid4().hex}', '{old_pid}', 'user', 'A kurta', 0,
            '2026-10-21T10:00:01.000Z');
        INSERT INTO generation_jobs VALUES ('{old_job}', '{old_pid}', 'sketch', 1, 'succeeded', 'mock-svg', 1, '{{}}',
            '{{"style": "ink", "asset_id": "{old_aid}", "caption": "c"}}', NULL, '2026-10-21T10:01:00.000Z',
            '2026-10-21T10:01:01.000Z');
        INSERT INTO assets VALUES ('{old_aid}', '{old_pid}', 'generated', 'sketch.png', 'image/png', {len(PNG)},
            '{picture.as_posix()}', '{old_job}', 'sketch', 1, 'mock-svg', 1, '2026-10-21T10:01:01.000Z');
        INSERT INTO canvas_documents VALUES ('{old_pid}', '{{"layers": []}}', '2026-10-21T10:02:00.000Z');
        INSERT INTO provider_usage VALUES ('{uuid.uuid4().hex}', '{old_job}', 'image_generation', 'mock-svg', 1, 1, 5,
            0, NULL, '2026-10-21T10:01:01.000Z', 0);
    """)
    old.commit()
    old.close()

    store = client.app.state.container.store
    report = import_sqlite(tmp_path / "old.sqlite3", db, store, USER_A)
    assert (report.projects, report.files, report.skipped) == (1, 1, 0)
    again = import_sqlite(tmp_path / "old.sqlite3", db, store, USER_A)
    assert (again.projects, again.skipped) == (0, 1)

    projects = client.get("/api/projects").json()
    assert [p["title"] for p in projects] == ["Old kurta"]
    detail = client.get(f"/api/projects/{projects[0]['id']}").json()
    assert detail["messages"][0]["content"] == "A kurta" and detail["project"]["thumbnail_asset_id"]
    # The old sketch output still points at its picture, and the picture loads.
    sketch = next(j for j in detail["jobs"] if j["generator_id"] == "sketch")
    assert client.get(f"/api/assets/{sketch['output']['asset_id']}").content == PNG


# ---------- one end-to-end run through every core workflow ----------


def test_end_to_end_workflow(client, supabase):
    from tests.test_phase4 import FakeSearch

    client.app.state.container.providers.tutorials = FakeSearch()
    idea = "An embroidered wine anarkali with full sleeves and a V-neck for a winter wedding, with gold zari work"
    project = client.post("/api/projects", json={"title": "Meera's anarkali", "idea": idea}).json()
    pid = project["id"]
    ok = lambda job: job["status"] == "succeeded"  # noqa: E731

    # Idea -> design concept -> apply
    design = client.post(f"/api/projects/{pid}/generate/design", json={"options": {"idea": idea}}).json()
    assert ok(design)
    assert client.post(f"/api/projects/{pid}/jobs/{design['id']}/apply").json()["version_number"] == 2

    # Sketch, preview, references
    sketch = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "technical_flat"}}).json()
    assert ok(sketch) and client.get(f"/api/assets/{sketch['output']['asset_id']}").status_code == 200
    assert ok(client.post(f"/api/projects/{pid}/generate/visual_preview", json={"options": {}}).json())
    front = upload(client, pid, "front.png")

    # Fabric -> save a favourite -> materials
    fabric = client.post(f"/api/projects/{pid}/generate/fabric", json={"options": {}}).json()
    assert ok(fabric)
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["preferred_fabrics"] = [fabric["output"]["recommendations"][0]["name"]]
    assert client.post(f"/api/projects/{pid}/versions", json={"spec": spec, "note": "fabric"}).status_code == 201
    assert ok(client.post(f"/api/projects/{pid}/generate/materials", json={"options": {}}).json())

    # Tailor details -> sheet -> PDF
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["measurements"] = [{"name": "Bust / chest", "value": 86, "verified": True, "note": ""}]
    spec["tailor"]["references"] = [{"asset_id": front["id"], "view": "front", "note": ""}]
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec, "note": "tailor"})
    sheet = client.post(f"/api/projects/{pid}/generate/tailor_sheet", json={"options": {}}).json()
    assert ok(sheet)
    pdf = client.get(f"/api/projects/{pid}/jobs/{sheet['id']}/tailor-sheet.pdf", params={"tz_offset": -330})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    # Cost estimate with real typed prices
    cost = client.post(f"/api/projects/{pid}/generate/cost", json={"options": {
        "currency": "INR", "materials": [{"item": "Velvet", "kind": "fabric", "quantity": 4, "unit": "m",
                                          "unit_price": 450}],
        "labour": [{"task": "Stitching", "amount": 1500}]}}).json()
    assert ok(cost) and cost["output"]["total"] == 3300

    # Phase 4 generators
    for gid in ("variations", "moodboard", "embroidery", "pattern", "tutorial", "video"):
        assert ok(client.post(f"/api/projects/{pid}/generate/{gid}", json={"options": {}}).json()), gid

    # Notebook housekeeping: notes, canvas, history, duplicate, export, delete
    assert client.post(f"/api/projects/{pid}/messages", json={"content": "Client wants a dupatta"}).status_code == 201
    assert client.put(f"/api/projects/{pid}/canvas", json={"data": {"layers": []}}).status_code == 200
    restored = client.post(f"/api/projects/{pid}/versions/2/restore").json()
    assert restored["note"] == "Restored from version 2"
    copy = client.post(f"/api/projects/{pid}/duplicate").json()
    assert client.get(f"/api/projects/{pid}/export").json()["project"]["title"] == "Meera's anarkali"
    assert client.patch(f"/api/projects/{pid}", json={"title": "Meera's wedding anarkali"}).status_code == 200
    assert client.delete(f"/api/projects/{pid}/assets/{front['id']}").status_code == 204
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert [p["id"] for p in client.get("/api/projects").json()] == [copy["id"]]
    assert not any(k.startswith(f"{USER_A}/{pid}/") for k in supabase.files)  # its files are gone too
