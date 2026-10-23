"""Phase 6B tests: follow / unfollow lists, private accounts and follow requests,
comments (replies, likes, deleting, restrict + approve), reposts, block / restrict /
mute / report, Explore (filters, trending, search), and the Row Level Security rules
behind them, checked with raw SQL as another user."""

from __future__ import annotations

import psycopg
import pytest

from tests.conftest import USER_A, USER_B
from tests.test_phase6a import USER_C, client_c, make_design, make_profile, publish  # noqa: F401 (client_c is a fixture)


@pytest.fixture()
def people(client, client_b, client_c):
    """vistas (A) has a public post; meera (B) and kabir (C) have profiles."""
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    make_profile(client_c, "kabir")
    pid, studio, _, _ = make_design(client)
    post = publish(client, pid, [studio], caption="Wine velvet anarkali",
                   tags={"garment": "Anarkali", "fabric": "Velvet", "occasion": "Wedding"})
    return {"pid": pid, "studio": studio, "post": post["id"]}


# ---------- followers and following ----------


def test_follower_lists_and_remove_follower(client, client_b, client_c, people):
    client_b.post("/api/profiles/vistas/follow")
    client_c.post("/api/profiles/vistas/follow")
    client.post("/api/profiles/meera/follow")
    names = [p["username"] for p in client_b.get("/api/profiles/vistas/followers").json()["people"]]
    assert names == ["kabir", "meera"]  # newest first
    assert [p["username"] for p in client.get("/api/profiles/vistas/following").json()["people"]] == ["meera"]
    detail = client.get("/api/profiles/meera").json()
    assert detail["follows_me"] and detail["follow_status"] == "following"

    assert client.delete("/api/me/followers/kabir").status_code == 204
    assert client.get("/api/profiles/vistas").json()["follower_count"] == 1
    assert client_c.get("/api/profiles/vistas").json()["follow_status"] == "none"
    assert client.delete("/api/me/followers/vistas").status_code == 400


# ---------- private accounts and follow requests ----------


def test_private_account_needs_an_accepted_request(client, client_b, client_c, people):
    assert client.put("/api/me/privacy", json={"is_private": True}).json()["is_private"] is True
    seen = client_b.get("/api/profiles/vistas").json()
    assert seen["is_private"] and not seen["can_see_posts"] and seen["post_count"] == 0
    assert client_b.get(f"/api/posts/{people['post']}").status_code == 404  # its Public post is hidden now
    assert client_b.get("/api/profiles/vistas/followers").status_code == 403

    asked = client_b.post("/api/profiles/vistas/follow").json()
    assert asked["follow_status"] == "requested" and asked["follower_count"] == 0
    client_c.post("/api/profiles/vistas/follow")
    mine = client.get("/api/profiles/vistas").json()
    assert mine["request_count"] == 2
    assert [r["username"] for r in client.get("/api/me/follow-requests").json()] == ["kabir", "meera"]
    assert client_b.get("/api/me/follow-requests").json() == []

    left = client.post("/api/me/follow-requests/meera/accept").json()
    assert [r["username"] for r in left] == ["kabir"]
    assert client_b.get("/api/profiles/vistas").json()["follow_status"] == "following"
    assert client_b.get(f"/api/posts/{people['post']}").status_code == 200
    assert client.delete("/api/me/follow-requests/kabir").json() == []  # declined
    assert client_c.get("/api/profiles/vistas").json()["follow_status"] == "none"
    assert client.post("/api/me/follow-requests/kabir/accept").status_code == 404

    # Cancelling your own request, and going public accepts whatever is still waiting.
    client_c.post("/api/profiles/vistas/follow")
    assert client_c.delete("/api/profiles/vistas/follow").json()["follow_status"] == "none"
    client_c.post("/api/profiles/vistas/follow")
    client.put("/api/me/privacy", json={"is_private": False})
    assert client_c.get("/api/profiles/vistas").json()["follow_status"] == "following"
    assert client.get("/api/me/follow-requests").json() == []


