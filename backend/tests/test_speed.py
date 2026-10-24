"""Speed work (BUG-02 in docs/AUDIT.md): one database transaction per request, the start-up summary
(/api/me/bootstrap) and the one-query account status. The answers must stay exactly the same."""

from __future__ import annotations

import psycopg
import pytest

from app.main import LONG_RUNNING
from tests.conftest import USER_A, USER_B
from tests.test_phase6a import make_profile
from tests.test_phase6e import make_admin


def count_connections(db, monkeypatch) -> list[int]:
    opened = [0]
    real = db.pool.getconn

    def counting(*args, **kwargs):
        opened[0] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(db.pool, "getconn", counting)
    return opened


def test_bootstrap_matches_the_separate_answers(client):
    make_profile(client, "meera.designs")
    client.put("/api/me/appearance", json={"app_theme": "denim"})
    boot = client.get("/api/me/bootstrap")
    assert boot.status_code == 200, boot.text
    data = boot.json()
    assert data["profile"] == client.get("/api/me/profile").json()
    assert data["account"] == client.get("/api/me/account").json()
    assert data["onboarding"] == client.get("/api/me/onboarding").json()
    assert data["appearance"] == client.get("/api/me/appearance").json()
    assert data["badges"] == client.get("/api/me/badges").json()
    assert data["media_token"]["token"] and data["media_token"]["expires_at"].endswith("Z")
    assert data["appearance"]["app_theme"] == "denim"


def test_bootstrap_before_a_profile_exists(client):
    data = client.get("/api/me/bootstrap").json()
    assert data["profile"] is None
    assert data["account"]["has_profile"] is False
    assert data["onboarding"]["is_new"] is True


def test_bootstrap_needs_sign_in(anonymous):
    assert anonymous.get("/api/me/bootstrap").status_code == 401


def test_one_connection_per_request(client, db, monkeypatch):
    make_profile(client, "meera.designs")
    opened = count_connections(db, monkeypatch)
    for path in ("/api/me/bootstrap", "/api/me/account", "/api/feed", "/api/projects"):
        opened[0] = 0
        assert client.get(path).status_code == 200
        assert opened[0] == 1, f"{path} opened {opened[0]} connections"
    opened[0] = 0
    assert client.put("/api/me/profile", json={"username": "meera.designs", "bio": "Bridal"}).status_code == 200
    assert opened[0] == 1


def test_account_status_in_one_query_keeps_suspension_and_warnings(client, client_b, db):
    make_profile(client, "meera.designs")
    make_profile(client_b, "admin.b")
    make_admin(db, USER_B)
    assert client_b.post(f"/api/admin/users/{USER_A}/warn", json={"reason": "First warning"}).status_code == 204
    assert client_b.post(f"/api/admin/users/{USER_A}/warn", json={"reason": "Second warning"}).status_code == 204
    assert client_b.post(f"/api/admin/users/{USER_A}/suspend", json={"reason": "Spam campaign", "days": 7}).status_code == 204
    me = client.get("/api/me/account").json()
    assert me["is_admin"] is False and me["has_profile"] is True and me["username"] == "meera.designs"
    assert [w["reason"] for w in me["warnings"]] == ["Second warning", "First warning"]  # newest first
    s = me["suspension"]
    assert s["reason"] == "Spam campaign" and s["permanent"] is False
    # Same date format as everywhere else: milliseconds and Z.
    for value in (s["starts_at"], s["ends_at"], me["warnings"][0]["created_at"]):
        assert value.endswith("Z") and value[-5] == "." and len(value) == 24
    assert client_b.get("/api/me/account").json()["is_admin"] is True


def test_a_failed_step_does_not_undo_the_others(db):
    with db.request_scope() as scope:
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, 'kept')", (USER_A,))
        with pytest.raises(psycopg.errors.UndefinedTable):
            with db.connect(USER_A) as conn:
                conn.execute("SELECT * FROM no_such_table")
        with db.connect(USER_A) as conn:  # the request goes on after a handled failure
            conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, 'also kept')", (USER_A,))
        db.finish(scope, commit=True)
    with db.connect(None) as conn:
        rows = conn.execute("SELECT query FROM search_history WHERE user_id = %s ORDER BY query", (USER_A,)).fetchall()
    assert [r["query"] for r in rows] == ["also kept", "kept"]


def test_a_request_that_fails_saves_nothing(db):
    with db.request_scope() as scope:
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, 'lost')", (USER_A,))
        db.finish(scope, commit=False)
    with db.connect(None) as conn:
        assert conn.execute("SELECT count(*) AS n FROM search_history").fetchone()["n"] == 0


def test_row_level_security_still_applies_in_a_shared_transaction(db):
    with db.request_scope() as scope:
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, 'mine')", (USER_A,))
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with conn.transaction():
                    conn.execute("INSERT INTO search_history (user_id, query) VALUES (%s, 'not mine')", (USER_B,))
        db.finish(scope, commit=True)


def test_ai_generation_keeps_short_steps():
    for path in ("/api/projects/p1/generate/design", "/api/projects/p1/package", "/api/projects/p1/jobs/j1/retry"):
        assert LONG_RUNNING.match(path)
    for path in ("/api/projects/p1", "/api/projects/p1/jobs/j1/apply", "/api/me/bootstrap"):
        assert not LONG_RUNNING.match(path)


def test_publishing_copies_real_pictures_on_the_storage_server(client, supabase):
    from tests.test_phase6a import PNG, make_design, publish

    make_profile(client, "meera.designs")
    pid, studio_png, generated_svg, _ = make_design(client)
    supabase.requests.clear()
    post = publish(client, pid, [studio_png, generated_svg])
    copies = [r for r in supabase.requests if r.url.path == "/storage/v1/object/copy"]
    assert len(copies) == 1  # the PNG; the mock SVG is cleaned first, so it is downloaded and uploaded
    assert len(post["images"]) == 2
    copied = [data for key, (data, _) in supabase.files.items() if key.startswith("posts/") and key.endswith(".png")]
    assert copied == [PNG]


def test_failed_picture_copy_leaves_no_half_made_post(client, supabase):
    from tests.test_phase6a import make_design

    make_profile(client, "meera.designs")
    pid, studio_png, _, _ = make_design(client)
    supabase.fail_storage = True
    res = client.post("/api/posts", json={"project_id": pid, "status": "published", "visibility": "public",
                                          "caption": "x", "content": {"image_asset_ids": [studio_png]}})
    assert res.status_code >= 500, res.text
    supabase.fail_storage = False
    assert client.get("/api/me/posts").json()["posts"] == []
