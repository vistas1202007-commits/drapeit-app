"""Validate/import reviewed clips or pre-index techniques outside a web request.

Run inside backend:
  python scripts/sewing_media.py check sewing-media.example.json
  python scripts/sewing_media.py import manifest.json
  python scripts/sewing_media.py index manifest.json --allow-paid --limit 3

The check command is local. Import writes only the catalog. Index is a bounded,
resumable worker invocation; it never approves clips or downloads footage.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import BaseModel, Field
from app.knowledge import all_modules
from app.schemas.clips import CuratedClip
from app.providers.base import UsageMeter
from app.storage.knowledge_repository import content_hash


class IndexRequest(BaseModel):
    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    duration_seconds: int = Field(gt=0, le=1800)
    module_slugs: list[str] = Field(min_length=1, max_length=12)


class Manifest(BaseModel):
    clips: list[CuratedClip] = Field(default_factory=list, max_length=2000)
    index_requests: list[IndexRequest] = Field(default_factory=list, max_length=2000)


def read_manifest(path: Path) -> Manifest:
    manifest = Manifest.model_validate_json(path.read_text(encoding="utf-8"))
    modules = {m.slug: m for m in all_modules()}
    if len({c.id for c in manifest.clips}) != len(manifest.clips):
        raise ValueError("Clip ids must be unique.")
    for clip in manifest.clips:
        if clip.module_slug not in modules or clip.module_revision != content_hash(modules[clip.module_slug]):
            raise ValueError(f"Clip {clip.id} refers to an unknown or outdated technique revision.")
    for task in manifest.index_requests:
        if set(task.module_slugs) - set(modules):
            raise ValueError("An index request names an unknown technique.")
    return manifest


def run_index(requests, repo, indexer, system, daily_budget: float, limit: int = 3) -> int:
    from app.services.generation import start_of_today
    if not repo.has_topic_checks():
        raise ValueError("Apply migration 0013_verified_sewing_media.sql before indexing.")
    modules = {m.slug: m for m in all_modules()}
    count = 0
    for task in requests:
        if count >= limit:
            break
        checks = repo.topic_checks([task.video_id])
        topics = {slug: content_hash(modules[slug]) for slug in dict.fromkeys(task.module_slugs)
                  if (task.video_id, slug, content_hash(modules[slug])) not in checks}
        if not topics:
            continue
        if system.paid_spend_since(start_of_today()) + indexer.estimate_cost(task.duration_seconds) > daily_budget:
            break
        meter, started, error = UsageMeter(), time.monotonic(), None
        try:
            found = indexer.index(task.video_id, task.duration_seconds,
                                  [(slug, modules[slug].title) for slug in topics], meter)
            found = [s for s in found if s.module_slug in topics and 0 <= s.start_seconds < s.end_seconds <= task.duration_seconds]
            repo.save_topic_checks(task.video_id, indexer.info.name, topics, found)
        except Exception:
            error = "Video indexing failed; the source was not marked checked."
            raise
        finally:
            system.record_usage(None, None, "sewing_video_index", indexer.info.name, False, error is None,
                                int((time.monotonic() - started) * 1000), error,
                                estimated_cost_usd=meter.cost_usd, paid=True)
        count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["check", "import", "index", "revisions"])
    parser.add_argument("manifest", type=Path, nargs="?")
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--limit", type=int, default=3)
    args = parser.parse_args()
    if args.action == "revisions":
        print(json.dumps({m.slug: content_hash(m) for m in all_modules()}, indent=2))
        return 0
    if not args.manifest:
        parser.error("A manifest file is required.")
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be between 1 and 100.")
    manifest = read_manifest(args.manifest)
    if args.action == "check":
        print(f"Valid manifest: {len(manifest.clips)} clips, {len(manifest.index_requests)} index requests. No network calls.")
        return 0
    if args.action == "index" and not args.allow_paid:
        parser.error("Indexing can spend money; explicitly pass --allow-paid.")
    from app.config import load_settings
    from app.providers.registry import build_providers
    from app.storage.database import Database
    from app.storage.knowledge_repository import KnowledgeRepository
    from app.storage.repository import SystemRepository
    settings = load_settings()
    db = Database(settings.database_url, min_size=1, max_size=2)
    try:
        repo = KnowledgeRepository(db)
        if args.action == "import":
            repo.import_clips(manifest.clips)
            print(f"Imported {len(manifest.clips)} catalog records; approval states were preserved.")
        else:
            indexer = build_providers(settings).video_index
            if indexer is None:
                parser.error("A video-understanding provider must be configured.")
            count = run_index(manifest.index_requests, repo, indexer, SystemRepository(db), settings.daily_budget_usd, args.limit)
            print(f"Indexed {count} sources; cached technique revisions were reused. No footage downloaded.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
