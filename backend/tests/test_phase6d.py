"""Phase 6D tests: deactivate and delete account (grace period, purge with files), download my
data, hidden words, who can comment, who can mention me, Recently deleted posts, liked posts and
my comments, search history, time spent, report a problem, and the new Row Level Security rules
checked with raw SQL."""

from __future__ import annotations

import json

import psycopg
import pytest

from app.services.cleanup import purge_due
from tests.conftest import USER_A, USER_B
from tests.test_phase6a import PNG, USER_C, client_c, make_design, make_profile, publish  # noqa: F401 (client_c is a fixture)


@pytest.fixture()
def people(client, client_b, client_c):
    """vistas (A) has a public post; meera (B) and kabir (C) have profiles."""
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    make_profile(client_c, "kabir")
    pid, studio, _, _ = make_design(client)
    post = publish(client, pid, [studio], caption="Wine velvet anarkali")
    return {"pid": pid, "studio": studio, "post": post["id"]}


def age(db, sql_text, *values):
    """Pretend something happened 31 days ago."""
    with db.connect(None) as conn:
        conn.execute(sql_text, values)


def run_purge(app, supabase):
    c = app.state.container
    import httpx

    return purge_due(c.db, c.store, httpx.Client(transport=httpx.MockTransport(supabase.handler)),
                     c.settings.supabase_url, c.settings.supabase_secret_key)


# ---------- account ----------


def test_deactivate_hides_everything_until_reactivated(client, client_b, people):
    chat = client_b.post("/api/chats", json={"username": "vistas"}).json()
    status = client.post("/api/me/deactivate").json()
    assert status["deactivated"] and status["has_profile"] and status["username"] == "vistas"
    assert client_b.get("/api/profiles/vistas").status_code == 404
    assert client_b.get(f"/api/posts/{people['post']}").status_code == 404
    assert client_b.get("/api/explore").json()["posts"] == []
    assert client_b.get("/api/search?q=vistas").json()["people"] == []
    assert client_b.post(f"/api/chats/{chat['id']}/messages", json={"body": "hi"}).status_code == 400
    assert client.get("/api/me/profile").json()["username"] == "vistas"  # you still see yourself

    assert client.post("/api/me/reactivate").json()["deactivated"] is False
    assert client_b.get("/api/profiles/vistas").status_code == 200
    assert client_b.get(f"/api/posts/{people['post']}").status_code == 200


def test_delete_account_needs_the_username_and_can_be_cancelled(client, client_b, people):
    bad = client.post("/api/me/delete", json={"confirm": "meera"})
    assert bad.status_code == 400 and "username" in bad.json()["detail"]
    status = client.post("/api/me/delete", json={"confirm": "@Vistas"}).json()
    assert status["delete_requested_at"] and status["delete_after"]
    assert client_b.get("/api/profiles/vistas").status_code == 404  # hidden during the 30 days
    cancelled = client.delete("/api/me/delete").json()
    assert cancelled["delete_requested_at"] is None and not cancelled["deactivated"]
    assert client_b.get("/api/profiles/vistas").status_code == 200


def test_account_without_profile_confirms_with_email(client):
    status = client.get("/api/me/account").json()
    assert status["has_profile"] is False and status["email"] == f"{USER_A[:4]}@example.com"
    assert client.post("/api/me/delete", json={"confirm": "vistas"}).status_code == 400
    assert client.post("/api/me/delete", json={"confirm": status["email"].upper()}).status_code == 200


def test_purge_deletes_accounts_and_their_files_after_30_days(app, client, client_b, db, supabase, people):
    client.post("/api/me/avatar", files={"file": ("me.png", PNG, "image/png")})
    chat = client.post("/api/chats", json={"username": "meera"}).json()
    client.post(f"/api/chats/{chat['id']}/design", json={"project_id": people["pid"], "asset_id": people["studio"]})
    client.post("/api/problem-reports", data={"category": "bug", "description": "It broke"},
                files={"screenshot": ("s.png", PNG, "image/png")})
    mine = [k for k in supabase.files if USER_A in k or k.startswith(f"messages/{chat['id']}")]
    assert len(mine) >= 5  # design pictures, post picture, avatar, chat picture, screenshot

    client.post("/api/me/delete", json={"confirm": "vistas"})
    assert run_purge(app, supabase) == {"posts": 0, "accounts": 0}  # not yet: 30 days to change your mind
    age(db, "UPDATE account_status SET delete_requested_at = now() - interval '31 days' WHERE user_id = %s", USER_A)
    assert run_purge(app, supabase)["accounts"] == 1
    assert supabase.deleted_users == [USER_A]
    assert not [k for k in supabase.files if k in mine]


