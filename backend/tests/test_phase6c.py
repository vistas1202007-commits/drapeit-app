"""Phase 6C tests: chats (inbox, unread, "Seen", message requests, the "Who can
message me" setting, blocks, sharing posts and design pictures, unsend, delete for
me), notifications (every type, undo, settings, mark as read, badges), the Row
Level Security rules behind them checked with raw SQL, and the Realtime pings."""

from __future__ import annotations

import psycopg
import pytest

from tests.conftest import USER_A, USER_B
from tests.test_phase6a import USER_C, client_c, make_design, make_profile, publish  # noqa: F401 (client_c is a fixture)


@pytest.fixture()
def people(client, client_b, client_c):
    """vistas (A), meera (B) and kabir (C) all have profiles."""
    for c, name in ((client, "vistas"), (client_b, "meera"), (client_c, "kabir")):
        make_profile(c, name)


def open_chat(c, username):
    res = c.post("/api/chats", json={"username": username})
    assert res.status_code == 200, res.text
    return res.json()


def say(c, chat_id, text, status=201):
    res = c.post(f"/api/chats/{chat_id}/messages", json={"body": text})
    assert res.status_code == status, res.text
    return res.json()


def folder(c, name="inbox"):
    return c.get(f"/api/chats?folder={name}").json()


def kinds(c):
    return [n["type"] for n in c.get("/api/notifications").json()["notifications"]]


# ---------- chats ----------


def test_chat_inbox_unread_and_seen(client, client_b, people):
    client_b.post("/api/profiles/vistas/follow")  # meera follows vistas, so vistas's chat goes straight to her inbox
    chat = open_chat(client, "meera")
    assert chat["status"] == "accepted" and chat["can_send"] and chat["other"]["username"] == "meera"
    assert folder(client_b)["chats"] == []  # nothing to show until a message is sent

    first = say(client, chat["id"], "  Hello Meera!  ")
    assert first["body"] == "Hello Meera!" and first["is_mine"] and first["kind"] == "text"
    say(client, chat["id"], "Do you like the wine velvet?")
    inbox = folder(client_b)
    assert [(c["other"]["username"], c["unread_count"], c["last_message"]) for c in inbox["chats"]] == [
        ("vistas", 2, "Do you like the wine velvet?")]
    assert client_b.get("/api/me/badges").json() == {"notifications": 0, "chats": 1, "requests": 0}
    assert client.get(f"/api/chats/{chat['id']}").json()["seen_message_id"] is None

    page = client_b.get(f"/api/chats/{chat['id']}/messages").json()
    assert [m["body"] for m in page["messages"]] == ["Hello Meera!", "Do you like the wine velvet?"]  # oldest first
    assert not page["messages"][0]["is_mine"]
    assert client_b.post(f"/api/chats/{chat['id']}/read").status_code == 204
    assert folder(client_b)["chats"][0]["unread_count"] == 0
    assert client_b.get("/api/me/badges").json()["chats"] == 0
    assert client.get(f"/api/chats/{chat['id']}").json()["seen_message_id"] == page["messages"][1]["id"]

    assert open_chat(client_b, "vistas")["id"] == chat["id"]  # one chat per pair, whoever opens it
    assert client.post("/api/chats", json={"username": "vistas"}).status_code == 400  # not yourself
    say(client, chat["id"], "   ", status=400)


def test_older_messages_come_in_pages(client, client_b, people):
    chat = open_chat(client, "meera")
    for n in range(45):
        say(client, chat["id"], f"note {n}")
    page = client_b.get(f"/api/chats/{chat['id']}/messages").json()
    assert len(page["messages"]) == 40 and page["messages"][-1]["body"] == "note 44" and page["next_cursor"]
    older = client_b.get(f"/api/chats/{chat['id']}/messages", params={"before": page["next_cursor"]}).json()
    assert [m["body"] for m in older["messages"]] == [f"note {n}" for n in range(5)] and older["next_cursor"] is None


