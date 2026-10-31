"""Regenerate offline browser fixtures from actual schemas; no providers, credentials or database."""
from __future__ import annotations
import copy
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.schemas.design_spec import DesignSpec
from app.services.storyboard import build_storyboard

spec = DesignSpec(title="Fixture skirt", garment_category="Skirt", preferred_fabrics=["Linen"])
video = build_storyboard(spec).model_dump(mode="json")
guide = video["stitching_guide"]
legacy = {k: v for k, v in video.items() if k != "stitching_guide"}
old = copy.deepcopy(guide)
for key in ("requires_confirmation", "plan_version", "media_policy"):
    old.pop(key, None)
old["garment"].pop("decisions", None)
media = copy.deepcopy(old)
media["steps"] = media["steps"][:2]
for i, step in enumerate(media["steps"]):
    step["video_status"] = "found"
    step["video"] = {
        "video_id": "AAAAAAAAAAA" if i == 0 else "", "title": "Fixture playback only", "channel": "Fixture",
        "url": "https://media.invalid/attribution", "thumbnail_url": "", "duration": "",
        "start_seconds": 10, "end_seconds": 30, "timing": "whole_video" if i == 0 else "indexed",
        "source": "youtube" if i == 0 else "hosted", "evidence": "candidate" if i == 0 else "reviewed",
        "media_url": None if i == 0 else "https://media.invalid/fixture.webm",
        "reviewed_by": "" if i == 0 else "Fixture reviewer", "license_note": "Test fixture, not a real tutorial",
        "chapter_title": "", "relevance": [],
    }
out = Path(__file__).resolve().parents[2] / "frontend/e2e/offline/fixtures.json"
out.write_text(json.dumps({"spec": spec.model_dump(mode="json"), "video": video, "legacy": legacy,
                           "oldguide": old, "mediaguide": media}, indent=2) + "\n", encoding="utf-8")
print("Wrote offline fixtures; no live media or provider evidence.")
