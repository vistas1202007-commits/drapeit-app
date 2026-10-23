"""Phase 4 tests: tutorial search (with a fake YouTube server, so no internet or quota is
used), design variations, moodboard, embroidery concepts, pattern assistance and the
instructional-video storyboard fallback."""

import base64
import re
from types import SimpleNamespace

import httpx
import pytest

from app.config import Settings
from app.providers.anthropic_provider import AnthropicClient, AnthropicIdeasProvider
from app.providers.base import ProviderError, UsageMeter, VideoResult
from app.providers.mock.ideas import MockIdeasProvider
from app.providers.registry import ProviderConfigError, build_providers
from app.providers.youtube import NoTutorialSearch, YouTubeSearchProvider, parse_duration
from app.schemas.design_spec import DesignSpec, Measurement
from app.schemas.outputs import EmbroideryOutput, MoodboardOutput, VariationsOutput
from app.services.pattern import build_pattern
from app.services.tutorials import build_topics, build_tutorial

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
DIMENSION = re.compile(r"\d+(\.\d+)?\s*(cm|in|inch|mm|m)\b", re.IGNORECASE)
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def anarkali(**kw):
    base = dict(title="Wine anarkali", garment_category="Anarkali", occasion="Wedding", neckline="V-neck",
                sleeve_style="Full-length sleeves", colour_palette=["Wine"], embellishments=["Zari work"],
                closures=["Side zip"], preferred_fabrics=["Georgette"])
    base.update(kw)
    return DesignSpec(**base)


def set_spec(client, pid, **changes):
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec.update(changes)
    assert client.post(f"/api/projects/{pid}/versions", json={"spec": spec}).status_code == 201


def generate(client, pid, generator_id, options=None):
    return client.post(f"/api/projects/{pid}/generate/{generator_id}", json={"options": options or {}}).json()


# ---------- a fake YouTube server ----------


def youtube_item(video_id, title, thumb="https://i.ytimg.com/vi/x/mqdefault.jpg", description=""):
    return {"id": {"videoId": video_id}, "snippet": {
        "title": title, "description": description, "channelTitle": "Sew &amp; Learn",
        "publishedAt": "2025-05-01T10:00:00Z", "thumbnails": {"medium": {"url": thumb}}}}


