"""Stitching Guide, part 3: picking the right modules, putting them in the order a tailor works, fabric advice,
the optional AI writer, and the generator end to end (mock mode, no AI and no internet)."""

import base64

import pytest

from app.knowledge import all_fabric_rules, all_modules
from app.providers.base import ProviderError, StepPlan, UsageMeter
from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import PHASES, PhotoHints, StitchingGuideOutput
from app.services.garment_parser import parse_garment
from app.services.stitching_guide import (
    Knowledge,
    build_guide,
    clear_knowledge_cache,
    load_knowledge,
)

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def fresh_library_cache():
    clear_knowledge_cache()
    yield
    clear_knowledge_cache()


def files_knowledge() -> Knowledge:
    return Knowledge(all_modules(), {r.fabric: r for r in all_fabric_rules()}, "built-in library")


def anarkali(**kw) -> DesignSpec:
    base = dict(title="Wine anarkali", garment_category="Anarkali", occasion="Wedding", neckline="V-neck",
                sleeve_style="Full-length sleeves", embellishments=["Zari work"], closures=["Side zip"],
                preferred_fabrics=["Georgette"], silhouette="Flared, fitted bodice")
    base.update(kw)
    return DesignSpec(**base)


def guide_for(spec: DesignSpec, writer=None, knowledge=None, photo=None) -> StitchingGuideOutput:
    return build_guide(spec, parse_garment(spec, photo), knowledge or files_knowledge(), writer, UsageMeter())


def slugs(guide: StitchingGuideOutput) -> list[str]:
    return [s.module_slug for s in guide.steps]


# ---------- picking and ordering ----------


def test_an_anarkali_in_georgette_gets_the_right_steps_in_the_right_order():
    guide = guide_for(anarkali())
    got = slugs(guide)
    for needed in ("prepare-fabric", "darts", "french-seam", "shoulder-seams", "set-in-sleeve", "bodice-to-skirt",
                   "invisible-zip", "bias-binding", "side-seams", "rolled-hem", "pressing-basics", "final-inspection"):
        assert needed in got, needed
    for not_needed in ("blind-hem", "machine-hem", "plain-seam", "lapped-zip", "cuffs", "waistband", "collar-and-stand"):
        assert not_needed not in got, not_needed
    positions = {s.module_slug: i for i, s in enumerate(guide.steps)}
    assert all(positions[d] < positions[s.module_slug] for s in guide.steps for d in s.depends_on)
    assert got[0] == "prepare-fabric" and got[-1] == "final-inspection"
    assert [s.number for s in guide.steps] == list(range(1, len(got) + 1))
    assert len(set(s.key for s in guide.steps)) == len(got)


def test_a_tailor_never_hems_before_the_side_seams_or_sews_a_zip_after_the_hem():
    got = slugs(guide_for(anarkali()))
    assert got.index("shoulder-seams") < got.index("bias-binding") < got.index("side-seams") < got.index("rolled-hem")
    assert got.index("darts") < got.index("shoulder-seams")
    assert got.index("side-seams") < got.index("set-in-sleeve")
    assert got.index("invisible-zip") < got.index("rolled-hem")
    assert got.index("stay-stitching") < got.index("shoulder-seams")
    assert got.index("interfacing") < got.index("set-in-sleeve") if "interfacing" in got else True


def test_each_step_says_why_it_is_there_in_terms_of_the_design():
    by_slug = {s.module_slug: s for s in guide_for(anarkali()).steps}
    assert "V-neck" in by_slug["bias-binding"].why
    assert "side invisible zip" in by_slug["invisible-zip"].why
    assert "Georgette" in by_slug["rolled-hem"].why
    assert by_slug["prepare-fabric"].why == "Every garment needs this step."


