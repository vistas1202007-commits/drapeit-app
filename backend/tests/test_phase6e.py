"""Phase 6E tests: onboarding (new, resumable, skippable, suggestions), the admin panel (only for
admins, stats, reports queue with dismiss / remove / warn / suspend, problem reports, the action
log), suspensions enforced in the API and the database, warnings, verification requests and the
badge, reporting a chat message, and Row Level Security on the new tables."""

from __future__ import annotations

import psycopg
import pytest

from tests.conftest import USER_A, USER_B
from tests.test_phase6a import PNG, USER_C, client_c, make_design, make_profile, publish  # noqa: F401 (client_c is a fixture)


def make_admin(db, user_id):
    with db.connect(None) as conn:
        conn.execute("INSERT INTO admin_users (user_id, note) VALUES (%s, 'test') ON CONFLICT DO NOTHING", (user_id,))


@pytest.fixture()
def world(client, client_b, client_c, db):
    """vistas (A) has a public post; meera (B) and kabir (C) have profiles; kabir is an admin."""
    make_profile(client, "vistas", role="designer")
    make_profile(client_b, "meera", role="tailor")
    make_profile(client_c, "kabir")
    make_admin(db, USER_C)
    pid, studio, _, _ = make_design(client)
    post = publish(client, pid, [studio], caption="Wine velvet anarkali", tags={"garment": "Anarkali", "fabric": "Velvet"})
    return {"pid": pid, "studio": studio, "post": post["id"]}


# ---------- admin access ----------