def test_message_requests_accept_reply_and_delete(client, client_b, client_c, people):
    chat = open_chat(client, "meera")  # meera does not follow vistas: a request for her
    say(client, chat["id"], "Hi! Can I ask about your blouse pattern?")
    assert folder(client)["chats"][0]["status"] == "accepted"  # the sender's side is a normal chat
    assert folder(client_b)["chats"] == []
    requests = folder(client_b, "requests")
    assert requests["request_count"] == 1 and requests["chats"][0]["status"] == "request"
    assert client_b.get("/api/me/badges").json()["requests"] == 1
    assert client_b.get(f"/api/chats/{chat['id']}").json()["status"] == "request"

    accepted = client_b.post(f"/api/chats/{chat['id']}/accept").json()
    assert accepted["status"] == "accepted"
    assert len(folder(client_b)["chats"]) == 1 and folder(client_b, "requests")["request_count"] == 0

    # kabir writes to meera; replying accepts the request too.
    kchat = open_chat(client_c, "meera")
    say(client_c, kchat["id"], "Hello from Kabir")
    say(client_b, kchat["id"], "Hi Kabir")
    assert folder(client_b, "requests")["chats"] == []

    # Deleting a chat hides it (and its old messages) for you only; a new message brings it back.
    assert client_b.delete(f"/api/chats/{kchat['id']}").status_code == 204
    assert [c["id"] for c in folder(client_b)["chats"]] == [chat["id"]]
    assert len(client_c.get(f"/api/chats/{kchat['id']}/messages").json()["messages"]) == 2
    say(client_c, kchat["id"], "Are you there?")
    assert [m["body"] for m in client_b.get(f"/api/chats/{kchat['id']}/messages").json()["messages"]] == ["Are you there?"]


def test_who_can_message_me(client, client_b, client_c, people):
    assert client_b.get("/api/me/messaging").json() == {"allow_messages_from": "everyone"}
    assert client_b.put("/api/me/messaging", json={"allow_messages_from": "nobody"}).json()["allow_messages_from"] == "nobody"
    refused = client.post("/api/chats", json={"username": "meera"})
    assert refused.status_code == 400 and "not accepting messages" in refused.json()["detail"]
    assert client.get("/api/profiles/meera").json()["can_message"] is False

    client_b.put("/api/me/messaging", json={"allow_messages_from": "followers"})
    assert client.post("/api/chats", json={"username": "meera"}).status_code == 400
    client.post("/api/profiles/meera/follow")  # vistas follows meera: now she is a follower
    assert client.get("/api/profiles/meera").json()["can_message"] is True
    chat = open_chat(client, "meera")
    say(client, chat["id"], "Hello")

    # People meera follows can always message her, even with "nobody".
    client_b.put("/api/me/messaging", json={"allow_messages_from": "nobody"})
    client_b.post("/api/profiles/kabir/follow")
    kchat = open_chat(client_c, "meera")
    assert kchat["status"] == "accepted"
    say(client_c, kchat["id"], "Hi Meera")
    assert len(folder(client_b)["chats"]) == 1  # kabir's chat is in her inbox (she follows him) ...
    assert folder(client_b, "requests")["request_count"] == 1  # ... vistas's waits as a request

    # A request she has not accepted stops working when she says "nobody"; an accepted chat keeps working.
    say(client, chat["id"], "Still there?", status=400)
    client_b.post(f"/api/chats/{chat['id']}/accept")
    say(client, chat["id"], "Still there?")
    assert client_b.put("/api/me/messaging", json={"allow_messages_from": "anyone"}).status_code == 422