def test_a_different_garment_gets_different_steps():
    shirt = slugs(guide_for(DesignSpec(garment_category="Shirt", neckline="Collar", sleeve_style="Full sleeve with cuffs",
                                       closures=["Buttons"], preferred_fabrics=["Linen"])))
    assert {"collar-and-stand", "cuffs", "buttons-and-buttonholes", "flat-fell-seam", "machine-hem", "interfacing"} <= set(shirt)
    assert not {"darts", "bodice-to-skirt", "invisible-zip", "rolled-hem"} & set(shirt)
    lehenga = slugs(guide_for(DesignSpec(garment_category="Lehenga choli", neckline="Round", sleeve_style="Cap",
                                         closures=["Back hooks"], preferred_fabrics=["Silk"], silhouette="Pleated, flared")))
    assert {"pleats", "waistband", "hooks-eyes-and-ties", "blind-hem", "hang-and-level-hem", "darts"} <= set(lehenga)
    assert "bodice-to-skirt" not in lehenga


def test_a_garment_with_nothing_chosen_still_gets_a_short_honest_guide():
    guide = guide_for(DesignSpec(garment_category="Dress"))
    assert slugs(guide)[0] == "prepare-fabric" and "final-inspection" in slugs(guide)
    assert guide.fabric_card is None
    assert any("test seam" in n for n in guide.notes)


# ---------- fabric advice ----------


def test_fabric_card_and_phase_advice_come_from_the_fabric_rules():
    guide = guide_for(anarkali())
    assert guide.fabric_card is not None and guide.fabric_card.fabric == "Georgette"
    assert "French seam" in guide.fabric_card.seam_types
    rules = {r.fabric: r for r in all_fabric_rules()}["georgette"]
    assert guide.phase_tips == {phase: list(tips) for phase, tips in rules.by_phase.items()}
    for phase in ("prep", "main_seams", "hem", "pressing"):
        assert guide.phase_tips[phase], phase
    # advice for a whole phase belongs under the phase heading, never repeated on one of its steps
    everything = {tip for s in guide.steps for tip in s.fabric_tips}
    assert not everything & {tip for tips in rules.by_phase.values() for tip in tips}


def test_advice_for_a_technique_is_on_that_technique_s_step_and_nowhere_else():
    steps = {s.module_slug: s for s in guide_for(anarkali(silhouette="Flared, fitted bodice, gathered skirt")).steps}
    gathers_tip = "Gathers look good on georgette. Use two rows of stitching and let the fabric bounce back before you pin."
    assert gathers_tip in steps["gathers"].fabric_tips
    assert gathers_tip not in steps["darts"].fabric_tips  # the tip that used to land on the first shaping step
    assert any("French seam looks tidy" in t for t in steps["french-seam"].fabric_tips)
    assert not any("French seam looks tidy" in t for step in steps.values() if step.module_slug != "french-seam" for t in step.fabric_tips)
    # a module's own fabric note comes before the fabric rule's advice
    georgette_hem = steps["rolled-hem"].fabric_tips
    assert georgette_hem and "tissue" not in " ".join(georgette_hem)  # that note is for chiffon, not georgette


def test_module_specific_fabric_notes_appear_on_that_step_only_for_that_fabric():
    velvet = {s.module_slug: s for s in guide_for(anarkali(preferred_fabrics=["Velvet"], silhouette="Flared")).steps}
    assert any("needle board" in t for t in velvet["darts"].fabric_tips)
    cotton = {s.module_slug: s for s in guide_for(anarkali(preferred_fabrics=["Cotton"])).steps}
    assert not any("needle board" in t for t in cotton["darts"].fabric_tips)
    chiffon = {s.module_slug: s for s in guide_for(anarkali(preferred_fabrics=["Chiffon"])).steps}
    assert any("tissue" in t for t in chiffon["rolled-hem"].fabric_tips)


# ---------- searching the design's own words ----------


def test_words_in_the_design_notes_can_add_a_step_but_never_a_second_hem():
    dress = dict(garment_category="Dress", neckline="Round", preferred_fabrics=["Cotton"], closures=["Back zip"])
    assert "bias-binding" not in slugs(guide_for(DesignSpec(**dress)))
    with_piping = guide_for(DesignSpec(**dress, design_notes="Contrast bias tape on the pocket edges."))
    assert "bias-binding" in slugs(with_piping)
    assert next(s for s in with_piping.steps if s.module_slug == "bias-binding").why == "Your design notes mention it."
    hems = [g for g in slugs(guide_for(anarkali(design_notes="Finish with a rolled hem or a blind hem or machine hem."))) if g in ("rolled-hem", "blind-hem", "machine-hem")]
    assert len(hems) == 1