def test_private_account_rules_in_the_database(client, client_b, db, people):
    client.put("/api/me/privacy", json={"is_private": True})
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot skip the request and follow directly
            conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s)", (USER_B, USER_A))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot "accept" a request on someone else's behalf
            conn.execute("INSERT INTO follow_requests (requester_id, target_id) VALUES (%s, %s)", (USER_B, USER_A))
            conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s)", (USER_A, USER_B))
    with db.connect(USER_B) as conn:
        assert conn.execute("SELECT count(*) AS n FROM posts").fetchone()["n"] == 0


# ---------- comments ----------


def test_comments_replies_likes_and_deleting(client, client_b, client_c, people):
    post = people["post"]
    first = client_b.post(f"/api/posts/{post}/comments", json={"body": "  Beautiful drape!  "})
    assert first.status_code == 201 and first.json()["body"] == "Beautiful drape!" and first.json()["approved"]
    cid = first.json()["id"]
    reply = client.post(f"/api/posts/{post}/comments", json={"body": "Thank you!", "parent_id": cid}).json()
    deeper = client_c.post(f"/api/posts/{post}/comments", json={"body": "Reply to reply", "parent_id": reply["id"]})
    assert deeper.status_code == 400 and "not to a reply" in deeper.json()["detail"]
    client_c.post(f"/api/posts/{post}/comments", json={"body": "Where can I buy the fabric?"})
    assert client_b.post(f"/api/posts/{post}/comments", json={"body": "   "}).status_code in (400, 422)

    liked = client_c.post(f"/api/comments/{cid}/like").json()
    assert liked["like_count"] == 1 and liked["liked_by_me"]
    listing = client_c.get(f"/api/posts/{post}/comments").json()
    assert listing["total"] == 3 and [c["body"] for c in listing["comments"]] == ["Beautiful drape!", "Where can I buy the fabric?"]
    assert listing["comments"][0]["replies"][0]["body"] == "Thank you!"
    assert client.get(f"/api/posts/{post}").json()["comment_count"] == 3

    kabirs = listing["comments"][1]["id"]
    assert client_b.delete(f"/api/comments/{kabirs}").status_code == 404  # not hers, not her post
    assert client.delete(f"/api/comments/{kabirs}").status_code == 204  # the post owner may delete any comment
    assert client_b.delete(f"/api/comments/{cid}").status_code == 204  # her own (its reply goes too)
    assert client.get(f"/api/posts/{post}/comments").json()["total"] == 0


def test_comments_need_a_visible_published_post(client, client_b, client_c, people):
    draft = publish(client, people["pid"], [people["studio"]], status="draft")
    res = client.post(f"/api/posts/{draft['id']}/comments", json={"body": "hi"})
    assert res.status_code == 400 and "published" in res.json()["detail"]
    private = publish(client, people["pid"], [people["studio"]], visibility="private")
    assert client_b.post(f"/api/posts/{private['id']}/comments", json={"body": "hi"}).status_code == 404
    assert client_b.get(f"/api/posts/{private['id']}/comments").status_code == 404


def test_restricted_comments_wait_for_approval(client, client_b, client_c, people):
    post = people["post"]
    assert client.post("/api/profiles/meera/restrict").json()["restricted_by_me"]
    pending = client_b.post(f"/api/posts/{post}/comments", json={"body": "Mine is nicer"}).json()
    assert pending["approved"] is False
    assert [c["body"] for c in client_b.get(f"/api/posts/{post}/comments").json()["comments"]] == ["Mine is nicer"]
    assert client_c.get(f"/api/posts/{post}/comments").json()["comments"] == []  # others do not see it
    owner_view = client.get(f"/api/posts/{post}/comments").json()["comments"][0]
    assert owner_view["can_approve"] and not owner_view["approved"]
    assert client_c.post(f"/api/comments/{pending['id']}/approve").status_code == 404
    assert client.post(f"/api/comments/{pending['id']}/approve").json()["approved"] is True
    assert len(client_c.get(f"/api/posts/{post}/comments").json()["comments"]) == 1
    assert [p["username"] for p in client.get("/api/me/restricted").json()] == ["meera"]
    assert client.delete("/api/profiles/meera/restrict").json()["restricted_by_me"] is False
    assert client_b.post(f"/api/posts/{post}/comments", json={"body": "ok"}).json()["approved"] is True


