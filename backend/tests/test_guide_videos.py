"""Stitching Guide, part 4: a real video for each step, started at the right moment.

YouTube and Gemini are replaced by fakes, so no internet, quota or money is used."""

import httpx
import pytest

from app.knowledge import all_modules
from app.providers.base import ProviderError, UsageMeter, VideoResult, VideoSegment
from app.providers.youtube import YouTubeSearchProvider
from app.schemas.stitching import StitchingGuideOutput
from app.services.guide_videos import Chapter, match_chapter, parse_chapters
from app.services.stitching_guide import clear_knowledge_cache

MODULES = {m.slug: m for m in all_modules()}

DARTS_DESCRIPTION = """Learn to sew darts like a pro.
0:00 Intro
1:05 Marking the darts
3:10 Sewing bust darts
6:40 Pressing
9:00 Outro"""


@pytest.fixture(autouse=True)
def fresh_library_cache():
    clear_knowledge_cache()
    yield


# ---------- chapters ----------


def test_chapters_are_read_the_way_youtube_reads_them():
    assert parse_chapters(DARTS_DESCRIPTION) == [
        Chapter(0, "Intro"), Chapter(65, "Marking the darts"), Chapter(190, "Sewing bust darts"),
        Chapter(400, "Pressing"), Chapter(540, "Outro"),
    ]
    assert parse_chapters("(00:00) Start\n[02:30] - Cutting\n1:02:03 | Hemming the skirt") == [
        Chapter(0, "Start"), Chapter(150, "Cutting"), Chapter(3723, "Hemming the skirt")]
    assert parse_chapters("Intro - 0:00\nZip - 4:10\nHem - 7:00") == [Chapter(0, "Intro"), Chapter(250, "Zip"), Chapter(420, "Hem")]


def test_descriptions_without_real_chapters_give_none():
    assert parse_chapters("1:00 Darts\n2:00 Zip\n3:00 Hem") == []          # must start at 0:00
    assert parse_chapters("0:00 Intro\n2:00 Darts") == []                   # fewer than three
    assert parse_chapters("Great video! Watch from the start.") == []
    assert parse_chapters("0:00 Intro\n5:00 Darts\n3:00 Back again\n7:00 Hem") == [
        Chapter(0, "Intro"), Chapter(300, "Darts"), Chapter(420, "Hem")]   # an out-of-order line is skipped


def video(video_id="AAAAAAAAAAA", title="How to sew bust darts", description="", duration=600) -> VideoResult:
    return VideoResult(video_id=video_id, title=title, channel="Sew School", description=description[:100],
                       published_at="2025-01-01", thumbnail_url="https://i.ytimg.com/vi/x/mqdefault.jpg",
                       duration_seconds=duration, full_description=description)


def test_the_chapter_that_names_the_technique_is_chosen_with_its_end():
    chapter, end = match_chapter(video(description=DARTS_DESCRIPTION), MODULES["darts"])
    assert (chapter.start, chapter.title, end) == (190, "Sewing bust darts", 400)
    last = match_chapter(video(description="0:00 Intro\n2:00 Cutting\n8:20 Pressing seams"), MODULES["pressing-basics"])
    assert last[0].start == 500 and last[1] == 600  # the last chapter runs to the end of the video


def test_a_chapter_that_only_shares_a_loose_word_does_not_count():
    desc = "0:00 Intro\n1:00 Attach sleeve\n4:00 Hem"
    assert match_chapter(video(description=desc), MODULES["ease-sleeve-cap"]) is None
    assert match_chapter(video(description="no chapters here"), MODULES["darts"]) is None


# ---------- through the generator, with a fake YouTube ----------


def item(video_id, title, description=""):
    return {"id": {"videoId": video_id}, "snippet": {"title": title, "description": description[:80],
            "channelTitle": "Sew &amp; Learn", "publishedAt": "2025-05-01T10:00:00Z",
            "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/x/mqdefault.jpg"}}}}


VIDEOS = {
    "DDDDDDDDDDD": ("How to sew bust darts perfectly", DARTS_DESCRIPTION, "PT9M30S"),
    "ZZZZZZZZZZZ": ("Invisible zipper the easy way", "No chapters, just sewing.", "PT12M"),
    "RRRRRRRRRRR": ("Rolled hem on chiffon by machine", "", "PT8M"),
    "VVVVVVVVVVV": ("My weekend vlog", "", "PT20M"),
}