def test_search_by_meaning_adds_modules_when_the_library_has_embeddings():
    class FakeRepo:
        def match(self, vector, count, min_similarity):
            return [("princess-seams", 0.8), ("rolled-hem", 0.79), ("pleats", 0.75)]

    class FakeEmbedder:
        def embed(self, texts, purpose="document"):
            assert purpose == "query" and "waist" in texts[0]
            return [[0.1] * 768]

    knowledge = Knowledge(all_modules(), {}, "technique library (database)", FakeRepo(), FakeEmbedder(), vectors=True)
    guide = guide_for(anarkali(design_notes="Soft shaped waist with curved seams"), knowledge=knowledge)
    got = slugs(guide)
    assert "princess-seams" not in got and "pleats" in got  # semantic search cannot contradict darted shaping
    assert got.count("rolled-hem") == 1  # already chosen by the exact rules; not added twice
    assert next(s for s in guide.steps if s.module_slug == "pleats").why.startswith("Found in the library by the meaning")


def test_if_search_by_meaning_breaks_the_exact_steps_still_work():
    class Broken:
        def match(self, *a):
            raise RuntimeError("database down")

        def embed(self, *a, **k):
            raise ProviderError("quota")

    knowledge = Knowledge(all_modules(), {}, "technique library (database)", Broken(), Broken(), vectors=True)
    guide = guide_for(anarkali(design_notes="Soft shaped waist"), knowledge=knowledge)
    assert "darts" in slugs(guide) and any("Search by meaning was not available" in n for n in guide.notes)


# ---------- the optional AI writer ----------


class FakeWriter:
    info = None

    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.seen = reply, error, None

    def compose(self, garment, modules, reasons, fabric, meter):
        self.seen = ([m.slug for m in modules], reasons, fabric)
        if self.error:
            raise self.error
        return self.reply(modules)


def test_the_ai_writer_rewords_steps_but_cannot_add_drop_or_reorder_them():
    def reply(modules):
        plans = [StepPlan(m.slug, f"Why {m.slug} (AI)", [f"Do {m.slug} for georgette."], ["Tip"], ["Georgette tip"]) for m in modules]
        plans.reverse()                                       # wrong order: the builder keeps its own
        plans.append(StepPlan("invented-step", "x", ["Sew a miracle."], [], []))   # not in the library
        plans = [p for p in plans if p.module_slug != "darts"]                # forgotten: library text stays
        return plans

    writer = FakeWriter(reply)
    guide = guide_for(anarkali(), writer=writer)
    got = slugs(guide)
    assert "invented-step" not in got
    positions = {s.module_slug: i for i, s in enumerate(guide.steps)}
    assert all(positions[d] < positions[s.module_slug] for s in guide.steps for d in s.depends_on)
    by_slug = {s.module_slug: s for s in guide.steps}
    assert by_slug["set-in-sleeve"].instructions == list(next(m for m in all_modules() if m.slug == "set-in-sleeve").steps)
    assert by_slug["set-in-sleeve"].why == "Why set-in-sleeve (AI)"
    darts = next(m for m in all_modules() if m.slug == "darts")
    assert by_slug["darts"].instructions == list(darts.steps)   # the AI skipped it, so the library text is kept
    assert writer.seen[0] == got  # the writer was given exactly the retrieved modules, already in order


def test_if_the_ai_writer_fails_the_guide_is_still_built_from_the_library():
    guide = guide_for(anarkali(), writer=FakeWriter(error=ProviderError("rate limit")))
    assert "darts" in slugs(guide)
    assert any("could not word the steps" in n and "rate limit" in n for n in guide.notes)