def test_comment_rules_in_the_database(client, client_b, db, people):
    client.post("/api/profiles/meera/restrict")
    with db.connect(USER_B) as conn:  # the database decides "approved", whatever the request says
        row = conn.execute("INSERT INTO comments (post_id, author_id, body, approved) VALUES (%s, %s, 'x', true)"
                           " RETURNING approved", (people["post"], USER_B)).fetchone()
        assert row["approved"] is False
    with db.connect(USER_B) as conn:  # only the post owner may approve
        assert conn.execute("UPDATE comments SET approved = true").rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # nobody may rewrite a comment's text
            conn.execute("UPDATE comments SET body = 'changed'")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # no commenting in someone else's name
            conn.execute("INSERT INTO comments (post_id, author_id, body) VALUES (%s, %s, 'fake')", (people["post"], USER_A))


# ---------- reposts and share ----------


def test_reposts_credit_the_designer(client, client_b, client_c, people):
    post = people["post"]
    assert client.post(f"/api/posts/{post}/repost").json()["detail"] == "You cannot repost your own post."
    reposted = client_b.post(f"/api/posts/{post}/repost").json()
    assert reposted["reposted_by_me"] and reposted["repost_count"] == 1
    grid = client_c.get("/api/profiles/meera/reposts").json()["posts"]
    assert grid[0]["id"] == post and grid[0]["author"]["username"] == "vistas"  # original designer keeps credit
    assert grid[0]["reposted_by"]["username"] == "meera"

    client_c.post("/api/profiles/meera/follow")
    feed = client_c.get("/api/feed").json()["posts"]
    assert feed[0]["id"] == post and feed[0]["reposted_by"]["username"] == "meera"
    assert len([p for p in feed if p["id"] == post]) == 1  # shown once, not twice

    followers_only = publish(client, people["pid"], [people["studio"]], visibility="followers")
    client_b.post("/api/profiles/vistas/follow")
    res = client_b.post(f"/api/posts/{followers_only['id']}/repost")
    assert res.status_code == 400 and "Only Public posts" in res.json()["detail"]
    assert client_b.delete(f"/api/posts/{post}/repost").json()["repost_count"] == 0


def test_repost_rules_in_the_database(client, client_b, db, people):
    followers_only = publish(client, people["pid"], [people["studio"]], visibility="followers")
    client_b.post("/api/profiles/vistas/follow")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:
            conn.execute("INSERT INTO reposts (user_id, post_id) VALUES (%s, %s)", (USER_B, followers_only["id"]))


# ---------- block ----------


def test_block_hides_everything_both_ways(client, client_b, client_c, people):
    post = people["post"]
    client_b.post("/api/profiles/vistas/follow")
    client.post("/api/profiles/meera/follow")
    client_b.post(f"/api/posts/{post}/comments", json={"body": "Lovely"})
    blocked = client.post("/api/profiles/meera/block").json()
    assert blocked["blocked_by_me"] and not blocked["can_see_posts"]
    assert blocked["follower_count"] == 0 and blocked["following_count"] == 0  # unfollowed both ways

    # meera cannot find vistas, see the post, follow, comment or like.
    assert client_b.get("/api/profiles/vistas").status_code == 404
    assert client_b.get(f"/api/posts/{post}").status_code == 404
    assert client_b.post("/api/profiles/vistas/follow").status_code == 404
    assert client_b.post(f"/api/posts/{post}/comments", json={"body": "hi"}).status_code == 404
    assert client_b.post(f"/api/posts/{post}/like").status_code == 404
    assert client_b.get("/api/profiles/search", params={"q": "vis"}).json() == []
    # vistas no longer sees meera's comment, and cannot follow without unblocking.
    assert client.get(f"/api/posts/{post}/comments").json()["comments"] == []
    res = client.post("/api/profiles/meera/follow")
    assert res.status_code == 400 and "Unblock" in res.json()["detail"]
    # Other people are not affected.
    assert len(client_c.get(f"/api/posts/{post}/comments").json()["comments"]) == 1

    assert [p["username"] for p in client.get("/api/me/blocked").json()] == ["meera"]
    assert client.delete("/api/profiles/meera/block").json()["blocked_by_me"] is False
    assert client_b.get(f"/api/posts/{post}").status_code == 200
    assert client_b.get("/api/profiles/vistas").json()["follow_status"] == "none"  # follows do not come back


