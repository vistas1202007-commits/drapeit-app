"""Phase 6A tests: profiles, publishing (never leaking client details), who can see
which post (in the API and in the database's Row Level Security), the feed with
pagination, likes, saves, close friends, and the draft/archive/pin/delete life cycle."""

from __future__ import annotations

import base64
import json

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.conftest import USER_A, USER_B, make_token

USER_C = "33333333-3333-4333-8333-333333333333"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


# ---------- helpers ----------


def make_profile(client, username, **kw):
    res = client.put("/api/me/profile", json={"username": username, "display_name": username.title(), **kw})
    assert res.status_code == 200, res.text
    return res.json()


def make_design(client, **spec_changes):
    """A design with a studio sketch, a generated sketch and an uploaded reference photo."""
    pid = client.post("/api/projects", json={"title": "Wine anarkali for Meera's wedding",
                                             "idea": "Meera wants it for her sister's wedding"}).json()["id"]
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec.update({"garment_category": "Anarkali", "occasion": "Winter wedding", "colour_palette": ["Wine", "Gold"],
                 "preferred_fabrics": ["Velvet"], "neckline": "V-neck", **spec_changes})
    assert client.post(f"/api/projects/{pid}/versions", json={"spec": spec}).status_code == 201
    studio = client.post(f"/api/projects/{pid}/assets", data={"kind": "sketch"},
                         files={"file": ("studio.png", PNG, "image/png")}).json()
    reference = client.post(f"/api/projects/{pid}/assets", files={"file": ("client-photo.png", PNG, "image/png")}).json()
    generated = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "ink"}}).json()
    return pid, studio["id"], generated["output"]["asset_id"], reference["id"]


def publish(client, pid, image_ids, status="published", visibility="public", caption="New piece", **kw):
    body = {"project_id": pid, "status": status, "visibility": visibility, "caption": caption,
            "content": {"image_asset_ids": image_ids, **kw.pop("content", {})}, **kw}
    res = client.post("/api/posts", json=body)
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture()
def client_c(app, db):
    with db.connect(None) as conn:
        conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, 'c@example.com') ON CONFLICT DO NOTHING", (USER_C,))
    return TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_C)}"})


# ---------- profiles ----------


def test_profile_setup_and_unique_usernames(client, client_b):
    assert client.get("/api/me/profile").json() is None
    mine = make_profile(client, "@Vistas.Atelier", bio="Bridal wear, Jaipur", role="boutique")
    assert mine["username"] == "vistas.atelier" and mine["role"] == "boutique" and not mine["has_avatar"]
    taken = client_b.put("/api/me/profile", json={"username": "vistas.atelier"})
    assert taken.status_code == 409 and "already taken" in taken.json()["detail"]
    bad = client_b.put("/api/me/profile", json={"username": "no spaces!"})
    assert bad.status_code == 400 and "lowercase letters" in bad.json()["detail"]
    assert client_b.put("/api/me/profile", json={"username": "x"}).status_code == 422
    assert client_b.put("/api/me/profile", json={"username": "meera_b", "role": "astronaut"}).status_code == 422
    # Changing your own username is fine.
    assert make_profile(client, "vistas")["username"] == "vistas"


def test_avatar_upload_replaces_the_old_file(client, client_b, supabase):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    first = client.post("/api/me/avatar", files={"file": ("a.png", PNG, "image/png")}).json()
    second = client.post("/api/me/avatar", files={"file": ("b.png", PNG, "image/png")}).json()
    assert second["has_avatar"] and second["avatar_version"] != first["avatar_version"]
    assert len([k for k in supabase.files if k.startswith(f"avatars/{USER_A}/")]) == 1
    token = client_b.get("/api/media-token").json()["token"]
    res = TestClient(client.app).get(f"/api/avatars/{USER_A}", params={"mt": token})
    assert res.status_code == 200 and res.content == PNG
    assert client.post("/api/me/avatar", files={"file": ("x.png", b"not an image", "image/png")}).status_code == 400


def test_avatar_needs_a_profile_first(client, supabase):
    res = client.post("/api/me/avatar", files={"file": ("a.png", PNG, "image/png")})
    assert res.status_code == 400 and "username" in res.json()["detail"]
    assert not any(k.startswith("avatars/") for k in supabase.files)


