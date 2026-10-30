"""Construction and media contract regressions. All media/providers are explicit fixtures."""
from dataclasses import replace
from pathlib import Path
from datetime import datetime, UTC
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.knowledge import all_modules
from app.providers.base import UsageMeter, VideoResult, VideoSegment
from app.schemas.clips import CuratedClip
from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import GarmentComponents, GuideStep, GuideVideo, StitchingGuideOutput
from app.services.curated_clips import attach_curated
from app.services.garment_parser import parse_garment
from app.services.guide_videos import _apply_saved_and_new_segments
from app.services.stitching_guide import build_guide, load_knowledge, clear_knowledge_cache
from app.services.storyboard import build_storyboard
from app.storage.knowledge_repository import KnowledgeRepository, content_hash
from scripts.sewing_media import IndexRequest, run_index

MODULES = {m.slug: m for m in all_modules()}
VIDEO = "AAAAAAAAAAA"


def make_guide(slugs=("darts",)):
    return StitchingGuideOutput(
        garment=GarmentComponents(garment_type="Dress", family="dress", fabric_construction="woven"),
        steps=[GuideStep(key=s, number=i+1, phase=MODULES[s].phase, phase_label="Fixture", title=MODULES[s].title,
                         module_slug=s, module_title=MODULES[s].title, why="Fixture", instructions=list(MODULES[s].steps),
                         video_status="found", video=GuideVideo(video_id=VIDEO, title="Fixture source",
                         channel="Fixture", url=f"https://www.youtube.com/watch?v={VIDEO}", thumbnail_url=""))
               for i, s in enumerate(slugs)])


class Indexer:
    info = SimpleNamespace(name="fixture-indexer")
    def __init__(self, show=()):
        self.show, self.calls = set(show), []
    def estimate_cost(self, duration):
        return 0.02
    def index(self, video_id, duration, topics, meter):
        self.calls.append(topics)
        meter.add(0.02, "Fixture index")
        return [VideoSegment(slug, 10, 30) for slug, _ in topics if slug in self.show]


def index_guide(repo, guide, indexer, modules=None):
    found = {s.key: [VideoResult(VIDEO, "Fixture", "Fixture", "", "", "", 90)] for s in guide.steps}
    _apply_saved_and_new_segments(guide, modules or MODULES, found, repo, UsageMeter(), indexer, True, None)


def test_short_description_does_not_confirm_hidden_construction_choices():
    g = parse_garment(DesignSpec(garment_category="Dress", neckline="V-neck", preferred_fabrics=["Linen"]))
    decisions = {d.key: d for d in g.decisions}
    assert decisions["neckline_finish"].source == "proposed"
    assert decisions["closure_position"].source == "unknown"
    assert decisions["fabric_construction"].needs_confirmation


def test_confirmed_choices_win_and_are_saved_as_a_version(client, project):
    pid = project["id"]
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec.update(garment_category="Dress", neckline="V-neck", sleeve_style="Sleeveless", preferred_fabrics=["Linen"])
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec}).raise_for_status()
    first = client.post(f"/api/projects/{pid}/generate/stitching_guide", json={"options": {"videos": False}}).json()
    assert first["output"]["requires_confirmation"]
    spec["construction"] = dict(bodice="unfitted", neckline_finish="binding", closure_position="none",
                                fabric_construction="woven", fabric_weight="medium", seam_finish="plain")
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec}).raise_for_status()
    detail = client.get(f"/api/projects/{pid}").json()
    assert next(j for j in detail["jobs"] if j["id"] == first["id"])["stale"]
    result = client.post(f"/api/projects/{pid}/generate/stitching_guide", json={"options": {"videos": False}}).json()
    assert result["status"] == "succeeded" and not result["output"]["requires_confirmation"]
    assert not {"darts", "flat-fell-seam", "neckline-facing"} & {s["module_slug"] for s in result["output"]["steps"]}


def test_silk_jersey_uses_knit_rules_and_never_woven_silk_advice():
    spec = DesignSpec(garment_category="Top", preferred_fabrics=["Silk jersey"])
    garment = parse_garment(spec)
    guide = build_guide(spec, garment, load_knowledge(None), None, UsageMeter())
    assert garment.fabric_class == "knit" and garment.fabric_construction == "knit"
    assert "ballpoint" in guide.fabric_card.needle
    assert "stretch-seam" in {s.module_slug for s in guide.steps}
    assert not {"french-seam", "flat-fell-seam"} & {s.module_slug for s in guide.steps}