def test_block_rules_in_the_database(client, client_b, db, people):
    client.post("/api/profiles/meera/block")
    with db.connect(USER_B) as conn:
        assert conn.execute("SELECT count(*) AS n FROM posts").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM profiles WHERE id = %s", (USER_A,)).fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM blocks").fetchone()["n"] == 0  # never told
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:
            conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (%s, %s)", (USER_B, USER_A))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # cannot unblock yourself
            conn.execute("INSERT INTO blocks (blocker_id, blocked_id) VALUES (%s, %s)", (USER_A, USER_C))
    with db.connect(USER_B) as conn:
        assert conn.execute("DELETE FROM blocks").rowcount == 0


# ---------- mute ----------


def test_mute_hides_posts_from_feed_and_explore_only(client, client_b, people):
    client_b.post("/api/profiles/vistas/follow")
    assert len(client_b.get("/api/feed").json()["posts"]) == 1
    muted = client_b.post("/api/profiles/vistas/mute").json()
    assert muted["muted_by_me"] and muted["follow_status"] == "following"  # still following
    assert client_b.get("/api/feed").json()["posts"] == []
    assert client_b.get("/api/explore").json()["posts"] == []
    assert client_b.get(f"/api/posts/{people['post']}").status_code == 200  # still viewable
    assert [p["username"] for p in client_b.get("/api/me/muted").json()] == ["vistas"]
    client_b.delete("/api/profiles/vistas/mute")
    assert len(client_b.get("/api/feed").json()["posts"]) == 1


# ---------- report ----------


def test_reports_are_saved_for_review(client, client_b, db, people):
    post = people["post"]
    comment = client.post(f"/api/posts/{post}/comments", json={"body": "Order via my shop"}).json()
    first = client_b.post("/api/reports", json={"target_type": "post", "target": post, "reason": "copied_design",
                                                "details": "This is my sketch"})
    assert first.status_code == 201 and first.json()["status"] == "open"
    again = client_b.post("/api/reports", json={"target_type": "post", "target": post, "reason": "spam"})
    assert again.json()["id"] == first.json()["id"]  # reporting twice does not make a second report
    assert client_b.post("/api/reports", json={"target_type": "comment", "target": comment["id"],
                                               "reason": "spam"}).status_code == 201
    assert client_b.post("/api/reports", json={"target_type": "user", "target": "@vistas",
                                               "reason": "harassment"}).status_code == 201
    assert client_b.post("/api/reports", json={"target_type": "user", "target": "meera",
                                               "reason": "spam"}).status_code == 400
    assert client_b.post("/api/reports", json={"target_type": "post", "target": post,
                                               "reason": "not-a-reason"}).status_code == 422
    with db.connect(None) as conn:
        rows = conn.execute("SELECT target_type, reason, excerpt, reported_user_id FROM reports ORDER BY created_at").fetchall()
    assert [(r["target_type"], r["reason"]) for r in rows] == [("post", "copied_design"), ("comment", "spam"), ("user", "harassment")]
    assert rows[0]["excerpt"] == "Wine velvet anarkali" and all(r["reported_user_id"] == USER_A for r in rows)
    with db.connect(USER_A) as conn:  # the reported person cannot read reports about them
        assert conn.execute("SELECT count(*) AS n FROM reports").fetchone()["n"] == 0
    with db.connect(USER_B) as conn:  # and the reporter cannot change them
        assert conn.execute("SELECT count(*) AS n FROM reports").fetchone()["n"] == 3
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:
            conn.execute("UPDATE reports SET status = 'resolved'")