def test_blocking_stops_messages_both_ways(client, client_b, client_c, people):
    chat = open_chat(client, "meera")
    say(client, chat["id"], "Hello")
    client_b.post("/api/profiles/vistas/block")
    say(client, chat["id"], "Hello?", status=404)  # she blocked vistas: the chat is gone for him
    assert client.get(f"/api/chats/{chat['id']}").status_code == 404
    assert folder(client)["chats"] == []
    detail = client_b.get(f"/api/chats/{chat['id']}").json()
    assert not detail["can_send"] and detail["blocked_by_me"] and "Unblock" in detail["cannot_send_reason"]
    assert client_b.post("/api/chats", json={"username": "vistas"}).status_code == 400
    assert client_b.get("/api/profiles/vistas").json()["can_message"] is False

    client_b.delete("/api/profiles/vistas/block")
    say(client, chat["id"], "Back again")
    # Reporting the person from the chat uses the usual report.
    report = client_b.post("/api/reports", json={"target_type": "user", "target": "vistas", "reason": "harassment"})
    assert report.status_code == 201


def test_sharing_posts_in_chats(client, client_b, client_c, people):
    pid, studio, _, _ = make_design(client)
    public = publish(client, pid, [studio], caption="Wine velvet anarkali")
    private = publish(client, pid, [studio], visibility="private", caption="Only me")
    sent = client.post(f"/api/posts/{public['id']}/send", json={"usernames": ["meera", "@Kabir", "nobody_here"], "body": "Look!"})
    assert sent.status_code == 200
    assert [(r["username"], r["ok"]) for r in sent.json()] == [("meera", True), ("kabir", True), ("nobody_here", False)]

    chat_id = sent.json()[0]["conversation_id"]
    shared = client_b.get(f"/api/chats/{chat_id}/messages").json()["messages"][0]
    assert shared["kind"] == "post" and shared["body"] == "Look!" and shared["post"]["id"] == public["id"]
    assert shared["post"]["author"]["username"] == "vistas" and shared["post"]["image_id"]
    assert folder(client_b, "requests")["chats"][0]["last_message"] == "Shared a post"

    # A post the receiver may not see shows as unavailable; you cannot share a post you cannot see.
    client.post(f"/api/chats/{chat_id}/messages", json={"post_id": private["id"]})
    last = client_b.get(f"/api/chats/{chat_id}/messages").json()["messages"][-1]
    assert last["post"] is None and last["post_unavailable"]
    assert client_b.post(f"/api/posts/{private['id']}/send", json={"usernames": ["kabir"]}).status_code == 404
    client.delete(f"/api/posts/{public['id']}")
    first = client_b.get(f"/api/chats/{chat_id}/messages").json()["messages"][0]
    assert first["post_unavailable"]


def test_sending_a_design_picture(client, client_b, client_c, people, supabase):
    pid, studio, generated, reference = make_design(client)
    chat = open_chat(client, "meera")
    refused = client.post(f"/api/chats/{chat['id']}/design", json={"project_id": pid, "asset_id": reference})
    assert refused.status_code == 404  # uploaded reference photos are never sent
    sent = client.post(f"/api/chats/{chat['id']}/design", json={"project_id": pid, "asset_id": generated, "body": "New idea"})
    assert sent.status_code == 201, sent.text
    message = sent.json()
    assert message["kind"] == "design" and message["has_image"]
    copies = [k for k in supabase.files if k.startswith(f"messages/{chat['id']}/")]
    assert len(copies) == 1 and b"Wine anarkali for Meera" not in supabase.files[copies[0]][0]  # the design's name is not sent

    assert client_b.get(f"/api/messages/{message['id']}/image").status_code == 200
    assert client_c.get(f"/api/messages/{message['id']}/image").status_code == 404
    assert client_b.get(f"/api/projects/{pid}").status_code == 404  # the design itself stays private

    assert client_b.delete(f"/api/messages/{message['id']}").status_code == 404  # only the sender can unsend
    assert client.delete(f"/api/messages/{message['id']}").status_code == 204
    assert client_b.get(f"/api/chats/{chat['id']}/messages").json()["messages"] == []
    assert not [k for k in supabase.files if k.startswith("messages/")]