def test_admin_panel_is_only_for_admins(client, client_c, db, world):
    assert client.get("/api/admin/stats").status_code == 404
    assert client.get("/api/me/account").json()["is_admin"] is False
    assert client_c.get("/api/me/account").json()["is_admin"] is True
    stats = client_c.get("/api/admin/stats").json()
    assert stats["total_users"] == 3 and stats["new_users_this_week"] == 3 and stats["published_posts"] == 1
    for table in ("admin_users", "admin_actions"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with db.connect(USER_C) as conn:  # not even an admin's own session can read them directly
                conn.execute(f"SELECT * FROM {table}")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO admin_users (user_id) VALUES (%s)", (USER_A,))


# ---------- reports queue ----------


def test_reports_queue_dismiss_and_remove(client, client_b, client_c, supabase, world):
    post = world["post"]
    comment = client.post(f"/api/posts/{post}/comments", json={"body": "Buy cheap copies here"}).json()
    client_b.post("/api/reports", json={"target_type": "post", "target": post, "reason": "copied_design"})
    client_b.post("/api/reports", json={"target_type": "comment", "target": comment["id"], "reason": "spam"})
    client_b.post("/api/reports", json={"target_type": "user", "target": "vistas", "reason": "harassment"})
    queue = client_c.get("/api/admin/reports").json()
    assert [r["target_type"] for r in queue] == ["post", "comment", "user"]
    assert queue[0]["reporter"]["username"] == "meera" and queue[0]["reported"]["username"] == "vistas"
    assert queue[0]["target_exists"] and queue[0]["reports_about_person"] == 3
    assert client_c.get("/api/admin/stats").json()["open_reports"] == 3

    assert client_c.post(f"/api/admin/reports/{queue[2]['id']}/dismiss", json={"note": "Not harassment"}).status_code == 204
    assert client_c.post(f"/api/admin/reports/{queue[2]['id']}/remove", json={}).status_code == 400  # accounts are not removed
    assert client_c.post(f"/api/admin/reports/{queue[1]['id']}/remove", json={"note": "Spam"}).status_code == 204
    assert client.get(f"/api/posts/{post}/comments").json()["total"] == 0
    pictures = [k for k in supabase.files if k.startswith(f"posts/{USER_A}/{post}/")]
    assert client_c.post(f"/api/admin/reports/{queue[0]['id']}/remove", json={}).status_code == 204
    assert client.get(f"/api/posts/{post}").status_code == 404
    assert not [k for k in supabase.files if k in pictures]
    assert client_c.get("/api/admin/reports").json() == []
    closed = client_c.get("/api/admin/reports?status=closed").json()
    assert {r["status"] for r in closed} == {"resolved", "dismissed"}
    log = [a["action"] for a in client_c.get("/api/admin/actions").json()]
    assert log == ["remove_post", "remove_comment", "dismiss_report"]
    assert client.get("/api/admin/actions").status_code == 404


def test_reporting_a_chat_message(client, client_b, client_c, world):
    chat = client.post("/api/chats", json={"username": "meera"}).json()
    message = client.post(f"/api/chats/{chat['id']}/messages", json={"body": "Rude words"}).json()
    assert client.post("/api/reports", json={"target_type": "message", "target": message["id"], "reason": "harassment"}).status_code == 400
    assert client_c.post("/api/reports", json={"target_type": "message", "target": message["id"], "reason": "spam"}).status_code == 404
    res = client_b.post("/api/reports", json={"target_type": "message", "target": message["id"], "reason": "harassment"})
    assert res.status_code == 201
    report = client_c.get("/api/admin/reports?type=message").json()[0]
    assert report["excerpt"] == "Rude words" and report["message_id"] == message["id"]
    client_c.post(f"/api/admin/reports/{report['id']}/remove", json={})
    assert client_b.get(f"/api/chats/{chat['id']}/messages").json()["messages"] == []


# ---------- warnings and suspensions ----------


def test_warning_is_shown_until_acknowledged(client, client_c, world):
    assert client_c.post(f"/api/admin/users/{USER_A}/warn", json={"reason": "Please credit other designers."}).status_code == 204
    warnings = client.get("/api/me/account").json()["warnings"]
    assert [w["reason"] for w in warnings] == ["Please credit other designers."]
    assert client.post(f"/api/me/warnings/{warnings[0]['id']}/ack").status_code == 204
    assert client.get("/api/me/account").json()["warnings"] == []
    assert client_c.post(f"/api/admin/users/{USER_C}/warn", json={"reason": "Myself"}).status_code == 400


def test_suspension_blocks_posting_commenting_and_messaging(client, client_b, client_c, db, world):
    chat = client.post("/api/chats", json={"username": "meera"}).json()
    client_c.post(f"/api/admin/users/{USER_A}/suspend", json={"reason": "Spam campaign", "days": 7})
    account = client.get("/api/me/account").json()
    assert account["suspension"]["reason"] == "Spam campaign" and not account["suspension"]["permanent"]

    blocked = client.post(f"/api/posts/{world['post']}/comments", json={"body": "hello"})
    assert blocked.status_code == 403 and "suspended until" in blocked.json()["detail"]
    assert client.post(f"/api/chats/{chat['id']}/messages", json={"body": "hi"}).status_code == 403
    assert client.post("/api/posts", json={"project_id": world["pid"], "status": "published",
                                           "content": {"image_asset_ids": [world["studio"]]}}).status_code == 403
    assert client.patch(f"/api/posts/{world['post']}", json={"caption": "edited"}).status_code == 403
    assert client.post("/api/posts", json={"project_id": world["pid"], "status": "draft"}).status_code == 201  # drafts are fine
    assert client.get("/api/feed").status_code == 200  # reading is fine
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_A) as conn:  # the database refuses too
            conn.execute("INSERT INTO comments (post_id, author_id, body) VALUES (%s, %s, 'x')", (world["post"], USER_A))

    active = client_c.get("/api/admin/suspensions").json()
    assert [s["person"]["username"] for s in active] == ["vistas"]
    assert client_c.post(f"/api/admin/suspensions/{active[0]['id']}/lift", json={"note": "Appeal accepted"}).status_code == 204
    assert client.post(f"/api/posts/{world['post']}/comments", json={"body": "hello"}).status_code == 201

    client_c.post(f"/api/admin/users/{USER_B}/suspend", json={"reason": "Repeated harassment"})
    assert client_b.get("/api/me/account").json()["suspension"]["permanent"] is True
    with db.connect(USER_B) as conn:  # only your own suspensions are visible to you
        assert conn.execute("SELECT count(*) AS n FROM account_suspensions").fetchone()["n"] == 1


# ---------- problem reports ----------


def test_problem_reports_in_the_admin_panel(client, client_c, world):
    client.post("/api/problem-reports", data={"category": "bug", "description": "Sketch button froze"},
                files={"screenshot": ("s.png", PNG, "image/png")})
    items = client_c.get("/api/admin/problem-reports").json()
    assert items[0]["description"] == "Sketch button froze" and items[0]["has_screenshot"]
    assert items[0]["person"]["username"] == "vistas" and items[0]["email"]
    assert client_c.get(f"/api/admin/problem-reports/{items[0]['id']}/screenshot").status_code == 200
    assert client_c.post(f"/api/admin/problem-reports/{items[0]['id']}", json={"status": "resolved"}).status_code == 204
    assert client_c.get("/api/admin/problem-reports").json() == []
    assert client_c.get("/api/admin/problem-reports?status=closed").json()[0]["status"] == "resolved"


# ---------- verification ----------