# ---------- publishing never leaks client details ----------


def test_publish_options_only_offer_design_pictures(client):
    pid, studio, generated, reference = make_design(client)
    options = client.get(f"/api/projects/{pid}/publish-options").json()
    assert {i["asset_id"] for i in options["images"]} == {studio, generated}  # never the uploaded photo
    assert options["has_profile"] is False
    assert options["suggested_tags"] == {"garment": "Anarkali", "fabric": "Velvet", "occasion": "Winter wedding"}
    assert "Meera" not in options["suggested_caption"] and "wine and gold anarkali" in options["suggested_caption"].lower()
    assert [c["name"] for c in options["palette"]] == ["Wine", "Gold"]


def test_posting_needs_a_profile_and_valid_pictures(client):
    pid, studio, generated, reference = make_design(client)
    res = client.post("/api/posts", json={"project_id": pid, "content": {"image_asset_ids": [studio]}})
    assert res.status_code == 400 and "username" in res.json()["detail"]
    make_profile(client, "vistas")
    res = client.post("/api/posts", json={"project_id": pid, "status": "published",
                                          "content": {"image_asset_ids": [reference]}})
    assert res.status_code == 400 and "cannot be published" in res.json()["detail"]
    res = client.post("/api/posts", json={"project_id": pid, "status": "published", "content": {"image_asset_ids": []}})
    assert res.status_code == 400 and "at least one picture" in res.json()["detail"]
    draft = client.post("/api/posts", json={"project_id": pid, "status": "draft", "content": {"image_asset_ids": []}})
    assert draft.status_code == 201  # a draft may wait for pictures


def test_measurements_and_client_details_are_never_published(client, client_b, db, supabase):
    make_profile(client, "vistas")
    make_profile(client_b, "meera_b")
    pid, studio, generated, _ = make_design(
        client, measurements=[{"name": "Bust / chest", "value": 86.5, "verified": True, "note": "Meera, fitted"}],
        budget={"amount": 15432, "currency": "INR", "note": "client pays half"},
        design_notes="Client Meera Sharma, phone 98765 43210",
        tailor={"construction": "Secret tailor note", "cutting": "", "stitching": "", "references": []},
    )
    post = publish(client, pid, [studio, generated], caption="Winter bridal anarkali")
    seen = client_b.get(f"/api/posts/{post['id']}").json()
    with db.connect(None) as conn:
        row = conn.execute("SELECT to_jsonb(p) AS p FROM posts p WHERE id = %s", (post["id"],)).fetchone()["p"]
    everything = json.dumps(seen) + json.dumps(row)
    for secret in ("Meera", "86.5", "15432", "98765", "client pays", "Secret tailor note", "Bust", "fitted"):
        assert secret not in everything, secret
    assert seen["project_id"] is None  # other people never learn which design it came from
    assert len(seen["images"]) == 2 and seen["palette"][0]["name"] == "Wine" and seen["fabrics"][0]["name"] == "Velvet"
    # Pictures are copies in the post's own folder, not the design's files.
    copies = {k: v for k, v in supabase.files.items() if k.startswith(f"posts/{USER_A}/{post['id']}/")}
    assert len(copies) == 2
    # The mock sketch prints the design's name inside the picture; the published copy must not.
    svg = next(data for k, (data, _) in copies.items() if k.endswith(".svg")).decode()
    original = next(data for k, (data, _) in supabase.files.items() if k.endswith(f"{generated}.svg")).decode()
    assert "Meera" in original  # the design's own picture is untouched...
    assert "Meera" not in svg and "MOCK SKETCH" in svg and svg.startswith("<svg")  # ...the post's copy is clean


def test_author_can_hide_palette_and_fabric(client):
    make_profile(client, "vistas")
    pid, studio, _, _ = make_design(client)
    post = publish(client, pid, [studio], content={"show_palette": False, "show_fabric": False})
    assert post["palette"] == [] and post["fabrics"] == []


# ---------- who can see what ----------


@pytest.fixture()
def four_posts(client):
    make_profile(client, "vistas")
    pid, studio, _, _ = make_design(client)
    return {v: publish(client, pid, [studio], visibility=v, caption=v)["id"]
            for v in ("public", "followers", "close_friends", "private")}