def test_blank_ai_text_never_replaces_good_library_text():
    writer = FakeWriter(lambda modules: [StepPlan(m.slug, " ", ["  ", ""], [""], [""]) for m in modules])
    guide = guide_for(anarkali(), writer=writer)
    darts = next(m for m in all_modules() if m.slug == "darts")
    assert next(s for s in guide.steps if s.module_slug == "darts").instructions == list(darts.steps)


# ---------- the library the builder reads ----------


def test_the_builder_uses_the_files_until_the_database_library_is_seeded(db):
    from app.storage.knowledge_repository import KnowledgeRepository

    repo = KnowledgeRepository(db)
    assert load_knowledge(repo).source == "built-in library"
    repo.sync(all_modules(), all_fabric_rules())
    clear_knowledge_cache()
    knowledge = load_knowledge(repo)
    assert knowledge.source == "technique library (database)" and len(knowledge.modules) == len(all_modules())
    assert slugs(guide_for(anarkali(), knowledge=knowledge)) == slugs(guide_for(anarkali()))


# ---------- the generator through the API ----------


def generate(client, pid, options=None):
    res = client.post(f"/api/projects/{pid}/generate/stitching_guide", json={"options": options or {}})
    assert res.status_code == 200, res.text
    return res.json()


def set_spec(client, pid, **changes):
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec.update(changes)
    assert client.post(f"/api/projects/{pid}/versions", json={"spec": spec}).status_code == 201


def test_the_generator_is_listed_and_needs_a_garment(client, project):
    listed = {g["id"]: g for g in client.get("/api/generators").json()}
    assert listed["stitching_guide"]["available"] and "garment_category" in listed["stitching_guide"]["depends_on"]
    job = generate(client, project["id"])
    assert job["status"] == "failed" and "garment type" in job["error"]


def test_generating_a_guide_works_in_mock_mode_and_goes_stale_when_the_design_changes(client, project):
    pid = project["id"]
    set_spec(client, pid, **anarkali().model_dump())
    job = generate(client, pid)
    assert job["status"] == "succeeded" and job["provider"] == "built-in" and not job["is_mock"]
    out = StitchingGuideOutput.model_validate(job["output"])
    assert out.garment.family == "anarkali" and len(out.steps) >= 15
    assert out.video_connected is False and all(s.video_status == "not_connected" for s in out.steps)
    assert all(s.search_url.startswith("https://www.youtube.com/results?search_query=") for s in out.steps)
    assert not [j for j in client.get(f"/api/projects/{pid}").json()["jobs"] if j["stale"]]

    set_spec(client, pid, neckline="Boat neck")
    stale = next(j for j in client.get(f"/api/projects/{pid}").json()["jobs"] if j["generator_id"] == "stitching_guide")
    assert stale["stale"] and "neckline" in stale["stale_fields"]
    set_spec(client, pid, title="Only the title changed")
    assert "title" not in next(j for j in client.get(f"/api/projects/{pid}").json()["jobs"]
                               if j["generator_id"] == "stitching_guide")["stale_fields"]