def fake_youtube(fail=None):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(403, json={"error": {"errors": [{"reason": fail}]}})
        if request.url.path.endswith("/search"):
            q = request.url.params["q"]
            calls.append(q)
            ids = (["DDDDDDDDDDD"] if "darts" in q else ["ZZZZZZZZZZZ"] if "zipper" in q
                   else ["RRRRRRRRRRR"] if "rolled hem" in q else ["VVVVVVVVVVV"])
            return httpx.Response(200, json={"items": [item(i, VIDEOS[i][0], VIDEOS[i][1]) for i in ids]})
        ids = request.url.params["id"].split(",")
        return httpx.Response(200, json={"items": [
            {"id": i, "contentDetails": {"duration": VIDEOS[i][2]}, "snippet": {"description": VIDEOS[i][1]}} for i in ids]})

    return YouTubeSearchProvider("yt-test-key", client=httpx.Client(transport=httpx.MockTransport(handler))), calls


ANARKALI = dict(title="Wine anarkali", garment_category="Anarkali", neckline="V-neck", sleeve_style="Full-length sleeves",
                closures=["Side zip"], preferred_fabrics=["Georgette"], silhouette="Flared, fitted bodice")


@pytest.fixture()
def anarkali_project(client, project):
    spec = client.get(f"/api/projects/{project['id']}").json()["current_spec"]
    spec.update(ANARKALI)
    assert client.post(f"/api/projects/{project['id']}/versions", json={"spec": spec}).status_code == 201
    return project["id"]


def generate(client, pid, **options) -> StitchingGuideOutput:
    res = client.post(f"/api/projects/{pid}/generate/stitching_guide", json={"options": options})
    assert res.status_code == 200 and res.json()["status"] == "succeeded", res.text
    return StitchingGuideOutput.model_validate(res.json()["output"])


def steps_by_slug(guide):
    return {s.module_slug: s for s in guide.steps}


def test_each_step_gets_a_real_matching_video_started_at_its_chapter(client, anarkali_project):
    provider, _ = fake_youtube()
    client.app.state.container.providers.tutorials = provider
    guide = generate(client, anarkali_project)
    assert guide.video_connected and guide.video_source == "YouTube Data API"
    steps = steps_by_slug(guide)

    darts = steps["darts"]
    assert darts.video_status == "found" and darts.video.video_id == "DDDDDDDDDDD"
    assert (darts.video.start_seconds, darts.video.end_seconds, darts.video.timing) == (190, 400, "chapter")
    assert darts.video.chapter_title == "Sewing bust darts" and darts.video.channel == "Sew & Learn"
    assert darts.video.url.endswith("watch?v=DDDDDDDDDDD&t=190s")

    zip_step = steps["invisible-zip"]
    assert zip_step.video.video_id == "ZZZZZZZZZZZ" and zip_step.video.timing == "whole_video" and zip_step.video.start_seconds == 0
    assert steps["rolled-hem"].video.video_id == "RRRRRRRRRRR"
    # a search that only found an unrelated video says "no video", never shows the wrong one
    assert steps["side-seams"].video_status == "none" and steps["side-seams"].video is None
    assert all(v.video_id in VIDEOS for s in guide.steps for v in ([s.video] if s.video else []) + s.more_videos)


def test_searches_are_cached_for_everyone_and_per_language(client, client_b, anarkali_project):
    provider, calls = fake_youtube()
    client.app.state.container.providers.tutorials = provider
    generate(client, anarkali_project)
    first = len(calls)
    assert first >= 10 and len(set(calls)) == first  # one search per distinct step
    generate(client, anarkali_project)
    assert len(calls) == first  # the second guide is served from the cache

    other = client_b.post("/api/projects", json={"title": "B's anarkali"}).json()["id"]
    spec = client_b.get(f"/api/projects/{other}").json()["current_spec"]
    spec.update(ANARKALI)
    client_b.post(f"/api/projects/{other}/versions", json={"spec": spec})
    generate(client_b, other)
    assert len(calls) == first  # another person's guide reuses the same searches

    generate(client, anarkali_project, language="hi")
    assert len(calls) == 2 * first and all(q.endswith(" in Hindi") for q in calls[first:])