def test_download_my_data(client, client_b, people):
    client_b.post(f"/api/posts/{people['post']}/comments", json={"body": "Lovely"})
    client.post(f"/api/posts/{people['post']}/comments", json={"body": "Thank you"})
    chat = client.post("/api/chats", json={"username": "meera"}).json()
    client.post(f"/api/chats/{chat['id']}/messages", json={"body": "Hello Meera"})
    res = client.get("/api/me/export")
    assert res.status_code == 200 and "attachment" in res.headers["content-disposition"]
    data = json.loads(res.content)
    assert data["profile"]["username"] == "vistas"
    assert [c["body"] for c in data["comments"]] == ["Thank you"]  # only your own comments
    assert [m["body"] for m in data["messages"]] == ["Hello Meera"]
    assert len(data["posts"]) == 1 and len(data["designs"]) == 1
    assert data["designs"][0]["project"]["id"] == people["pid"]
    other = json.loads(client_b.get("/api/me/export").content)
    assert other["designs"] == [] and [c["body"] for c in other["comments"]] == ["Lovely"]


# ---------- privacy ----------


def test_hidden_words_hide_comments_from_others(client, client_b, client_c, people):
    saved = client.put("/api/me/privacy-settings", json={"hidden_words": ["  CHEAP ", "cheap", "fake"]}).json()
    assert saved["hidden_words"] == ["cheap", "fake"]
    post = people["post"]
    client_b.post(f"/api/posts/{post}/comments", json={"body": "So cheap looking"})
    client_b.post(f"/api/posts/{post}/comments", json={"body": "Beautiful"})
    assert [c["body"] for c in client_c.get(f"/api/posts/{post}/comments").json()["comments"]] == ["Beautiful"]
    writer = client_b.get(f"/api/posts/{post}/comments").json()["comments"]
    owner = client.get(f"/api/posts/{post}/comments").json()["comments"]
    assert [c["hidden"] for c in writer] == [True, False] and [c["hidden"] for c in owner] == [True, False]
    assert client.put("/api/me/privacy-settings", json={"hidden_words": ["x" * 31]}).status_code == 422


def test_who_can_comment(client, client_b, client_c, db, people):
    post = people["post"]
    client.put("/api/me/privacy-settings", json={"allow_comments_from": "followers"})
    assert client_b.get(f"/api/posts/{post}").json()["can_comment"] is False
    refused = client_b.post(f"/api/posts/{post}/comments", json={"body": "Hi"})
    assert refused.status_code == 400 and "limited who can comment" in refused.json()["detail"]
    client_b.post("/api/profiles/vistas/follow")
    assert client_b.post(f"/api/posts/{post}/comments", json={"body": "Hi"}).status_code == 201

    client.put("/api/me/privacy-settings", json={"allow_comments_from": "nobody"})
    assert client_b.post(f"/api/posts/{post}/comments", json={"body": "Again"}).status_code == 400
    assert client.post(f"/api/posts/{post}/comments", json={"body": "Mine is fine"}).status_code == 201
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_C) as conn:  # the database refuses too
            conn.execute("INSERT INTO comments (post_id, author_id, body) VALUES (%s, %s, 'x')", (post, USER_C))


def test_who_can_mention_me(client, client_b, client_c, people):
    client_b.put("/api/me/privacy-settings", json={"allow_mentions_from": "followers"})
    client.post(f"/api/posts/{people['post']}/comments", json={"body": "Thanks @meera"})
    client_c.post(f"/api/posts/{people['post']}/comments", json={"body": "@meera look"})
    assert client_b.get("/api/notifications").json()["notifications"] == []  # neither follows meera
    client_c.post("/api/profiles/meera/follow")
    client_c.post(f"/api/posts/{people['post']}/comments", json={"body": "@meera again"})
    assert [n["type"] for n in client_b.get("/api/notifications").json()["notifications"]] == ["mention", "follow"]


# ---------- your activity ----------