def visible(c, ids):
    return {v for v, pid in ids.items() if c.get(f"/api/posts/{pid}").status_code == 200}


def test_visibility_rules_in_the_api(client, client_b, client_c, four_posts):
    make_profile(client_b, "meera")
    make_profile(client_c, "kabir")
    assert visible(client, four_posts) == {"public", "followers", "close_friends", "private"}
    assert visible(client_b, four_posts) == {"public"}

    client_b.post("/api/profiles/vistas/follow")
    assert visible(client_b, four_posts) == {"public", "followers"}

    client.post("/api/me/close-friends", json={"username": "meera"})
    assert visible(client_b, four_posts) == {"public", "followers", "close_friends"}
    # A close friend who does not follow still sees followers-only posts; others do not.
    client.post("/api/me/close-friends", json={"username": "kabir"})
    assert visible(client_c, four_posts) == {"public", "followers", "close_friends"}
    client.delete("/api/me/close-friends/kabir")
    assert visible(client_c, four_posts) == {"public"}

    feed_b = [p["caption"] for p in client_b.get("/api/feed").json()["posts"]]
    assert sorted(feed_b) == ["close_friends", "followers", "public"]
    grid_c = client_c.get("/api/profiles/vistas/posts").json()
    assert [p["caption"] for p in grid_c["posts"]] == ["public"]
    assert client_c.get("/api/profiles/vistas").json()["post_count"] == 1


def test_drafts_and_archived_posts_are_only_for_the_author(client, client_b):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    pid, studio, _, _ = make_design(client)
    draft = publish(client, pid, [studio], status="draft")
    live = publish(client, pid, [studio])
    assert client_b.get(f"/api/posts/{draft['id']}").status_code == 404
    client.patch(f"/api/posts/{live['id']}", json={"status": "archived"})
    assert client_b.get(f"/api/posts/{live['id']}").status_code == 404
    assert client_b.get("/api/feed").json()["posts"] == []
    assert [p["id"] for p in client.get("/api/me/posts", params={"status": "draft"}).json()["posts"]] == [draft["id"]]
    assert [p["id"] for p in client.get("/api/me/posts", params={"status": "archived"}).json()["posts"]] == [live["id"]]


def test_post_pictures_follow_the_post_visibility(client, client_b, four_posts):
    make_profile(client_b, "meera")
    token_b = client_b.get("/api/media-token").json()["token"]
    anon = TestClient(client.app)
    public = client.get(f"/api/posts/{four_posts['public']}").json()["images"][0]["id"]
    private = client.get(f"/api/posts/{four_posts['private']}").json()["images"][0]["id"]
    assert anon.get(f"/api/post-images/{public}", params={"mt": token_b}).content == PNG
    assert anon.get(f"/api/post-images/{private}", params={"mt": token_b}).status_code == 404
    assert anon.get(f"/api/post-images/{public}").status_code == 401