def test_a_reference_photo_fills_in_what_the_spec_leaves_empty(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Dress", preferred_fabrics=["Cotton"], closures=["Back zip"])
    seen = {}

    class FakePhotoReader:
        class info:
            paid, estimated_cost_usd, name, is_mock = True, 0.01, "fake", False

        def read_photo(self, image, mime_type, spec, meter):
            seen.update(image=image, mime=mime_type)
            meter.add(0.01, "photo")
            return PhotoHints(neckline="Boat neck", sleeves="Cap sleeves", features=["box pleats"], notes=["Pleats start at the hip."])

    client.app.state.container.providers.photo = FakePhotoReader()
    assert client.post(f"/api/projects/{pid}/assets", files={"file": ("ref.png", PNG, "image/png")}, data={"kind": "upload"}).status_code == 201
    out = StitchingGuideOutput.model_validate(generate(client, pid)["output"])
    assert seen == {"image": PNG, "mime": "image/png"}
    assert out.garment.source == "spec+photo" and out.garment.neckline == "Boat neck" and out.garment.sleeves == "Cap sleeves"
    assert "pleats" in slugs(out) and any("ref.png" in n for n in out.garment.photo_notes)

    off = StitchingGuideOutput.model_validate(generate(client, pid, {"read_photo": False})["output"])
    assert off.garment.source == "spec" and off.garment.neckline == ""


def test_a_photo_that_cannot_be_read_never_fails_the_guide(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Dress", preferred_fabrics=["Cotton"])

    class Broken:
        class info:
            paid, estimated_cost_usd, name, is_mock = False, 0.0, "broken", False

        def read_photo(self, *a):
            raise ProviderError("quota reached")

    client.app.state.container.providers.photo = Broken()
    client.post(f"/api/projects/{pid}/assets", files={"file": ("ref.png", PNG, "image/png")}, data={"kind": "upload"})
    job = generate(client, pid)
    assert job["status"] == "succeeded"
    assert any("could not be read" in n and "quota reached" in n for n in job["output"]["notes"])


def test_paid_photo_reading_stops_at_the_daily_limit(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Dress", preferred_fabrics=["Cotton"])
    client.app.state.container.settings = client.app.state.container.settings.__class__(
        **{**client.app.state.container.settings.__dict__, "daily_budget_usd": 0.0})

    class Paid:
        class info:
            paid, estimated_cost_usd, name, is_mock = True, 0.05, "paid", False

        def read_photo(self, *a):
            raise AssertionError("must not be called over the limit")

    client.app.state.container.providers.photo = Paid()
    client.post(f"/api/projects/{pid}/assets", files={"file": ("ref.png", PNG, "image/png")}, data={"kind": "upload"})
    job = generate(client, pid)
    assert job["status"] == "succeeded" and any("Daily spending limit" in n for n in job["output"]["notes"])


# ---------- the checklist ticks ----------


def test_ticks_are_saved_per_design_version_and_only_for_the_owner(client, client_b, project):
    pid = project["id"]
    url = f"/api/projects/{pid}/stitching-progress"
    assert client.get(url, params={"version": 1}).json() == {"version_number": 1, "done_keys": []}
    for key in ("prepare-fabric", "darts"):
        assert client.put(url, json={"version_number": 1, "step_key": key, "done": True}).status_code == 200
    assert client.put(url, json={"version_number": 1, "step_key": "darts", "done": True}).json()["done_keys"] == ["prepare-fabric", "darts"]
    assert client.put(url, json={"version_number": 1, "step_key": "prepare-fabric", "done": False}).json()["done_keys"] == ["darts"]

    set_spec(client, pid, garment_category="Dress")  # version 2 starts with an empty checklist
    assert client.get(url, params={"version": 2}).json()["done_keys"] == []
    assert client.get(url, params={"version": 1}).json()["done_keys"] == ["darts"]
    assert client.put(url, json={"version_number": 9, "step_key": "darts", "done": True}).status_code == 404

    assert client_b.get(url, params={"version": 1}).status_code == 404
    assert client_b.put(url, json={"version_number": 1, "step_key": "darts", "done": False}).status_code == 404
    assert client.get(url, params={"version": 1}).json()["done_keys"] == ["darts"]


def test_ticking_is_rate_limited_per_person(client, project):
    from app.services.rate_limit import RateLimiter

    client.app.state.container.social_limiter = RateLimiter(3)
    url = f"/api/projects/{project['id']}/stitching-progress"
    codes = [client.put(url, json={"version_number": 1, "step_key": "darts", "done": i % 2 == 0}).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert client.get(url, params={"version": 1}).status_code == 200  # reading is never limited


def test_tick_keys_must_be_plain_step_ids(client, project):
    url = f"/api/projects/{project['id']}/stitching-progress"
    for bad in ("", "Darts", "darts; drop table", "../x", "a" * 81):
        assert client.put(url, json={"version_number": 1, "step_key": bad, "done": True}).status_code == 422, bad
    assert client.get(url, params={"version": 0}).status_code == 422