# ---------- Explore and search ----------


def test_explore_filters_trending_and_search(client, client_b, client_c, people):
    pid, studio = people["pid"], people["studio"]
    lehenga = publish(client, pid, [studio], caption="Mint organza lehenga", content={"show_fabric": False},
                      tags={"garment": "Lehenga", "fabric": "Organza", "occasion": "Mehendi"})["id"]
    publish(client, pid, [studio], visibility="followers", caption="Followers only",
            tags={"garment": "Lehenga", "fabric": "", "occasion": ""})
    publish(client_b, make_design(client_b)[0], [], status="draft")  # drafts never show

    latest = [p["caption"] for p in client_c.get("/api/explore").json()["posts"]]
    assert latest == ["Mint organza lehenga", "Wine velvet anarkali"]  # Public posts only
    only = client_c.get("/api/explore", params={"garment": "lehenga"}).json()["posts"]
    assert [p["id"] for p in only] == [lehenga]
    by_fabric = client_c.get("/api/explore", params={"fabric": "Velvet"}).json()["posts"]
    assert [p["id"] for p in by_fabric] == [people["post"]]
    assert client_c.get("/api/explore", params={"occasion": "Mehendi"}).json()["posts"][0]["id"] == lehenga

    filters = client_c.get("/api/explore/filters").json()
    assert {f["value"] for f in filters["garments"]} == {"Anarkali", "Lehenga"}
    assert {"Velvet", "Organza"} <= {f["value"] for f in filters["fabrics"]}
    assert "Wine" in {f["value"] for f in filters["colours"]}

    assert client_c.get("/api/explore/trending").json()["posts"] == []  # nothing liked yet
    client_b.post(f"/api/posts/{lehenga}/like")
    client_c.post(f"/api/posts/{lehenga}/save")
    client_c.post(f"/api/posts/{people['post']}/like")
    assert [p["id"] for p in client_c.get("/api/explore/trending").json()["posts"]] == [lehenga, people["post"]]

    found = client_c.get("/api/search", params={"q": "lehen"}).json()
    assert [p["id"] for p in found["posts"]] == [lehenga]
    assert found["tags"] == [{"kind": "garment", "value": "Lehenga", "count": 1}]
    assert [p["username"] for p in client_c.get("/api/search", params={"q": "vis"}).json()["people"]] == ["vistas"]
    assert client_c.get("/api/search", params={"q": "x"}).json() == {"people": [], "tags": [], "posts": []}

    client.put("/api/me/privacy", json={"is_private": True})  # private accounts leave Explore
    assert client_c.get("/api/explore").json()["posts"] == []


def test_explore_colour_filter(client, client_c, people):
    # make_design() gives every design the palette Wine + Gold.
    assert [p["id"] for p in client_c.get("/api/explore", params={"colour": "GOLD"}).json()["posts"]] == [people["post"]]
    assert client_c.get("/api/explore", params={"colour": "Teal"}).json()["posts"] == []


def test_new_tables_are_closed_to_the_browser(db):
    with db.connect(None) as conn:
        for table in ("blocks", "restricts", "mutes", "follow_requests", "comments", "comment_likes", "reposts", "reports"):
            row = conn.execute("SELECT has_table_privilege('anon', %s, 'SELECT') AS ok", (f"public.{table}",)).fetchone()
            assert row["ok"] is False, table


def test_new_routes_need_sign_in(anonymous):
    for path in ("/api/explore", "/api/search?q=ab", "/api/me/blocked", "/api/me/follow-requests",
                 f"/api/posts/{USER_A}/comments"):
        assert anonymous.get(path).status_code == 401, path