def test_recently_deleted_posts_restore_and_purge(app, client, client_b, db, supabase, people):
    post = people["post"]
    assert client.delete(f"/api/posts/{post}").status_code == 204
    assert client_b.get(f"/api/posts/{post}").status_code == 404
    assert client.get(f"/api/posts/{post}").status_code == 404
    deleted = client.get("/api/me/posts?status=deleted").json()["posts"]
    assert [p["id"] for p in deleted] == [post] and deleted[0]["deleted_at"]
    assert client.patch(f"/api/posts/{post}", json={"caption": "x"}).status_code == 400
    restored = client.post(f"/api/posts/{post}/restore").json()
    assert restored["status"] == "published" and restored["deleted_at"] is None
    assert client_b.get(f"/api/posts/{post}").status_code == 200

    client.delete(f"/api/posts/{post}")
    pictures = [k for k in supabase.files if k.startswith(f"posts/{USER_A}/{post}/")]
    assert pictures and run_purge(app, supabase)["posts"] == 0
    age(db, "UPDATE posts SET deleted_at = now() - interval '31 days' WHERE id = %s", post)
    assert run_purge(app, supabase)["posts"] == 1
    assert not [k for k in supabase.files if k in pictures]
    assert client.get("/api/me/posts?status=deleted").json()["posts"] == []


def test_liked_posts_and_my_comments(client, client_b, people):
    client_b.post(f"/api/posts/{people['post']}/like")
    assert [p["id"] for p in client_b.get("/api/me/liked").json()["posts"]] == [people["post"]]
    for n in range(3):
        client_b.post(f"/api/posts/{people['post']}/comments", json={"body": f"note {n}"})
    mine = client_b.get("/api/me/comments").json()["comments"]
    assert [c["body"] for c in mine] == ["note 2", "note 1", "note 0"]
    assert mine[0]["post_author"]["username"] == "vistas" and mine[0]["post_image_id"]
    assert client.get("/api/me/comments").json()["comments"] == []


def test_search_history(client, client_b, people):
    for q in ("an", "anar", "anarkali", "Velvet", "anarkali"):
        assert client.post("/api/me/search-history", json={"query": q}).status_code == 204
    history = client.get("/api/me/search-history").json()
    assert [h["query"] for h in history] == ["anarkali", "Velvet"]  # half-typed searches folded away
    assert client_b.get("/api/me/search-history").json() == []
    assert client.delete(f"/api/me/search-history/{history[1]['id']}").status_code == 204
    assert client_b.delete(f"/api/me/search-history/{history[0]['id']}").status_code == 404
    assert client.delete("/api/me/search-history").status_code == 204
    assert client.get("/api/me/search-history").json() == []


def test_time_spent(client, db):
    from datetime import date

    today = date.today().isoformat()
    assert client.post("/api/me/time", json={"day": today}).status_code == 204
    age(db, "UPDATE time_spent SET last_ping_at = now() - interval '45 seconds'")
    client.post("/api/me/time", json={"day": today})
    age(db, "UPDATE time_spent SET last_ping_at = now() - interval '2 hours'")
    client.post("/api/me/time", json={"day": today})  # a long gap still counts one minute at most
    week = client.get(f"/api/me/time?today={today}").json()
    assert len(week) == 7 and week[-1]["day"] == today and 104 <= week[-1]["seconds"] <= 106
    assert client.post("/api/me/time", json={"day": "2001-01-01"}).status_code == 400


# ---------- help ----------


def test_report_a_problem(client, client_b, db, supabase):
    res = client.post("/api/problem-reports", data={"category": "bug", "description": "The sketch button froze",
                                                    "page": "/projects/x", "browser": "Chrome"},
                      files={"screenshot": ("s.png", PNG, "image/png")})
    assert res.status_code == 201
    assert [k for k in supabase.files if k.startswith(f"problem-reports/{USER_A}/")]
    assert client.post("/api/problem-reports", data={"category": "bug", "description": "x"}).status_code in (400, 422)
    fake = client.post("/api/problem-reports", data={"category": "bug", "description": "bad file"},
                       files={"screenshot": ("s.png", b"not a picture", "image/png")})
    assert fake.status_code == 400
    with db.connect(USER_B) as conn:
        assert conn.execute("SELECT count(*) AS n FROM problem_reports").fetchone()["n"] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_A) as conn:  # cannot be changed afterwards
            conn.execute("UPDATE problem_reports SET status = 'resolved'")


def test_new_tables_are_closed_to_the_browser(db):
    with db.connect(None) as conn:
        for table in ("account_status", "privacy_settings", "search_history", "time_spent", "problem_reports"):
            row = conn.execute("SELECT has_table_privilege('authenticated', %s, 'SELECT') AS ok",
                               (f"public.{table}",)).fetchone()
            assert row["ok"] is False, table


def test_new_routes_need_sign_in(anonymous):
    for path in ("/api/me/account", "/api/me/export", "/api/me/privacy-settings", "/api/me/search-history",
                 "/api/me/comments", "/api/me/liked"):
        assert anonymous.get(path).status_code == 401, path
