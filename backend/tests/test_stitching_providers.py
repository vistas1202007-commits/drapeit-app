"""Stitching Guide: the optional readers behind the guide (reference photo, embeddings, video index).

No internet and no keys are used: the Anthropic and Gemini libraries are replaced by small fakes."""

from types import SimpleNamespace

import pytest

from app.config import Settings
from app.providers import gemini_tools
from app.providers.anthropic_provider import AnthropicClient, AnthropicPhotoProvider
from app.providers.base import ProviderError, UsageMeter
from app.providers.photo import PhotoAnswer
from app.providers.registry import build_providers
from app.schemas.design_spec import DesignSpec


def settings(**kw) -> Settings:
    return Settings(database_url="postgresql://x", supabase_url="https://x.supabase.co", supabase_secret_key="k",
                    media_token_secret="m" * 40, language_provider="mock", image_provider="mock",
                    tutorial_provider="mock", **kw)


def test_no_keys_means_no_extras_and_the_app_still_builds():
    p = build_providers(settings())
    assert p.photo is None and p.embedder is None and p.video_index is None


def test_a_gemini_key_turns_on_photo_reading_embeddings_and_video_indexing():
    p = build_providers(settings(gemini_api_key="g-test-key", gemini_text_model="gemini-flash-latest"))
    assert p.photo is not None and p.embedder is not None and p.video_index is not None
    assert p.embedder.dimensions == 768
    assert p.photo.info.paid and not p.embedder.info.paid


def test_the_anthropic_reader_sends_the_picture_and_returns_hints():
    seen = {}

    class FakeMessages:
        def parse(self, **kw):
            seen.update(kw)
            answer = PhotoAnswer(garment_type="Lehenga", bodice="Fitted", neckline="Round", sleeves="Cap",
                                 skirt="Flared, pleated", closure_position="back", length="Floor",
                                 features=["pleats"], notes=[])
            usage = SimpleNamespace(input_tokens=1500, output_tokens=200)
            return SimpleNamespace(usage=usage, model="m", _request_id="r", stop_reason="end_turn", parsed_output=answer)

    client = AnthropicClient("sk-test", "x-sonnet-5-5")
    client.client = SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages()))
    meter = UsageMeter()
    hints = AnthropicPhotoProvider(client).read_photo(b"\x89PNG\r\n\x1a\nxx", "image/png", DesignSpec(), meter)
    assert hints.neckline == "Round" and hints.features == ["pleats"]
    blocks = seen["messages"][0]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[1]["type"] == "text"
    assert meter.cost_usd > 0


def test_embeddings_have_unit_length():
    class FakeModels:
        def embed_content(self, model, contents, config):
            vec = [3.0, 4.0] + [0.0] * 766
            return SimpleNamespace(embeddings=[SimpleNamespace(values=vec) for _ in contents])

    embedder = gemini_tools.GeminiEmbedder.__new__(gemini_tools.GeminiEmbedder)
    embedder.client, embedder.model = SimpleNamespace(models=FakeModels()), "m"
    (vector,) = embedder.embed(["darts"], "query")
    assert len(vector) == 768 and vector[:2] == pytest.approx([0.6, 0.8])


def test_embeddings_of_the_wrong_size_are_refused():
    class FakeModels:
        def embed_content(self, model, contents, config):
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 2.0])])

    embedder = gemini_tools.GeminiEmbedder.__new__(gemini_tools.GeminiEmbedder)
    embedder.client, embedder.model = SimpleNamespace(models=FakeModels()), "m"
    with pytest.raises(ProviderError):
        embedder.embed(["darts"])


def seg(technique, start, end, shown=True):
    return SimpleNamespace(technique=technique, shown=shown, start_seconds=start, end_seconds=end)


def test_video_times_from_a_model_are_checked_before_they_are_kept():
    answers = [
        seg("darts", 60, 140),
        seg("hem-rolled", 0, 0, shown=False),   # not shown in the video
        seg("pleats", 700, 800),                # starts after the video ends
        seg("gathers", 90, 80),                 # ends before it starts
        seg("zip", 10, 20),                     # not a technique we asked about
        seg("facings", 590, 900),               # runs past the end: trimmed
        seg("darts", 200, 260),                 # a second answer for the same technique is ignored
    ]
    kept = gemini_tools.checked_segments(answers, {"darts", "hem-rolled", "pleats", "gathers", "facings"}, 600)
    assert [(s.module_slug, s.start_seconds, s.end_seconds) for s in kept] == [("darts", 60, 140), ("facings", 590, 600)]


def test_video_indexing_cost_estimate_grows_with_length():
    short, long_ = gemini_tools.GeminiVideoIndexer.estimate_cost(300), gemini_tools.GeminiVideoIndexer.estimate_cost(1800)
    assert 0 < short < long_ < 0.5
