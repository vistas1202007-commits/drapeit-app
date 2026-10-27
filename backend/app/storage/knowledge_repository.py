"""The sewing library and the tutorial-video caches in the database (migration 0012).

These tables are used only by the backend itself, so every step here is a "system" step (no signed-in
user, see database.py). The library files in `app/knowledge/` are the source of truth: `sync` copies
them into the database, and `load_*` read them back.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from app.knowledge import FabricRule, Module
from app.providers.base import EmbeddingProvider, VideoSegment
from app.storage.database import Database


def content_hash(module: Module) -> str:
    """A fingerprint of everything in a module that is shown or searched."""
    payload = json.dumps(
        [module.slug, module.title, module.phase, module.order, list(module.triggers), module.summary,
         list(module.steps), list(module.tips), list(module.keywords), module.video_query, module.fabric_notes],
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def vector_text(vector: list[float]) -> str:
    """A list of numbers in the text form pgvector accepts."""
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


class KnowledgeRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    # ----- reading the library -----

    def has_library(self) -> bool:
        """True when migration 0012 is applied and the library has been loaded (seed script)."""
        with self.db.connect(None) as conn:
            row = conn.execute("SELECT to_regclass('public.sewing_modules') IS NOT NULL AS there").fetchone()
            if not row["there"]:
                return False
            return conn.execute("SELECT EXISTS (SELECT 1 FROM public.sewing_modules) AS loaded").fetchone()["loaded"]

    def has_vectors(self) -> bool:
        """True when search by meaning can be used: pgvector is installed and some modules have embeddings."""
        with self.db.connect(None) as conn:
            col = conn.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'"
                " AND table_name = 'sewing_modules' AND column_name = 'embedding'"
            ).fetchone()
            if col is None:
                return False
            return conn.execute("SELECT EXISTS (SELECT 1 FROM public.sewing_modules WHERE embedding IS NOT NULL) AS e").fetchone()["e"]

    def load_modules(self) -> list[Module]:
        with self.db.connect(None) as conn:
            rows = conn.execute("SELECT * FROM public.sewing_modules ORDER BY slug").fetchall()
        return [
            Module(slug=r["slug"], title=r["title"], phase=r["phase"], order=r["step_order"],
                   triggers=tuple(r["triggers"]), summary=r["summary"], steps=tuple(r["steps"]), tips=tuple(r["tips"]),
                   keywords=tuple(r["keywords"]), video_query=r["video_query"], fabric_notes=dict(r["fabric_notes"]))
            for r in rows
        ]

    def load_fabric_rules(self) -> list[FabricRule]:
        with self.db.connect(None) as conn:
            rows = conn.execute("SELECT * FROM public.sewing_fabric_rules ORDER BY fabric").fetchall()
        return [
            FabricRule(fabric=r["fabric"], title=r["title"], needle=r["needle"], thread=r["thread"],
                       stitch_length=r["stitch_length"], seam_types=tuple(r["seam_types"]), pressing=r["pressing"],
                       notes=tuple(r["notes"]), by_phase={k: tuple(v) for k, v in dict(r["by_phase"]).items()},
                       by_module={k: tuple(v) for k, v in dict(r["by_module"]).items()})
            for r in rows
        ]

    def match(self, vector: list[float], count: int = 5, min_similarity: float = 0.6) -> list[tuple[str, float]]:
        """The modules whose meaning is closest to a question's embedding: (slug, similarity), best first."""
        with self.db.connect(None) as conn:
            rows = conn.execute(
                "SELECT slug, similarity FROM public.match_sewing_modules(%s::extensions.vector, %s, %s)",
                (vector_text(vector), count, min_similarity),
            ).fetchall()
        return [(r["slug"], float(r["similarity"])) for r in rows]

    # ----- writing the library (seed script) -----

    def sync(self, modules: list[Module], rules: list[FabricRule], embedder: EmbeddingProvider | None = None) -> dict[str, int]:
        """Make the database match the files. Returns counts of what was added, changed, removed and embedded."""
        counts = {"added": 0, "updated": 0, "removed": 0, "embedded": 0, "unchanged": 0, "rules": len(rules)}
        with self.db.connect(None) as conn:
            existing = {r["slug"]: r["content_hash"] for r in conn.execute("SELECT slug, content_hash FROM public.sewing_modules")}
            for m in modules:
                h = content_hash(m)
                if m.slug not in existing:
                    counts["added"] += 1
                elif existing[m.slug] != h:
                    counts["updated"] += 1
                else:
                    counts["unchanged"] += 1
                    continue
                conn.execute(
                    "INSERT INTO public.sewing_modules (slug, title, phase, step_order, triggers, summary, steps, tips,"
                    " keywords, video_query, fabric_notes, content_hash, updated_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())"
                    " ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, phase = EXCLUDED.phase,"
                    " step_order = EXCLUDED.step_order, triggers = EXCLUDED.triggers, summary = EXCLUDED.summary,"
                    " steps = EXCLUDED.steps, tips = EXCLUDED.tips, keywords = EXCLUDED.keywords,"
                    " video_query = EXCLUDED.video_query, fabric_notes = EXCLUDED.fabric_notes,"
                    " content_hash = EXCLUDED.content_hash, updated_at = now()",
                    (m.slug, m.title, m.phase, m.order, list(m.triggers), m.summary, Jsonb(list(m.steps)),
                     Jsonb(list(m.tips)), list(m.keywords), m.video_query, Jsonb(m.fabric_notes), h),
                )
            gone = sorted(set(existing) - {m.slug for m in modules})
            for slug in gone:
                conn.execute("DELETE FROM public.sewing_modules WHERE slug = %s", (slug,))
            counts["removed"] = len(gone)
            for r in rules:
                conn.execute(
                    "INSERT INTO public.sewing_fabric_rules (fabric, title, needle, thread, stitch_length, seam_types,"
                    " pressing, notes, by_phase, by_module, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())"
                    " ON CONFLICT (fabric) DO UPDATE SET title = EXCLUDED.title, needle = EXCLUDED.needle,"
                    " thread = EXCLUDED.thread, stitch_length = EXCLUDED.stitch_length, seam_types = EXCLUDED.seam_types,"
                    " pressing = EXCLUDED.pressing, notes = EXCLUDED.notes, by_phase = EXCLUDED.by_phase,"
                    " by_module = EXCLUDED.by_module, updated_at = now()",
                    (r.fabric, r.title, r.needle, r.thread, r.stitch_length, Jsonb(list(r.seam_types)), r.pressing,
                     Jsonb(list(r.notes)), Jsonb({k: list(v) for k, v in r.by_phase.items()}),
                     Jsonb({k: list(v) for k, v in r.by_module.items()})),
                )
            conn.execute("DELETE FROM public.sewing_fabric_rules WHERE NOT (fabric = ANY(%s))", ([r.fabric for r in rules],))
        if embedder is not None:
            counts["embedded"] = self._embed_changed(modules, embedder)
        return counts

    def _embed_changed(self, modules: list[Module], embedder: EmbeddingProvider) -> int:
        with self.db.connect(None) as conn:
            if conn.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'sewing_modules'"
                            " AND column_name = 'embedding'").fetchone() is None:
                return 0
            stale = {r["slug"] for r in conn.execute(
                "SELECT slug FROM public.sewing_modules WHERE embedded_hash IS DISTINCT FROM content_hash")}
        todo = [m for m in modules if m.slug in stale]
        for start in range(0, len(todo), 20):  # a few at a time, so one request never gets too big
            batch = todo[start:start + 20]
            vectors = embedder.embed([m.text_for_search() for m in batch], "document")
            with self.db.connect(None) as conn:
                for m, v in zip(batch, vectors, strict=True):
                    conn.execute(
                        "UPDATE public.sewing_modules SET embedding = %s::extensions.vector, embedded_hash = content_hash"
                        " WHERE slug = %s", (vector_text(v), m.slug),
                    )
        return len(todo)

    # ----- tutorial search cache -----

    def get_cached_search(self, key: str, max_age: timedelta) -> list[dict[str, Any]] | None:
        with self.db.connect(None) as conn:
            row = conn.execute(
                "SELECT results FROM public.video_search_cache WHERE cache_key = %s AND fetched_at >= %s",
                (key, datetime.now(UTC) - max_age),
            ).fetchone()
        return row["results"] if row else None

    def put_cached_search(self, key: str, query: str, language: str, results: list[dict[str, Any]]) -> None:
        with self.db.connect(None) as conn:
            conn.execute(
                "INSERT INTO public.video_search_cache (cache_key, query, language, results, fetched_at)"
                " VALUES (%s, %s, %s, %s, now()) ON CONFLICT (cache_key) DO UPDATE SET results = EXCLUDED.results,"
                " fetched_at = now()", (key, query, language, Jsonb(results)),
            )

    # ----- videos an AI has already watched -----

    def indexed_segments(self, video_ids: list[str]) -> tuple[set[str], dict[tuple[str, str], VideoSegment]]:
        """Which of these videos were already watched, and the segments found in them."""
        if not video_ids:
            return set(), {}
        with self.db.connect(None) as conn:
            runs = {r["video_id"] for r in conn.execute(
                "SELECT video_id FROM public.video_index_runs WHERE video_id = ANY(%s)", (video_ids,))}
            rows = conn.execute(
                "SELECT video_id, module_slug, start_seconds, end_seconds FROM public.video_segments"
                " WHERE video_id = ANY(%s)", (video_ids,)).fetchall()
        return runs, {(r["video_id"], r["module_slug"]): VideoSegment(r["module_slug"], r["start_seconds"], r["end_seconds"])
                      for r in rows}

    def save_index(self, video_id: str, model: str, segments: list[VideoSegment]) -> None:
        with self.db.connect(None) as conn:
            conn.execute(
                "INSERT INTO public.video_index_runs (video_id, model, segments_found) VALUES (%s, %s, %s)"
                " ON CONFLICT (video_id) DO UPDATE SET model = EXCLUDED.model, segments_found = EXCLUDED.segments_found,"
                " indexed_at = now()", (video_id, model, len(segments)),
            )
            conn.execute("DELETE FROM public.video_segments WHERE video_id = %s", (video_id,))
            for s in segments:
                conn.execute(
                    "INSERT INTO public.video_segments (video_id, module_slug, start_seconds, end_seconds)"
                    " VALUES (%s, %s, %s, %s)", (video_id, s.module_slug, s.start_seconds, s.end_seconds),
                )