def test_row_level_security_enforces_visibility_with_raw_sql(client, client_b, db, four_posts):
    make_profile(client_b, "meera")
    with db.connect(USER_B) as conn:
        captions = {r["caption"] for r in conn.execute("SELECT caption FROM posts").fetchall()}
        assert captions == {"public"}
        assert conn.execute("SELECT count(*) AS n FROM post_images").fetchone()["n"] == 1
        assert conn.execute("SELECT count(*) AS n FROM close_friends").fetchone()["n"] == 0
        assert conn.execute("UPDATE posts SET caption = 'hacked'").rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot like a post you cannot see
            conn.execute("INSERT INTO post_likes (post_id, user_id) VALUES (%s, %s)", (four_posts["private"], USER_B))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot post in someone else's name
            conn.execute("INSERT INTO posts (author_id, caption) VALUES (%s, 'fake')", (USER_A,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot put yourself on someone's close friends list
            conn.execute("INSERT INTO close_friends (owner_id, friend_id) VALUES (%s, %s)", (USER_A, USER_B))
    with db.connect(None) as conn:
        for table in ("posts", "post_images", "post_likes", "post_saves", "follows", "close_friends"):
            row = conn.execute("SELECT has_table_privilege('anon', %s, 'SELECT') AS ok", (f"public.{table}",)).fetchone()
            assert row["ok"] is False, table


# ---------- feed, likes, saves ----------


def test_feed_is_newest_first_and_paginated(client, client_b):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    pid, studio, _, _ = make_design(client)
    ids = [publish(client, pid, [studio], caption=f"post {i}")["id"] for i in range(15)]
    first = client_b.get("/api/feed").json()
    assert len(first["posts"]) == 12 and first["next_cursor"]
    second = client_b.get("/api/feed", params={"cursor": first["next_cursor"]}).json()
    assert len(second["posts"]) == 3 and second["next_cursor"] is None
    assert [p["id"] for p in first["posts"] + second["posts"]] == list(reversed(ids))
    bad = client_b.get("/api/feed", params={"cursor": "nonsense"})
    assert bad.status_code == 400 and "reload" in bad.json()["detail"]


def test_likes_saves_and_the_saved_page(client, client_b, four_posts):
    make_profile(client_b, "meera")
    pid = four_posts["public"]
    liked = client_b.post(f"/api/posts/{pid}/like").json()
    assert liked["like_count"] == 1 and liked["liked_by_me"]
    client_b.post(f"/api/posts/{pid}/like")  # liking twice changes nothing
    saved = client_b.post(f"/api/posts/{pid}/save").json()
    assert saved["save_count"] == 1 and saved["saved_by_me"] and saved["like_count"] == 1
    author_view = client.get(f"/api/posts/{pid}").json()
    assert author_view["like_count"] == 1 and author_view["save_count"] == 1 and not author_view["saved_by_me"]
    assert [p["id"] for p in client_b.get("/api/me/saved").json()["posts"]] == [pid]
    assert client.get("/api/me/saved").json()["posts"] == []  # saves are private
    assert client_b.post(f"/api/posts/{four_posts['private']}/like").status_code == 404
    client_b.delete(f"/api/posts/{pid}/save")
    client_b.delete(f"/api/posts/{pid}/like")
    assert client_b.get("/api/me/saved").json()["posts"] == []
    assert client.get(f"/api/posts/{pid}").json()["like_count"] == 0
    # A saved post that becomes private disappears from the Saved page.
    client_b.post(f"/api/posts/{pid}/save")
    client.patch(f"/api/posts/{pid}", json={"visibility": "private"})
    assert client_b.get("/api/me/saved").json()["posts"] == []


# ---------- life cycle: drafts, edit, archive, pin, delete ----------


def test_draft_edit_publish_archive_pin_delete(client, client_b, supabase):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    pid, studio, generated, _ = make_design(client)
    draft = publish(client, pid, [studio], status="draft", caption="First try")
    assert draft["published_at"] is None and draft["project_id"] == pid

    edited = client.patch(f"/api/posts/{draft['id']}", json={
        "caption": "  Wine velvet anarkali  ", "visibility": "followers",
        "tags": {"garment": "Anarkali", "fabric": "Velvet", "occasion": "Wedding"},
        "content": {"image_asset_ids": [generated, studio], "show_palette": False}}).json()
    assert edited["caption"] == "Wine velvet anarkali" and edited["visibility"] == "followers"
    assert [i["kind"] for i in edited["images"]] == ["generated", "sketch"] and edited["palette"] == []
    assert sum(k.startswith(f"posts/{USER_A}/{draft['id']}/") for k in supabase.files) == 2  # old copy removed

    live = client.patch(f"/api/posts/{draft['id']}", json={"status": "published"}).json()
    assert live["published_at"]
    bad = client.patch(f"/api/posts/{draft['id']}", json={"status": "draft"})
    assert bad.status_code == 400 and "archived" in bad.json()["detail"]

    pinned = client.patch(f"/api/posts/{draft['id']}", json={"pinned": True}).json()
    assert pinned["pinned"]
    others = [publish(client, pid, [studio])["id"] for _ in range(3)]
    client.patch(f"/api/posts/{others[0]}", json={"pinned": True})
    client.patch(f"/api/posts/{others[1]}", json={"pinned": True})
    fourth = client.patch(f"/api/posts/{others[2]}", json={"pinned": True})
    assert fourth.status_code == 400 and "up to 3" in fourth.json()["detail"]
    grid = client.get("/api/profiles/vistas/posts").json()  # the author sees all three pinned posts
    assert {p["id"] for p in grid["pinned"]} == {draft["id"], others[0], others[1]}
    assert others[2] in {p["id"] for p in grid["posts"]}
    # The first post is followers-only and meera does not follow, so her grid leaves it out.
    grid_b = client_b.get("/api/profiles/vistas/posts").json()
    assert {p["id"] for p in grid_b["pinned"]} == {others[0], others[1]}

    archived = client.patch(f"/api/posts/{draft['id']}", json={"status": "archived"}).json()
    assert archived["status"] == "archived" and not archived["pinned"]  # archiving unpins
    again = client.patch(f"/api/posts/{draft['id']}", json={"status": "published"}).json()
    assert again["published_at"] == live["published_at"]  # keeps its original date

    assert client_b.delete(f"/api/posts/{draft['id']}").status_code == 404  # not yours
    assert client.delete(f"/api/posts/{draft['id']}").status_code == 204
    assert client.get(f"/api/posts/{draft['id']}").status_code == 404
    # Since Phase 6D a deleted post waits in "Recently deleted"; deleting it from there removes its pictures.
    assert client.delete(f"/api/posts/{draft['id']}?permanent=true").status_code == 204
    assert not any(k.startswith(f"posts/{USER_A}/{draft['id']}/") for k in supabase.files)


def test_profile_grid_shows_pinned_first(client, client_b):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    pid, studio, _, _ = make_design(client)
    a, b, c = (publish(client, pid, [studio], caption=n)["id"] for n in ("a", "b", "c"))
    client.patch(f"/api/posts/{a}", json={"pinned": True})
    grid = client_b.get("/api/profiles/vistas/posts").json()
    assert [p["id"] for p in grid["pinned"]] == [a]
    assert [p["id"] for p in grid["posts"]] == [c, b]


def test_post_survives_when_its_design_is_deleted(client, client_b):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    pid, studio, _, _ = make_design(client)
    post = publish(client, pid, [studio])
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    still = client.get(f"/api/posts/{post['id']}").json()
    assert still["project_id"] is None
    token = client_b.get("/api/media-token").json()["token"]
    assert TestClient(client.app).get(f"/api/post-images/{still['images'][0]['id']}", params={"mt": token}).content == PNG
    res = client.patch(f"/api/posts/{post['id']}", json={"content": {"image_asset_ids": []}})
    assert res.status_code == 400 and "was deleted" in res.json()["detail"]


# ---------- people: follow, close friends, search ----------


def test_follow_counts_close_friends_and_search(client, client_b, client_c):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    make_profile(client_c, "kabir", display_name="Kabir Tailors")
    after = client_b.post("/api/profiles/vistas/follow").json()
    assert after["is_following"] and after["follower_count"] == 1
    assert client_b.get("/api/profiles/meera").json()["following_count"] == 1
    assert client.post("/api/profiles/vistas/follow").json()["detail"] == "You cannot follow yourself."
    assert client_b.delete("/api/profiles/vistas/follow").json()["follower_count"] == 0

    assert [p["username"] for p in client.get("/api/profiles/search", params={"q": "kab"}).json()] == ["kabir"]
    assert [p["username"] for p in client.get("/api/profiles/search", params={"q": "Kabir T"}).json()] == ["kabir"]
    assert client.get("/api/profiles/search", params={"q": "vis"}).json() == []  # never yourself
    friends = client.post("/api/me/close-friends", json={"username": "@kabir"}).json()
    assert [f["username"] for f in friends] == ["kabir"]
    assert client.get("/api/profiles/kabir").json()["is_close_friend"] is True
    assert client_c.get("/api/me/close-friends").json() == []  # nobody sees another person's list
    assert client.post("/api/me/close-friends", json={"username": "nobody_here"}).status_code == 404
    assert client.delete("/api/me/close-friends/kabir").json() == []
    assert client.get("/api/profiles/does.not.exist").status_code == 404


def test_social_routes_need_sign_in(anonymous):
    for path in ("/api/feed", "/api/me/profile", "/api/me/saved", "/api/me/close-friends", "/api/profiles/x"):
        assert anonymous.get(path).status_code == 401, path