def test_a_youtube_error_stops_searching_but_the_guide_is_still_made(client, anarkali_project):
    provider, _ = fake_youtube(fail="quotaExceeded")
    client.app.state.container.providers.tutorials = provider
    guide = generate(client, anarkali_project)
    assert all(s.video_status == "none" for s in guide.steps)
    assert any("quota" in n for n in guide.notes)
    assert all(s.search_url for s in guide.steps)


def test_without_a_youtube_key_no_videos_are_invented(client, anarkali_project):
    guide = generate(client, anarkali_project)
    assert not guide.video_connected and all(s.video is None and s.video_status == "not_connected" for s in guide.steps)
    assert any("never makes them up" in n for n in guide.notes)


def test_videos_can_be_left_out_and_bad_languages_are_refused(client, anarkali_project):
    provider, calls = fake_youtube()
    client.app.state.container.providers.tutorials = provider
    guide = generate(client, anarkali_project, videos=False)
    assert calls == [] and all(s.video is None for s in guide.steps)
    res = client.post(f"/api/projects/{anarkali_project}/generate/stitching_guide", json={"options": {"language": "fr"}})
    assert res.json()["status"] == "failed" and "language" in res.json()["error"]


# ---------- optional: an AI watches a video once to find the start ----------


class FakeIndexer:
    class info:
        name, paid, is_mock, estimated_cost_usd = "gemini (test)", True, False, 0.05

    def __init__(self):
        self.calls = []

    @staticmethod
    def estimate_cost(duration_seconds):
        return 0.01

    def index(self, video_id, duration_seconds, topics, meter):
        self.calls.append((video_id, duration_seconds, topics))
        meter.add(0.01, "fake index")
        if video_id == "ZZZZZZZZZZZ":
            return [VideoSegment("invisible-zip", 95, 380)]
        return []


def test_an_ai_watches_each_video_once_and_the_start_is_saved_for_everyone(client, anarkali_project):
    provider, _ = fake_youtube()
    container = client.app.state.container
    container.providers.tutorials = provider
    container.providers.video_index = indexer = FakeIndexer()

    guide = generate(client, anarkali_project, index_videos=True)
    zip_video = steps_by_slug(guide)["invisible-zip"].video
    assert (zip_video.start_seconds, zip_video.end_seconds, zip_video.timing) == (95, 380, "indexed")
    assert zip_video.url.endswith("&t=95s")
    watched = [c[0] for c in indexer.calls]
    assert "ZZZZZZZZZZZ" in watched and "DDDDDDDDDDD" not in watched  # the darts video already had a chapter
    assert ("invisible-zip", "Insert an invisible zip") in next(c[2] for c in indexer.calls if c[0] == "ZZZZZZZZZZZ")

    before = len(indexer.calls)
    again = generate(client, anarkali_project, index_videos=True)
    assert len(indexer.calls) == before  # every video is watched only once, even those that showed nothing
    assert steps_by_slug(again)["invisible-zip"].video.timing == "indexed"
    container.providers.video_index = None
    assert steps_by_slug(generate(client, anarkali_project))["invisible-zip"].video.start_seconds == 95  # saved, free


def test_watching_videos_is_off_unless_asked_and_stops_at_the_daily_limit(client, anarkali_project):
    provider, _ = fake_youtube()
    container = client.app.state.container
    container.providers.tutorials = provider
    container.providers.video_index = indexer = FakeIndexer()
    generate(client, anarkali_project)
    assert indexer.calls == []

    container.settings = container.settings.__class__(**{**container.settings.__dict__, "daily_budget_usd": 0.0})
    guide = generate(client, anarkali_project, index_videos=True)
    assert indexer.calls == [] and any("Daily spending limit" in n for n in guide.notes)


def test_an_indexer_error_is_reported_and_nothing_is_saved(client, anarkali_project):
    provider, _ = fake_youtube()
    container = client.app.state.container
    container.providers.tutorials = provider

    class Broken(FakeIndexer):
        def index(self, *a):
            raise ProviderError("video not available")

    container.providers.video_index = Broken()
    guide = generate(client, anarkali_project, index_videos=True)
    assert any("could not be watched" in n for n in guide.notes)
    assert steps_by_slug(guide)["invisible-zip"].video.timing == "whole_video"


def test_the_youtube_provider_now_returns_the_full_description():
    provider, _ = fake_youtube()
    (darts,) = provider.search("bust darts", 5, "any", UsageMeter())
    assert darts.full_description == DARTS_DESCRIPTION and len(darts.description) <= 80
