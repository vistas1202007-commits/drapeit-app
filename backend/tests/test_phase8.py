"""Phase 8 tests: app and profile themes, the custom theme and the Premium flag. Free themes save;
Premium themes and custom themes are refused (by the API and by the database) until Premium is on;
visitors see only a profile's theme, never the owner's app theme; nobody can make themselves Premium."""

from __future__ import annotations

import psycopg
import pytest

from tests.conftest import USER_A, USER_B
from tests.test_phase6a import make_profile

CUSTOM = {"brand": "#7a1f35", "background": "#f9f5ee", "text": "#1f1a17", "texture": "linen", "font": "cormorant", "cover": "drape"}


def make_premium(db, user_id):
    with db.connect(None) as conn:
        conn.execute("INSERT INTO premium_members (user_id, source) VALUES (%s, 'manual') ON CONFLICT DO NOTHING", (user_id,))


def test_defaults_and_free_themes(client):
    me = client.get("/api/me/appearance").json()
    assert me == {"app_theme": "system", "profile_theme": "default", "custom_theme": None, "is_premium": False}
    saved = client.put("/api/me/appearance", json={"app_theme": "denim"}).json()
    assert saved["app_theme"] == "denim" and saved["profile_theme"] == "default"
    saved = client.put("/api/me/appearance", json={"profile_theme": "linen"}).json()
    assert saved["app_theme"] == "denim" and saved["profile_theme"] == "linen"
    assert client.put("/api/me/appearance", json={"app_theme": "tweed"}).status_code == 422


def test_premium_themes_need_premium(client, db):
    for body in ({"app_theme": "silk"}, {"profile_theme": "brocade"}, {"app_theme": "custom"}, {"custom_theme": CUSTOM}):
        res = client.put("/api/me/appearance", json=body)
        assert res.status_code == 403 and "Premium" in res.json()["detail"], body
    assert client.get("/api/me/appearance").json()["app_theme"] == "system"
    # The database refuses too, even if the API had a bug.
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO appearance_settings (user_id, app_theme) VALUES (%s, 'velvet')", (USER_A,))

    make_premium(db, USER_A)
    saved = client.put("/api/me/appearance", json={"app_theme": "custom", "profile_theme": "velvet", "custom_theme": CUSTOM}).json()
    assert saved["is_premium"] and saved["app_theme"] == "custom" and saved["custom_theme"]["font"] == "cormorant"


def test_bad_custom_colours_are_refused(client, db):
    make_premium(db, USER_A)
    assert client.put("/api/me/appearance", json={"custom_theme": CUSTOM | {"brand": "red"}}).status_code == 422
    assert client.put("/api/me/appearance", json={"custom_theme": CUSTOM | {"texture": "lace"}}).status_code == 422
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO appearance_settings (user_id, custom_theme) VALUES (%s, '{\"brand\": \"#zzz\"}')", (USER_A,))


def test_nobody_can_make_themselves_premium(client, db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_A) as conn:
            conn.execute("INSERT INTO premium_members (user_id) VALUES (%s)", (USER_A,))
    make_premium(db, USER_B)
    with db.connect(USER_A) as conn:  # you only see your own Premium row
        assert conn.execute("SELECT count(*) AS n FROM premium_members").fetchone()["n"] == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.connect(USER_B) as conn:
            conn.execute("UPDATE premium_members SET ends_at = now() + interval '100 years' WHERE user_id = %s", (USER_B,))
    assert client.put("/api/me/appearance", json={"is_premium": True, "app_theme": "silk"}).status_code == 403


def test_visitors_see_the_profile_theme_only(client, client_b, db):
    make_profile(client, "vistas")
    make_profile(client_b, "meera")
    assert client_b.get("/api/profiles/vistas").json()["appearance"] == {"profile_theme": "default", "custom_theme": None, "is_premium": False}

    make_premium(db, USER_A)
    client.put("/api/me/appearance", json={"app_theme": "dark", "profile_theme": "custom", "custom_theme": CUSTOM})
    seen = client_b.get("/api/profiles/vistas").json()["appearance"]
    assert seen == {"profile_theme": "custom", "custom_theme": CUSTOM, "is_premium": True}
    # The custom colours are only shared while the profile uses them.
    client.put("/api/me/appearance", json={"profile_theme": "brocade"})
    assert client_b.get("/api/profiles/vistas").json()["appearance"]["custom_theme"] is None
    # Other people's rows (with the app theme) stay private.
    with db.connect(USER_B) as conn:
        assert conn.execute("SELECT count(*) AS n FROM appearance_settings").fetchone()["n"] == 0


def test_saved_premium_theme_stays_after_premium_ends(client, db):
    make_premium(db, USER_A)
    client.put("/api/me/appearance", json={"app_theme": "silk"})
    with db.connect(None) as conn:
        conn.execute("DELETE FROM premium_members WHERE user_id = %s", (USER_A,))
    me = client.get("/api/me/appearance").json()
    assert me["app_theme"] == "silk" and me["is_premium"] is False  # the app shows a free theme instead
    assert client.put("/api/me/appearance", json={"profile_theme": "linen"}).status_code == 200
    assert client.put("/api/me/appearance", json={"app_theme": "velvet"}).status_code == 403
    assert client.put("/api/me/appearance", json={"app_theme": "cotton"}).json()["app_theme"] == "cotton"


def test_export_includes_appearance(client):
    client.put("/api/me/appearance", json={"app_theme": "linen"})
    data = client.get("/api/me/export").json()
    assert data["appearance"]["app_theme"] == "linen"
