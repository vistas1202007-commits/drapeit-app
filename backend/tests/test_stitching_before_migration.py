"""The app owner deploys the new code first and runs migration 0012 later. Until then the stitching guide must
still be made (from the library files, with live video search), and the checklist must say what is missing."""

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.stitching import StitchingGuideOutput
from app.storage.database import Database
from tests import pg_harness
from tests.conftest import USER_A, make_settings, make_token
from tests.test_guide_videos import ANARKALI, fake_youtube


@pytest.fixture()
def old_client(database_url, supabase):
    """A signed-in client on a database that only has migrations 0001 to 0011."""
    admin = database_url.rsplit("/", 1)[0] + "/postgres"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute("DROP DATABASE IF EXISTS croquis_pre12 WITH (FORCE)")
        conn.execute("CREATE DATABASE croquis_pre12")
    url = admin.rsplit("/", 1)[0] + "/croquis_pre12"
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(pg_harness.SHIM.read_text(encoding="utf-8"))
        for path in pg_harness.migration_files():
            if not path.name.startswith("0012"):
                conn.execute(path.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (USER_A, "a@example.com"))
    db = Database(url, max_size=3)
    http = httpx.Client(transport=httpx.MockTransport(supabase.handler))
    client = TestClient(create_app(make_settings(url), db=db, http_client=http),
                        headers={"Authorization": f"Bearer {make_token(USER_A)}"})
    yield client
    db.close()
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute("DROP DATABASE IF EXISTS croquis_pre12 WITH (FORCE)")


def test_the_guide_is_made_from_the_library_files_with_live_video_search(old_client):
    pid = old_client.post("/api/projects", json={"title": "Wine anarkali", "idea": ""}).json()["id"]
    spec = old_client.get(f"/api/projects/{pid}").json()["current_spec"]
    assert old_client.post(f"/api/projects/{pid}/versions", json={"spec": {**spec, **ANARKALI}}).status_code == 201
    provider, calls = fake_youtube()
    old_client.app.state.container.providers.tutorials = provider

    job = old_client.post(f"/api/projects/{pid}/generate/stitching_guide", json={"options": {}}).json()
    assert job["status"] == "succeeded", job["error"]
    guide = StitchingGuideOutput.model_validate(job["output"])
    assert guide.knowledge_source == "built-in library" and len(guide.steps) >= 15
    darts = next(s for s in guide.steps if s.module_slug == "darts")
    assert darts.video and darts.video.timing == "chapter" and darts.video.start_seconds == 190
    assert len(calls) >= 10  # nothing could be cached yet, so every step was searched live

    url = f"/api/projects/{pid}/stitching-progress"
    for res in (old_client.get(url, params={"version": 1}),
                old_client.put(url, json={"version_number": 1, "step_key": "darts", "done": True})):
        assert res.status_code == 503 and "0012_stitching_guide.sql" in res.json()["detail"]