def test_knit_and_incompatible_confirmed_seam_are_rejected():
    spec = DesignSpec(garment_category="Top", construction={"fabric_construction": "knit", "seam_finish": "french"})
    with pytest.raises(ValueError, match="compatible stretch seam"):
        parse_garment(spec)


@pytest.mark.parametrize("family", ["Skirt", "Trousers", "Scarf", "Unknown accessory"])
def test_storyboards_do_not_add_upper_body_operations_to_lower_or_unknown_garments(family):
    out = build_storyboard(DesignSpec(garment_category=family))
    assert out.stitching_guide is not None
    slugs = {s.module_slug for s in out.stitching_guide.steps}
    assert not {"shoulder-seams", "set-in-sleeve", "neckline-facing", "bodice-to-skirt"} & slugs


def test_sleeve_methods_have_different_dependencies():
    for sleeves, before, after in [
        ("Full set-in sleeves", "side-seams", "set-in-sleeve"),
        ("Raglan sleeves", "sleeve-sewn-flat", "side-seams"),
    ]:
        spec = DesignSpec(garment_category="Shirt", sleeve_style=sleeves)
        guide = build_guide(spec, parse_garment(spec), load_knowledge(None), None, UsageMeter())
        order = [s.module_slug for s in guide.steps]
        assert order.index(before) < order.index(after)
        assert all(order.index(d) < order.index(s.module_slug) for s in guide.steps for d in s.depends_on)


def test_video_action_returns_shared_guide_without_removing_legacy_contract(client, project):
    pid = project["id"]
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["garment_category"] = "Skirt"
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    output = client.post(f"/api/projects/{pid}/generate/video", json={"options": {"videos": False}}).json()["output"]
    assert output["mode"] == "storyboard" and output["scenes"] and output["script"]
    assert output["stitching_guide"]["garment"]["family"] == "skirt"


def test_negative_evidence_removes_video_and_is_cached_per_technique(db):
    repo, indexer = KnowledgeRepository(db), Indexer()
    guide = make_guide()
    index_guide(repo, guide, indexer)
    assert guide.steps[0].video is None and guide.steps[0].video_status == "none"
    index_guide(repo, make_guide(), indexer)
    assert len(indexer.calls) == 1


def test_new_technique_on_previously_indexed_video_is_still_checked(db):
    repo, indexer = KnowledgeRepository(db), Indexer(show={"invisible-zip"})
    index_guide(repo, make_guide(), indexer)
    guide = make_guide(("invisible-zip",))
    index_guide(repo, guide, indexer)
    assert len(indexer.calls) == 2
    assert guide.steps[0].video.evidence == "indexed"
    assert repo.topic_checks([VIDEO])[(VIDEO, "darts", content_hash(MODULES["darts"]))] is None


def test_changed_module_revision_requires_new_evidence(db):
    repo, indexer = KnowledgeRepository(db), Indexer(show={"darts"})
    index_guide(repo, make_guide(), indexer)
    changed = dict(MODULES, darts=replace(MODULES["darts"], steps=(*MODULES["darts"].steps, "Check the revised method.")))
    index_guide(repo, make_guide(), indexer, changed)
    assert len(indexer.calls) == 2


def clip(**overrides):
    data = dict(id="fixture-darts", module_slug="darts", module_revision=content_hash(MODULES["darts"]),
                title="Fixture only", source="hosted", media_url="https://media.invalid/fixture.mp4",
                source_url="https://media.invalid/attribution", end_seconds=30, rights="owned",
                review_status="approved", reviewed_by="Fixture reviewer", reviewed_at=datetime.now(UTC),
                license_note="Test fixture, not a real tutorial", entry_state="Marked dart", exit_state="Sewn dart",
                fabric_constructions=["woven"])
    return CuratedClip.model_validate(data | overrides)


def test_approved_clip_requires_review_and_rights_provenance():
    with pytest.raises(ValidationError):
        clip(reviewed_by="")
    with pytest.raises(ValidationError):
        clip(license_note="")
    with pytest.raises(ValidationError):
        clip(media_url="http://media.invalid/file")
    with pytest.raises(ValidationError):
        clip(source="youtube", video_id=VIDEO)
    with pytest.raises(ValidationError):
        clip(media_url="https://www.youtube.com/example.mp4")


