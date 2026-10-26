"""The sewing library and video caches in the database (migration 0012), on a real PostgreSQL."""

import zlib
from dataclasses import replace
from datetime import timedelta

import psycopg
import pytest

from app.knowledge import all_fabric_rules, all_modules
from app.providers.base import VideoSegment
from app.storage.knowledge_repository import KnowledgeRepository, content_hash
from tests.conftest import USER_A


@pytest.fixture()
def kb(db):
    return KnowledgeRepository(db)


def pgvector_available(db) -> bool:
    with db.connect(None) as conn:
        return conn.execute("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS e").fetchone()["e"]


def test_the_library_is_empty_until_it_is_seeded_and_then_round_trips_exactly(db, kb):
    assert kb.has_library() is False
    counts = kb.sync(all_modules(), all_fabric_rules())
    assert counts["added"] == len(all_modules()) and counts["updated"] == 0 and counts["removed"] == 0
    assert kb.has_library() is True
    assert sorted(kb.load_modules(), key=lambda m: m.slug) == sorted(all_modules(), key=lambda m: m.slug)
    assert sorted(kb.load_fabric_rules(), key=lambda r: r.fabric) == sorted(all_fabric_rules(), key=lambda r: r.fabric)


def test_seeding_again_changes_only_what_changed_and_removes_what_was_removed(kb):
    modules = all_modules()
    kb.sync(modules, all_fabric_rules())
    again = kb.sync(modules, all_fabric_rules())
    assert again["unchanged"] == len(modules) and again["added"] == again["updated"] == again["removed"] == 0
    edited = [replace(modules[0], summary="A different summary.")] + modules[1:-1]
    counts = kb.sync(edited, all_fabric_rules())
    assert (counts["updated"], counts["removed"], counts["unchanged"]) == (1, 1, len(modules) - 2)
    assert {m.slug for m in kb.load_modules()} == {m.slug for m in edited}
    assert content_hash(modules[0]) != content_hash(edited[0])


def test_no_vector_search_without_embeddings(db, kb):
    kb.sync(all_modules(), all_fabric_rules())
    assert kb.has_vectors() is False


def test_vector_search_when_pgvector_is_installed(db, kb):
    if not pgvector_available(db):
        pytest.skip("pgvector is not installed in this test PostgreSQL (it is on Supabase)")

    def one_hot(text):
        return [1.0 if i == zlib.crc32(text.encode()) % 768 else 0.0 for i in range(768)]

    class Fake:
        dimensions = 768

        def embed(self, texts, purpose="document"):
            return [one_hot(t) for t in texts]

    counts = kb.sync(all_modules(), all_fabric_rules(), Fake())
    assert counts["embedded"] == len(all_modules()) and kb.has_vectors()
    darts = next(m for m in all_modules() if m.slug == "darts")
    close = [slug for slug, similarity in kb.match(one_hot(darts.text_for_search()), 5, 0.9) if similarity > 0.99]
    assert "darts" in close
    assert kb.sync(all_modules(), all_fabric_rules(), Fake())["embedded"] == 0  # nothing changed, nothing re-embedded


def test_search_cache_remembers_results_and_forgets_old_ones(kb):
    assert kb.get_cached_search("darts|any", timedelta(days=7)) is None
    kb.put_cached_search("darts|any", "darts", "any", [{"video_id": "AAAAAAAAAAA"}])
    assert kb.get_cached_search("darts|any", timedelta(days=7)) == [{"video_id": "AAAAAAAAAAA"}]
    assert kb.get_cached_search("darts|any", timedelta(seconds=-1)) is None  # older than allowed
    kb.put_cached_search("darts|any", "darts", "any", [])
    assert kb.get_cached_search("darts|any", timedelta(days=7)) == []


def test_an_ai_watched_video_is_remembered_even_when_it_showed_nothing(kb):
    kb.sync(all_modules(), all_fabric_rules())
    kb.save_index("AAAAAAAAAAA", "m", [VideoSegment("darts", 30, 90)])
    kb.save_index("BBBBBBBBBBB", "m", [])
    runs, segments = kb.indexed_segments(["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"])
    assert runs == {"AAAAAAAAAAA", "BBBBBBBBBBB"}
    assert segments == {("AAAAAAAAAAA", "darts"): VideoSegment("darts", 30, 90)}
    kb.save_index("AAAAAAAAAAA", "m", [VideoSegment("pleats", 5, 50)])  # indexing again replaces the old answer
    assert list(kb.indexed_segments(["AAAAAAAAAAA"])[1]) == [("AAAAAAAAAAA", "pleats")]


def test_signed_in_people_cannot_read_or_change_the_library_or_caches(db, kb):
    kb.sync(all_modules(), all_fabric_rules())
    for table in ("sewing_modules", "sewing_fabric_rules", "video_search_cache", "video_index_runs", "video_segments"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege), db.connect(USER_A) as conn:
            conn.execute(f"SELECT * FROM {table}")