def test_chat_rules_in_the_database(client, client_b, client_c, db, people):
    chat = open_chat(client, "meera")
    say(client, chat["id"], "Private words")
    with db.connect(USER_C) as conn:  # kabir is not in the chat
        assert conn.execute("SELECT count(*) AS n FROM messages").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM conversations").fetchone()["n"] == 0
        assert conn.execute("SELECT count(*) AS n FROM conversation_members").fetchone()["n"] == 0
    for who, sender in ((USER_C, USER_C), (USER_C, USER_A), (USER_B, USER_A)):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with db.connect(who) as conn:  # not a member, or pretending to be someone else
                conn.execute("INSERT INTO messages (conversation_id, sender_id, body) VALUES (%s, %s, 'x')",
                             (chat["id"], sender))
    with db.connect(USER_B) as conn:  # cannot change vistas's side of the chat
        changed = conn.execute("UPDATE conversation_members SET last_read_at = now() WHERE user_id = %s RETURNING 1",
                               (USER_A,)).fetchall()
        assert changed == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_C) as conn:  # chats are only started through start_conversation()
            conn.execute("INSERT INTO conversations (user_low, user_high) VALUES (%s, %s)", (USER_A, USER_C))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # nobody can edit a message's text
            conn.execute("UPDATE messages SET body = 'changed'")
    with db.connect(USER_B) as conn:  # the receiver cannot unsend the sender's message
        assert conn.execute("DELETE FROM messages RETURNING id").fetchall() == []


def test_new_tables_are_closed_to_the_browser(db):
    with db.connect(None) as conn:
        for table in ("conversations", "conversation_members", "messages", "notifications", "notification_settings"):
            for role in ("anon", "authenticated"):
                row = conn.execute("SELECT has_table_privilege(%s, %s, 'SELECT') AS ok", (role, f"public.{table}")).fetchone()
                assert row["ok"] is False, (role, table)
        row = conn.execute("SELECT has_function_privilege('authenticated', 'public.start_conversation(uuid)', 'EXECUTE')"
                           " AS ok").fetchone()
        assert row["ok"] is False


# ---------- notifications ----------


@pytest.fixture()
def post(client, people):
    pid, studio, _, _ = make_design(client)
    return publish(client, pid, [studio], caption="Wine velvet anarkali")


def test_every_kind_of_notification(client, client_b, client_c, post):
    pid = post["id"]
    client_b.post(f"/api/posts/{pid}/like")
    client_b.post(f"/api/posts/{pid}/like")  # liking twice is still one notification
    client_b.post(f"/api/posts/{pid}/repost")
    client_b.post("/api/profiles/vistas/follow")
    comment = client_b.post(f"/api/posts/{pid}/comments", json={"body": "Lovely! @kabir look at this"}).json()
    client.post(f"/api/posts/{pid}/comments", json={"body": "Thank you @meera!", "parent_id": comment["id"]})
    chat = open_chat(client_c, "vistas")
    say(client_c, chat["id"], "Hi")
    say(client_c, chat["id"], "Hello again")  # one notification per chat

    assert kinds(client) == ["message", "comment", "follow", "repost", "like"]
    assert kinds(client_b) == ["reply"]  # vistas's reply; "@meera" in it is not counted twice
    assert kinds(client_c) == ["mention"]
    items = client.get("/api/notifications").json()["notifications"]
    assert items[1]["comment_excerpt"] == "Lovely! @kabir look at this" and items[1]["post_image_id"]
    assert items[2]["actor"]["username"] == "meera" and not items[2]["following_actor"]
    assert all(not n["read"] for n in items)
    assert client.get("/api/me/badges").json() == {"notifications": 4, "chats": 0, "requests": 1}  # kabir's chat is a request

    # Undoing a like / repost / follow takes its notification away.
    client_b.delete(f"/api/posts/{pid}/like")
    client_b.delete(f"/api/posts/{pid}/repost")
    client_b.delete("/api/profiles/vistas/follow")
    assert kinds(client) == ["message", "comment"]

    # Opening the chat reads its message notification; "mark all as read" reads the rest.
    client.post(f"/api/chats/{chat['id']}/read")
    assert [n["read"] for n in client.get("/api/notifications").json()["notifications"]] == [True, False]
    assert client.post("/api/notifications/read").status_code == 204
    assert client.get("/api/me/badges").json()["notifications"] == 0