def test_curated_matching_checks_revision_fabric_and_method_before_playback(db):
    repo = KnowledgeRepository(db)
    repo.import_clips([clip()])
    guide = make_guide()
    attach_curated(guide, MODULES, repo)
    assert guide.steps[0].video.source == "hosted" and guide.steps[0].video.evidence == "reviewed"
    knit = make_guide()
    knit.garment.fabric_construction = "knit"
    attach_curated(knit, MODULES, repo)
    assert knit.steps[0].video.evidence != "reviewed"
    repo.import_clips([clip(module_revision="0"*64)])
    stale = make_guide()
    attach_curated(stale, MODULES, repo)
    assert stale.steps[0].video.evidence != "reviewed"


def test_worker_resumes_per_technique_and_respects_budget(db):
    repo, indexer = KnowledgeRepository(db), Indexer(show={"darts"})
    class System:
        spent = 0
        def paid_spend_since(self, since):
            return self.spent
        def record_usage(self, *a, estimated_cost_usd, **kw):
            self.spent += estimated_cost_usd
    system = System()
    tasks = [IndexRequest(video_id=VIDEO, duration_seconds=90, module_slugs=["darts"])]
    assert run_index(tasks, repo, indexer, system, 1) == 1
    assert run_index(tasks, repo, indexer, system, 1) == 0
    tasks[0].module_slugs = ["invisible-zip"]
    assert run_index(tasks, repo, indexer, system, 0) == 0
    assert len(indexer.calls) == 1


def test_legacy_saved_guide_shapes_remain_readable():
    legacy = make_guide().model_dump(exclude={"plan_version", "requires_confirmation", "media_policy"})
    for step in legacy["steps"]:
        for key in ("depends_on", "preconditions", "source_hash", "target_piece", "instruction_source"):
            step.pop(key)
    parsed = StitchingGuideOutput.model_validate(legacy)
    assert parsed.steps[0].depends_on == [] and parsed.plan_version == ""


def test_confirmed_closure_is_consistent_for_other_tools():
    spec = DesignSpec(closures=["Back zip"], construction={"closure_type": "invisible_zip", "closure_position": "side"})
    assert spec.closures == ["side Invisible zip"]
    assert parse_garment(spec).closure_position == "side"
    again = DesignSpec.model_validate(spec.model_dump())
    assert again.closures == spec.closures
    assert DesignSpec(closures=["Back zip"], construction={"closure_position": "none"}).closures == []


def test_a_zip_position_does_not_confirm_its_unstated_type():
    decisions = {d.key: d for d in parse_garment(DesignSpec(garment_category="Dress", closures=["Back zip"])).decisions}
    assert not decisions["closure_position"].needs_confirmation
    assert decisions["closure_type"].needs_confirmation


def test_no_darts_and_skirt_side_seams_are_respected():
    spec = DesignSpec(garment_category="Dress", design_notes="No darts")
    assert "darts" not in parse_garment(spec).features
    skirt = DesignSpec(garment_category="Skirt")
    guide = build_guide(skirt, parse_garment(skirt), load_knowledge(None), None, UsageMeter())
    ordered = [s.module_slug for s in guide.steps]
    assert ordered.index("side-seams") < ordered.index("waistband") < ordered.index("blind-hem")


def test_before_0013_existing_guides_and_youtube_chapters_still_work(db):
    # A pre-upgrade installation: remove only the new tables, then restore the additive migration.
    migration = Path(__file__).resolve().parents[2] / "supabase/migrations/0013_verified_sewing_media.sql"
    with db.connect(None) as conn:
        conn.execute("DROP TABLE public.video_topic_checks, public.sewing_clips")
    try:
        repo = KnowledgeRepository(db)
        assert not repo.has_topic_checks() and repo.curated_clips() == []
        guide = make_guide()
        guide.steps[0].video.timing, guide.steps[0].video.evidence = "chapter", "chapter"
        index_guide(repo, guide, Indexer())
        assert guide.steps[0].video.timing == "chapter"
        assert any("migration 0013" in n for n in guide.notes)
    finally:
        with db.connect(None) as conn:
            conn.execute(migration.read_text())


def test_new_catalog_and_checks_are_not_exposed_to_signed_in_users(db):
    import psycopg
    from tests.conftest import USER_A
    for table in ("sewing_clips", "video_topic_checks"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege), db.connect(USER_A) as conn:
            conn.execute("SELECT * FROM public." + table)