def fake_youtube(search_items, durations, status=200, error_reason=""):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "API key not valid. Please pass a valid API key.",
                                                          "errors": [{"reason": error_reason}] if error_reason else []}})
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json={"items": search_items})
        ids = request.url.params["id"].split(",")
        return httpx.Response(200, json={"items": [{"id": i, "contentDetails": {"duration": durations[i]}}
                                                   for i in ids if i in durations]})

    provider = YouTubeSearchProvider("yt-test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    return provider, calls


def test_youtube_returns_only_trustworthy_results():
    items = [
        youtube_item("AAAAAAAAAAA", "Anarkali &#39;kali&#39; cutting for beginners"),
        youtube_item("bad id!", "Broken id"),
        youtube_item("BBBBBBBBBBB", "Wrong thumbnail host", thumb="https://evil.example/x.jpg"),
        youtube_item("CCCCCCCCCCC", "Removed after search"),
    ]
    provider, calls = fake_youtube(items, {"AAAAAAAAAAA": "PT12M5S"})
    meter = UsageMeter()
    found = provider.search("anarkali cutting", 5, "hi", meter)

    assert [v.video_id for v in found] == ["AAAAAAAAAAA"]
    assert found[0].title == "Anarkali 'kali' cutting for beginners" and found[0].channel == "Sew & Learn"
    assert found[0].duration_seconds == 725 and found[0].published_at == "2025-05-01"
    params = calls[0].url.params
    assert "key" not in params and calls[0].headers["x-goog-api-key"] == "yt-test-key"  # never in the URL
    assert params["safeSearch"] == "strict" and params["relevanceLanguage"] == "hi"
    assert meter.cost_usd == 0 and "100 quota units" in meter.details[0]


@pytest.mark.parametrize(("status", "reason", "message"), [
    (403, "quotaExceeded", "quota is used up"),
    (400, "", "rejected the API key"),
    (403, "accessNotConfigured", "not turned on"),
    (500, "backendError", "YouTube search failed (500)"),
])
def test_youtube_errors_become_friendly_messages(status, reason, message):
    provider, _ = fake_youtube([], {}, status=status, error_reason=reason)
    with pytest.raises(ProviderError, match=re.escape(message)):
        provider.search("anything", 3, "any", UsageMeter())


def test_youtube_network_error():
    def handler(request):
        raise httpx.ConnectError("offline")

    provider = YouTubeSearchProvider("k", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderError, match="internet"):
        provider.search("x", 3, "any", UsageMeter())


def test_parse_duration():
    assert parse_duration("PT1H2M3S") == 3723
    assert parse_duration("PT45S") == 45
    assert parse_duration("P1DT1M") == 86460
    assert parse_duration("") is None and parse_duration("nonsense") is None


# ---------- tutorial guide ----------


class FakeSearch:
    connected = True
    info = SimpleNamespace(name="fake-search", is_mock=False, note="", paid=False)

    def __init__(self):
        self.queries = []

    def search(self, query, max_results, language, meter):
        self.queries.append((query, language))
        n = len(self.queries)
        return [
            VideoResult(f"vid{n:02d}aaaaaa"[:11], f"{query.split(' tutorial')[0]} easy for beginners", "Chan A",
                        "Uses a georgette anarkali", "2025-01-01", "https://i.ytimg.com/vi/a/mqdefault.jpg", 900),
            VideoResult("shared00000", "Unrelated vlog", "Chan B", "", "2025-01-01",
                        "https://i.ytimg.com/vi/b/mqdefault.jpg", 30),
        ]


def test_topics_follow_the_design():
    topics = build_topics(anarkali(skill_level="beginner"), "hi")
    names = [t.name for t in topics]
    assert names[0] == "Cutting and stitching the anarkali"
    assert any("Zari" in n for n in names) and any("V-neck" in n for n in names)
    assert all(t.query.endswith("in Hindi") for t in topics)
    assert "beginners" in topics[0].query
    assert len(topics) <= 5


def test_tutorial_guide_uses_only_returned_videos_and_explains_them():
    search = FakeSearch()
    out = build_tutorial(anarkali(skill_level="beginner"), search, UsageMeter(), "en")
    returned = {f"vid{n:02d}aaaaaa"[:11] for n in range(1, len(search.queries) + 1)} | {"shared00000"}
    assert out.connected and out.videos
    for v in out.videos:
        assert v.video_id in returned
        assert v.url == f"https://www.youtube.com/watch?v={v.video_id}"
        assert v.thumbnail_url.startswith("https://i.ytimg.com/")
        assert v.relevance
    # The same video found by two topics is listed once.
    assert [v.video_id for v in out.videos].count("shared00000") == 1
    best = out.videos[0]
    assert any(r.startswith("Title mentions") for r in best.relevance)
    assert "Says it is for beginners" in best.relevance and best.duration == "15:00"
    clip = next(v for v in out.videos if v.video_id == "shared00000")
    assert any("Very short" in r for r in clip.relevance)
    for step in out.steps:
        assert step.search_url.startswith("https://www.youtube.com/results?search_query=")


def test_tutorial_without_a_key_shows_no_videos(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Kurta", embellishments=["Mirror work"])
    job = generate(client, pid, "tutorial", {"language": "hi"})
    assert job["status"] == "succeeded" and job["is_mock"]
    out = job["output"]
    assert not out["connected"] and out["videos"] == [] and out["source"] == "not connected"
    assert out["steps"] and all(s["video_ids"] == [] for s in out["steps"])
    assert any("never makes up" in n for n in out["notes"])
    assert generate(client, pid, "tutorial", {"language": "fr"})["status"] == "failed"


def test_tutorial_job_with_fake_search_is_free_and_real(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali")
    client.app.state.container.providers.tutorials = FakeSearch()
    job = generate(client, pid, "tutorial")
    assert job["status"] == "succeeded" and job["output"]["connected"] and job["output"]["videos"]
    assert client.get("/api/usage").json()["paid_calls_today"] == 0


def test_library_search_endpoint(client):
    res = client.get("/api/tutorials/search", params={"q": "anarkali kali"})
    assert res.status_code == 503 and "YOUTUBE_API_KEY" in res.json()["detail"]
    client.app.state.container.providers.tutorials = FakeSearch()
    res = client.get("/api/tutorials/search", params={"q": "anarkali kali", "language": "hi"})
    assert res.status_code == 200 and res.json()[0]["url"].startswith("https://www.youtube.com/watch?v=")
    assert client.get("/api/tutorials/search", params={"q": "x"}).status_code == 422
    assert client.get("/api/tutorials/search", params={"q": "kurta", "language": "fr"}).status_code == 400


def test_tutorial_provider_selection(tmp_path):
    from tests.conftest import make_settings

    def settings(**kw):
        return make_settings(**kw)

    assert isinstance(build_providers(settings(tutorial_provider="auto", youtube_api_key="k")).tutorials,
                      YouTubeSearchProvider)
    assert isinstance(build_providers(settings(tutorial_provider="mock", youtube_api_key="k")).tutorials,
                      NoTutorialSearch)
    p = build_providers(settings(tutorial_provider="youtube"))
    assert not p.tutorials.connected and any("YOUTUBE_API_KEY" in w for w in p.warnings)
    with pytest.raises(ProviderConfigError):
        build_providers(settings(tutorial_provider="vimeo"))


# ---------- design variations ----------


def test_variations_cover_every_kind_and_change_something():
    out = MockIdeasProvider().variations(anarkali())
    assert {v.kind for v in out.variations} == {"neckline", "sleeves", "silhouette", "embellishment", "colour"}
    for v in out.variations:
        changed = [v.neckline, v.sleeve_style, v.silhouette, v.embellishments, v.colour_palette]
        assert any(changed), v.name
        assert v.neckline.lower() != "v-neck"
        assert len(v.colour_hex) == len(v.colour_palette) and all(HEX.match(h) for h in v.colour_hex)


def test_trying_a_variation_marks_outputs_out_of_date(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", neckline="V-neck")
    sketch = generate(client, pid, "sketch", {"style": "ink"})
    variations = generate(client, pid, "variations")["output"]["variations"]
    neck = next(v for v in variations if v["kind"] == "neckline")
    set_spec(client, pid, neckline=neck["neckline"])
    jobs = {j["id"]: j for j in client.get(f"/api/projects/{pid}").json()["jobs"]}
    assert jobs[sketch["id"]]["stale_fields"] == ["neckline"]


# ---------- moodboard ----------


def test_moodboard_has_valid_palette_and_uses_project_pictures(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", occasion="Wedding", colour_palette=["Wine", "Gold"])
    upload = client.post(f"/api/projects/{pid}/assets", files={"file": ("ref.png", PNG, "image/png")}).json()
    preview = generate(client, pid, "visual_preview")
    job = generate(client, pid, "moodboard")
    assert job["status"] == "succeeded"
    out = job["output"]
    assert all(HEX.match(c["hex"]) for c in out["palette"]) and out["mood_words"] and out["textures"]
    assert out["image_asset_ids"][0] == preview["output"]["asset_id"]  # previews first
    assert upload["id"] in out["image_asset_ids"]
    assert not any("http" in r for r in out["references"])


# ---------- embroidery and print ----------


def test_embroidery_concepts_respect_the_design():
    out = MockIdeasProvider().embroidery(anarkali())
    assert any(c.kind == "print" for c in out.concepts) and any("Zardozi" in c.name for c in out.concepts)
    for c in out.concepts:
        assert c.placements and c.placement_note and c.materials
        assert not re.search(r"\d", c.effort_note)  # no hours or prices
    sleeveless = MockIdeasProvider().embroidery(anarkali(sleeve_style="Sleeveless"))
    for c in sleeveless.concepts:
        assert not {"sleeves", "cuffs"} & set(c.placements)


# ---------- pattern assistance ----------


def test_pattern_is_conceptual_and_never_gives_dimensions():
    spec = anarkali(measurements=[Measurement(name="Bust", value=86, verified=True),
                                  Measurement(name="Waist", value=70)])
    out = build_pattern(spec)
    assert out.conceptual and "not a production-ready pattern" in out.disclaimer.lower()
    assert any("NOT TO SCALE" in w for w in out.warnings)
    status = {r["name"]: r["status"] for r in out.required_measurements}
    assert status["Bust / chest"] == "Measured" and status["Waist"].startswith("Estimate")
    assert "Hip" in out.missing_measurements
    texts = [s.step + " " + s.note for s in out.drafting_steps] + out.layout.steps + [p.cut for p in out.pieces]
    assert not any(DIMENSION.search(t) for t in texts)
    assert any("Kali panels" in p.name for p in out.pieces)
    assert any("Wrist (sleeve opening)" in s.uses for s in out.drafting_steps)
    assert not out.layout.nap and "selvedge to selvedge" in out.layout.fold
    assert any("tissue" in s for s in out.layout.steps)  # georgette is slippery


def test_pattern_adapts_to_sleeves_fabric_and_garment():
    out = build_pattern(anarkali(sleeve_style="Sleeveless", preferred_fabrics=["Velvet"]))
    names = [p.name for p in out.pieces]
    assert "Sleeve" not in names and "Armhole facing or bias binding" in names
    assert out.layout.nap and "pile side down" in out.layout.fold
    trousers = build_pattern(DesignSpec(garment_category="Trousers"))
    assert {"Front leg", "Back leg", "Waistband"} <= {p.name for p in trousers.pieces}
    assert all(set(s.uses) <= set(trousers.missing_measurements) for s in trousers.drafting_steps)


# ---------- instructional video ----------


def test_video_falls_back_to_storyboard(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", embellishments=["Zari work"], preferred_fabrics=["Velvet"])
    job = generate(client, pid, "video")
    assert job["status"] == "succeeded" and job["provider"] == "built-in"
    out = job["output"]
    assert out["mode"] == "storyboard" and "No video generation provider" in out["provider_note"]
    assert [s["number"] for s in out["scenes"]] == list(range(1, len(out["scenes"]) + 1))
    assert any(s["title"] == "Embellishment" for s in out["scenes"])
    assert any("nap" in s["narration"] for s in out["scenes"])  # velvet cutting advice
    assert out["tutorial_videos"] == []  # tutorial search not connected

    client.app.state.container.providers.tutorials = FakeSearch()
    generate(client, pid, "tutorial")
    with_videos = generate(client, pid, "video")["output"]
    assert with_videos["tutorial_videos"] and with_videos["tutorial_videos"][0]["url"].startswith("https://www.youtube.com/")

    rows = {s["service"]: s for s in client.get("/api/providers").json()["services"]}
    assert not rows["Video generation"]["configured"]
    assert rows["Tutorial search"]["configured"] and rows["Tutorial search"]["provider"] == "fake-search"


# ---------- Anthropic ideas provider (fake API client) ----------


def test_anthropic_ideas_provider_asks_for_the_right_shapes():
    moodboard = MoodboardOutput(title="t", story="s", mood_words=["a"], palette=[], textures=[], motifs=[],
                                references=[], image_asset_ids=["made-up-id"])
    answers = iter([VariationsOutput(base_summary="b", variations=[], notes=[]), moodboard,
                    EmbroideryOutput(concepts=[], notes=[])])
    calls = []

    def parse(**kw):
        calls.append(kw)
        return SimpleNamespace(parsed_output=next(answers), stop_reason="end_turn", model="test-opus-5-5",
                               _request_id="r", usage=SimpleNamespace(input_tokens=100, output_tokens=100))

    client = AnthropicClient(api_key="sk-ant-test", model="test-opus-5-5")
    client.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(parse=parse)))
    ideas = AnthropicIdeasProvider(client)
    assert ideas.info.paid
    ideas.variations(anarkali(), UsageMeter())
    assert ideas.moodboard(anarkali(), UsageMeter()).image_asset_ids == []  # never trust ids from the model
    ideas.embroidery(anarkali(), UsageMeter())
    assert [c["output_format"] for c in calls] == [VariationsOutput, MoodboardOutput, EmbroideryOutput]
    assert "Never give hours, prices or measurements" in calls[2]["messages"][0]["content"]


def test_phase4_answer_shapes_convert_to_valid_json_schemas():
    from anthropic.lib._parse._transform import transform_schema
    from pydantic import TypeAdapter

    for model in (VariationsOutput, MoodboardOutput, EmbroideryOutput):
        schema = transform_schema(TypeAdapter(model).json_schema())
        assert schema["type"] == "object" and schema["additionalProperties"] is False


def test_every_generator_is_available_and_package_runs(client, project):
    gens = client.get("/api/generators").json()
    assert all(g["available"] for g in gens)
    ids = ["design", "variations", "moodboard", "embroidery", "pattern", "tutorial", "video"]
    res = client.post(f"/api/projects/{project['id']}/package",
                      json={"generator_ids": ids, "options": {"design": {"idea": "a wine anarkali for a wedding"}}})
    assert {s["generator_id"]: s["status"] for s in res.json()["steps"]} == {i: "succeeded" for i in ids}


# ---------- free services are not counted as paid ----------


def test_free_real_services_are_not_paid_calls(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Kurta")
    client.app.state.container.providers.tutorials = FakeSearch()
    for gid in ("tutorial", "pattern", "video", "tailor_sheet", "cost"):
        assert generate(client, pid, gid)["status"] == "succeeded"
    usage = client.get("/api/usage").json()
    assert usage["paid_calls_today"] == 0 and usage["recent"] == []