def test_follow_requests_and_caption_mentions(client, client_b, client_c, db, people):
    client.put("/api/me/privacy", json={"is_private": True})
    client_b.post("/api/profiles/vistas/follow")
    note = client.get("/api/notifications").json()["notifications"][0]
    assert note["type"] == "follow_request" and note["request_pending"]
    client.post("/api/me/follow-requests/meera/accept")
    assert kinds(client) == []  # answered: the request notification goes, and accepting is not a "new follower"

    pid, studio, _, _ = make_design(client)
    publish(client, pid, [studio], caption="Made with @meera and @kabir.", visibility="followers")
    assert kinds(client_b) == ["mention"]
    assert kinds(client_c) == []  # kabir does not follow vistas, so he may not see the post ...
    with db.connect(None) as conn:  # ... the notification exists, Row Level Security hides it from him
        assert conn.execute("SELECT count(*) AS n FROM notifications WHERE user_id = %s", (USER_C,)).fetchone()["n"] == 1


def test_notification_settings(client, client_b, post):
    assert client.get("/api/me/notification-settings").json()["likes"] is True
    saved = client.put("/api/me/notification-settings", json={"likes": False, "messages": False}).json()
    assert saved["likes"] is False and saved["messages"] is False and saved["comments"] is True
    client_b.post(f"/api/posts/{post['id']}/like")
    client_b.post(f"/api/posts/{post['id']}/comments", json={"body": "Nice"})
    say(client_b, open_chat(client_b, "vistas")["id"], "Hi")
    assert kinds(client) == ["comment"]


def test_notifications_hide_blocked_people_and_hidden_posts(client, client_b, client_c, db, post):
    client_b.post(f"/api/posts/{post['id']}/like")
    client_c.post(f"/api/posts/{post['id']}/like")
    client.post("/api/profiles/kabir/block")
    assert [n["actor"]["username"] for n in client.get("/api/notifications").json()["notifications"]] == ["meera"]

    other = publish(client_b, make_design(client_b)[0], [], status="draft")
    client_b.patch(f"/api/posts/{other['id']}", json={"caption": "Hi @vistas"})
    assert kinds(client) == ["like"]  # a draft mentions nobody

    with db.connect(USER_B) as conn:  # notifications are only ever your own
        assert conn.execute("SELECT count(*) AS n FROM notifications").fetchone()["n"] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:  # and only the database writes them
            conn.execute("INSERT INTO notifications (user_id, actor_id, type) VALUES (%s, %s, 'follow')", (USER_A, USER_B))


# ---------- live updates ----------


def test_realtime_pings_carry_no_message_text(client, client_b, db, people):
    chat = open_chat(client, "meera")
    say(client, chat["id"], "Secret fabric price")
    client_b.post(f"/api/chats/{chat['id']}/read")
    with db.connect(None) as conn:
        rows = conn.execute("SELECT topic, event, payload, private FROM realtime.messages ORDER BY id").fetchall()
    sent = {(r["topic"], r["event"]) for r in rows}
    assert {(f"user:{USER_B}", "message"), (f"user:{USER_A}", "message"), (f"user:{USER_B}", "notification"),
            (f"user:{USER_A}", "seen")} <= sent
    assert all(r["private"] and r["payload"] == {"conversation_id": chat["id"]} for r in rows)
    assert not any("Secret" in str(r["payload"]) for r in rows)


def test_new_routes_need_sign_in(anonymous):
    for path in ("/api/chats", "/api/me/badges", "/api/notifications", "/api/me/notification-settings", "/api/me/messaging"):
        assert anonymous.get(path).status_code == 401, path