def test_verification_request_and_badge(client, client_b, client_c, db, world):
    assert client.post("/api/me/verification", json={"reason": "short"}).status_code == 422
    assert client.post("/api/me/verification", json={"reason": "I run a bridal studio in Jaipur.",
                                                     "portfolio_url": "ftp://x"}).status_code == 422
    state = client.post("/api/me/verification", json={"reason": "I run a bridal studio in Jaipur.",
                                                      "portfolio_url": "https://example.com/vistas"}).json()
    assert state["verified"] is False and state["latest_request"]["status"] == "pending"
    assert client.post("/api/me/verification", json={"reason": "Asking a second time please"}).status_code == 400

    pending = client_c.get("/api/admin/verification-requests").json()
    assert [p["person"]["username"] for p in pending] == ["vistas"]
    assert client_c.post(f"/api/admin/verification-requests/{pending[0]['id']}/approve", json={"note": "Looks real"}).status_code == 204
    mine = client.get("/api/me/verification").json()
    assert mine["verified"] is True and mine["source"] == "admin" and mine["latest_request"]["status"] == "approved"
    assert client_b.get("/api/profiles/vistas").json()["verified"] is True
    assert client_b.get(f"/api/posts/{world['post']}").json()["author"]["verified"] is True
    client.post(f"/api/posts/{world['post']}/comments", json={"body": "Thanks"})
    assert client_b.get(f"/api/posts/{world['post']}/comments").json()["comments"][0]["author"]["verified"] is True
    assert client.post("/api/me/verification", json={"reason": "Already verified, again"}).status_code == 400

    with db.connect(USER_B) as conn:  # nobody can give themselves the badge
        conn.execute("UPDATE profiles SET verified = true, bio = 'x' WHERE id = %s", (USER_B,))
        assert conn.execute("SELECT verified FROM profiles WHERE id = %s", (USER_B,)).fetchone()["verified"] is False
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:
            conn.execute("INSERT INTO verified_accounts (user_id) VALUES (%s)", (USER_B,))

    client_b.post("/api/me/verification", json={"reason": "Tailor for twenty years now."})
    request = client_c.get("/api/admin/verification-requests").json()[0]
    client_c.post(f"/api/admin/verification-requests/{request['id']}/reject", json={"note": "Please add a portfolio"})
    state = client_b.get("/api/me/verification").json()
    assert state["verified"] is False and state["latest_request"]["status"] == "rejected"
    assert state["latest_request"]["review_note"] == "Please add a portfolio"

    assert client_c.delete(f"/api/admin/verified/{USER_A}").status_code == 204
    assert client_b.get("/api/profiles/vistas").json()["verified"] is False


# ---------- onboarding ----------


def test_onboarding_is_resumable_and_skippable(client, client_b, client_c, world):
    from tests.conftest import make_token
    from fastapi.testclient import TestClient

    new = TestClient(client.app, headers={"Authorization": f"Bearer {make_token('44444444-4444-4444-8444-444444444444')}"})
    with client.app.state.container.db.connect(None) as conn:
        conn.execute("INSERT INTO auth.users (id, email) VALUES ('44444444-4444-4444-8444-444444444444', 'd@example.com')")
    first = new.get("/api/me/onboarding").json()
    assert first["is_new"] and first["step"] == "profile" and not first["completed"]

    make_profile(new, "newbie")
    saved = new.put("/api/me/onboarding", json={"step": "follow", "interests": {
        "garments": ["Anarkali", " anarkali ", "Lehenga"], "fabrics": ["Velvet"], "styles": ["Bridal"]}}).json()
    assert saved["step"] == "follow" and saved["interests"]["garments"] == ["Anarkali", "anarkali", "Lehenga"]
    assert new.get("/api/me/onboarding").json()["step"] == "follow"  # resumes where it stopped

    suggested = [p["username"] for p in new.get("/api/onboarding/suggestions").json()]
    assert suggested[:2] == ["vistas", "meera"]  # the designer whose posts match comes first; kabir ("other") is left out
    new.post("/api/profiles/vistas/follow")
    assert "vistas" not in [p["username"] for p in new.get("/api/onboarding/suggestions").json()]

    assert new.post("/api/me/onboarding/skip").json()["skipped"] is True
    done = new.put("/api/me/onboarding", json={"step": "done"}).json()
    assert done["completed"] and done["interests"]["fabrics"] == ["Velvet"]
    assert client.get("/api/me/onboarding").json()["is_new"] is False  # had a profile already: not "new"


def test_new_routes_need_sign_in(anonymous):
    for path in ("/api/me/onboarding", "/api/onboarding/suggestions", "/api/me/verification", "/api/admin/stats"):
        assert anonymous.get(path).status_code == 401, path
