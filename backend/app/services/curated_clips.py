"""Exact compatibility filters precede clip selection. Approval is always a human catalog action."""

from __future__ import annotations

import logging

from app.schemas.stitching import GuideVideo
from app.storage.knowledge_repository import content_hash

log = logging.getLogger(__name__)


def attach_curated(guide, modules, repo, language="any") -> None:
    if repo is None:
        return
    try:
        clips = repo.curated_clips()
    except Exception:
        log.warning("Curated clips could not be loaded; tutorial search remains available", exc_info=True)
        guide.notes.append("The reviewed clip catalog could not be loaded.")
        return
    completed = set()
    garment = guide.garment
    decisions = {d.key: d.value for d in garment.decisions if not d.needs_confirmation}
    for step in guide.steps:
        candidates = [c for c in clips if
            c.review_status == "approved" and c.module_slug == step.module_slug
            and c.module_revision == content_hash(modules[step.module_slug])
            and (language == "any" or c.language in {language, "any"})
            and (not c.fabric_constructions or garment.fabric_construction in c.fabric_constructions)
            and (not c.fabric_classes or garment.fabric_class in c.fabric_classes)
            and (not c.fabric_weights or garment.fabric_weight in c.fabric_weights)
            and (not c.garment_families or garment.family in c.garment_families)
            and set(c.required_features) <= set(garment.features)
            and not set(c.excluded_features) & set(garment.features)
            and set(c.requires_completed) <= completed
            and all(decisions.get(k) == v for k, v in c.required_choices.items())]
        if candidates:
            c = sorted(candidates, key=lambda c: (c.language != language, c.id))[0]
            step.video = GuideVideo(
                source=c.source, media_url=c.media_url or None, evidence="reviewed", reviewed_by=c.reviewed_by,
                license_note=c.license_note, video_id=c.video_id, title=c.title, channel=c.channel,
                url=(f"https://www.youtube.com/watch?v={c.video_id}&t={c.start_seconds}s"
                     if c.source == "youtube" else c.source_url),
                thumbnail_url=c.thumbnail_url, start_seconds=c.start_seconds, end_seconds=c.end_seconds,
                timing="indexed", relevance=[f"Reviewed demonstration: {c.entry_state} → {c.exit_state}"],
            )
            step.more_videos = []
            step.video_status = "found"
            guide.video_source = "Reviewed clip library"
            guide.video_connected = True
        completed.add(step.module_slug)
