"""Phase 2 tests: design plans, real-provider wiring (with fake API clients, so
no money is spent and no internet is needed), saved generated images, the
daily spending limit and the database upgrade."""

import base64
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.providers.anthropic_provider import (
    AnthropicClient,
    AnthropicIdeaProvider,
    DesignAnswer,
    SpecFields,
)
from app.providers.base import GeneratedImage, ImageRequest, ProviderError, ProviderInfo, UsageMeter
from app.providers.image_providers import GeminiImageProvider, OpenAIImageProvider
from app.providers.registry import ProviderConfigError, build_providers
from app.schemas.design_spec import DesignSpec, Measurement
from app.schemas.outputs import DesignPlan, FabricOutput, MaterialsOutput
from tests.conftest import make_settings, repo_for

# The smallest valid PNG file (1x1 pixel).
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def settings(tmp_path, **kw):
    return make_settings(**kw)


# ---------- design planning ----------


def test_mock_design_has_plan_and_visual_description(client, project):
    pid = project["id"]
    job = client.post(
        f"/api/projects/{pid}/generate/design",
        json={"options": {"idea": "wine anarkali with zari embroidery, v-neck, full sleeves"}},
    ).json()
    assert job["status"] == "succeeded"
    plan = job["output"]["plan"]
    assert plan["concept_statement"].startswith("MOCK PLAN")
    assert plan["colour_story"][0]["hex"].startswith("#")
    assert plan["difficulty"] == "advanced"
    assert "anarkali" in job["output"]["proposed_spec"]["visual_description"].lower()


# ---------- provider selection ----------


def test_auto_without_keys_uses_mocks(tmp_path):
    p = build_providers(settings(tmp_path, language_provider="auto", image_provider="auto"))
    assert p.idea.info.is_mock and p.image.info.is_mock and not p.warnings


def test_auto_with_keys_uses_real_providers(tmp_path):
    p = build_providers(settings(
        tmp_path, language_provider="auto", image_provider="auto",
        anthropic_api_key="sk-ant-test", anthropic_model="test-opus-5-5",
        gemini_api_key="g-test", openai_api_key="o-test",
    ))
    assert p.idea.info.name == "anthropic (test-opus-5-5)" and p.idea.info.paid
    assert p.fabric.info.paid and p.materials.info.paid
    assert not p.builtin_materials.info.paid  # tailor sheet stays free
    assert p.image.info.name.startswith("gemini")  # Gemini wins when both image keys are set


def test_key_without_model_name_keeps_the_mock_with_warning(tmp_path):
    p = build_providers(settings(tmp_path, language_provider="auto", anthropic_api_key="sk-ant-test"))
    assert p.idea.info.is_mock and p.fabric.info.is_mock
    assert any("ANTHROPIC_MODEL" in w for w in p.warnings)


def test_openai_chosen_when_only_openai_key(tmp_path):
    p = build_providers(settings(tmp_path, image_provider="auto", openai_api_key="o-test"))
    assert p.image.info.name.startswith("openai")


def test_explicit_provider_without_key_falls_back_with_warning(tmp_path):
    p = build_providers(settings(tmp_path, language_provider="anthropic", image_provider="gemini"))
    assert p.idea.info.is_mock and p.image.info.is_mock
    assert len(p.warnings) == 2


def test_invalid_provider_name_is_rejected(tmp_path):
    with pytest.raises(ProviderConfigError):
        build_providers(settings(tmp_path, image_provider="midjourney"))


def test_providers_endpoint_never_returns_keys(client):
    body = client.get("/api/providers").json()
    assert body["keys"] == {"ANTHROPIC_API_KEY": False, "GEMINI_API_KEY": False, "OPENAI_API_KEY": False,
                           "YOUTUBE_API_KEY": False}
    assert any(s["service"].startswith("Image generation") for s in body["services"])


# ---------- Anthropic provider (fake API client) ----------


class FakeMessages:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def fake_client(response, model="test-opus-5-5"):
    client = AnthropicClient(api_key="sk-ant-test", model=model)
    fake = FakeMessages(response)
    client.client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    return client, fake


def api_response(parsed, stop_reason="end_turn"):
    return SimpleNamespace(
        parsed_output=parsed, stop_reason=stop_reason, model="test-opus-5-5", _request_id="req_test",
        usage=SimpleNamespace(input_tokens=2000, output_tokens=3000),
    )


def design_answer(**spec_overrides):
    fields = dict(
        title="Wine zari anarkali", garment_category="Anarkali", occasion="Winter wedding",
        silhouette="Fitted bodice, 16-kali flare", fit="Fitted", neckline="V-neck",
        sleeve_style="Full sleeves", garment_length="Floor length", fabric_requirements="Medium weight, good drape",
        preferred_fabrics=["Velvet"], colour_palette=["Wine", "Antique gold"], embellishments=["Zari work"],
        closures=["Side zip"], climate="Cold", skill_level="advanced", design_notes="Keep the back plain.",
        visual_description="A floor-length wine velvet anarkali with gold zari on the yoke.",
    )
    fields.update(spec_overrides)
    return DesignAnswer(
        summary="A wine velvet anarkali for a winter wedding.",
        spec=SpecFields(**fields),
        detected=["Garment: Anarkali"],
        unresolved_questions=["Bust, waist and length measurements?"],
        assumptions=["16 kalis assumed for the flare."],
        plan=DesignPlan(concept_statement="Rich and warm.", difficulty="advanced"),
    )


def test_anthropic_design_maps_answer_into_spec_and_keeps_user_data():
    client, fake = fake_client(api_response(design_answer(title="T" * 500)))
    current = DesignSpec(measurements=[Measurement(name="Bust", value=86, verified=True)])
    meter = UsageMeter()
    out = AnthropicIdeaProvider(client).analyse_idea("wine anarkali", current, meter)

    spec = out.proposed_spec
    assert spec.garment_category == "Anarkali" and spec.idea == "wine anarkali"
    assert len(spec.title) == 120  # cut to the spec's limit instead of crashing
    assert spec.measurements[0].name == "Bust"  # the user's measurements are kept
    assert spec.assumptions == ["16 kalis assumed for the flare."]
    assert out.plan and out.plan.difficulty == "advanced"
    # 2000 input tokens at $4/M + 3000 output tokens at $20/M
    assert meter.cost_usd == pytest.approx(0.068)

    call = fake.calls[0]
    assert call["model"] == "test-opus-5-5"
    assert call["output_format"] is DesignAnswer
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]


def test_anthropic_fallbacks_only_on_models_that_support_them():
    client, fake = fake_client(api_response(design_answer()), model="test-haiku-5-5")
    AnthropicIdeaProvider(client).analyse_idea("idea", DesignSpec(), UsageMeter())
    assert "fallbacks" not in fake.calls[0]


@pytest.mark.parametrize(("stop_reason", "parsed", "message"), [
    ("refusal", None, "declined"),
    ("max_tokens", None, "cut off"),
    ("end_turn", None, "expected format"),
])
def test_anthropic_bad_answers_become_friendly_errors(stop_reason, parsed, message):
    client, _ = fake_client(api_response(parsed, stop_reason))
    meter = UsageMeter()
    with pytest.raises(ProviderError, match=message):
        AnthropicIdeaProvider(client).analyse_idea("idea", DesignSpec(), meter)
    assert meter.cost_usd > 0  # a failed call can still cost money, so it is recorded


def test_answer_shapes_convert_to_valid_json_schemas():
    from anthropic.lib._parse._transform import transform_schema
    from pydantic import TypeAdapter

    for model in (DesignAnswer, FabricOutput, MaterialsOutput):
        schema = transform_schema(TypeAdapter(model).json_schema())
        assert schema["type"] == "object" and schema["additionalProperties"] is False


# ---------- image providers (fake API clients) ----------


def image_request():
    return ImageRequest(prompt="a wine anarkali", spec=DesignSpec(garment_category="Anarkali"), purpose="sketch",
                        style="ink")


def test_openai_image_provider_decodes_png():
    provider = OpenAIImageProvider("o-test", "gpt-image-2", "medium")
    calls = []

    def generate(**kw):
        calls.append(kw)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(PNG).decode())])

    provider.client = SimpleNamespace(images=SimpleNamespace(generate=generate))
    meter = UsageMeter()
    image = provider.generate_image(image_request(), meter)
    assert image.data == PNG and image.mime_type == "image/png"
    assert calls[0]["size"] == "1024x1536" and calls[0]["quality"] == "medium"
    assert meter.cost_usd == pytest.approx(0.08)


def test_gemini_image_provider_reads_inline_image():
    provider = GeminiImageProvider("g-test", "gemini-nano-banana-2.1")
    part = SimpleNamespace(inline_data=SimpleNamespace(data=PNG))
    response = SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=None), part]))],
        prompt_feedback=None,
    )
    provider.client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kw: response))
    image = provider.generate_image(image_request(), UsageMeter())
    assert image.data == PNG


def test_gemini_blocked_picture_is_explained():
    provider = GeminiImageProvider("g-test", "gemini-nano-banana-2.1")
    response = SimpleNamespace(candidates=[], prompt_feedback=SimpleNamespace(block_reason="SAFETY"))
    provider.client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kw: response))
    with pytest.raises(ProviderError, match="safety filter"):
        provider.generate_image(image_request(), UsageMeter())


# ---------- generated images are saved as assets ----------


def apply_idea(client, pid, idea="wine anarkali with embroidery, v-neck"):
    job = client.post(f"/api/projects/{pid}/generate/design", json={"options": {"idea": idea}}).json()
    client.post(f"/api/projects/{pid}/jobs/{job['id']}/apply")


def test_sketch_is_saved_as_generated_asset_linked_to_version(client, project):
    pid = project["id"]
    apply_idea(client, pid)
    job = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "pencil"}}).json()
    assert job["status"] == "succeeded"
    asset_id = job["output"]["asset_id"]
    assert asset_id and "pencil graphite" not in job["output"]["prompt"]
    assert "graphite pencil" in job["output"]["prompt"]

    detail = client.get(f"/api/projects/{pid}").json()
    asset = next(a for a in detail["assets"] if a["id"] == asset_id)
    assert asset["kind"] == "generated" and asset["version_number"] == 2
    assert asset["job_id"] == job["id"] and asset["generator_id"] == "sketch" and asset["is_mock"]
    assert detail["project"]["thumbnail_asset_id"] == asset_id

    res = client.get(f"/api/assets/{asset_id}")
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in res.headers["content-security-policy"]


def test_visual_preview_generator_works_with_mock(client, project):
    pid = project["id"]
    apply_idea(client, pid)
    gens = {g["id"]: g for g in client.get("/api/generators").json()}
    assert gens["visual_preview"]["available"]
    job = client.post(f"/api/projects/{pid}/generate/visual_preview", json={"options": {}}).json()
    assert job["status"] == "succeeded"
    assert "MOCK PREVIEW" in job["output"]["svg"]
    assert "dress form" in job["output"]["prompt"]


def test_tailor_sheet_uses_saved_materials_checklist(client, project):
    pid = project["id"]
    apply_idea(client, pid)
    repo = repo_for(client)
    repo.finish_job(
        repo.create_job(pid, "materials", 2, "test", False, {}).id,
        {"items": [{"item": "Special gold thread", "category": "material", "reason": "zari", "optional": False}],
         "notes": []},
        None,
    )
    sheet = client.post(f"/api/projects/{pid}/generate/tailor_sheet", json={"options": {}}).json()
    assert "Special gold thread" in str(sheet["output"])


# ---------- spending limit ----------


class FakePaidImages:
    info = ProviderInfo(name="fake-paid", is_mock=False, paid=True, estimated_cost_usd=0.5)

    def generate_image(self, request, meter):
        meter.add(0.6, "fake image")
        return GeneratedImage(mime_type="image/png", data=PNG, caption="Fake")


def test_daily_budget_stops_paid_calls_and_usage_is_reported(client, project):
    pid = project["id"]
    apply_idea(client, pid)
    container = client.app.state.container
    container.providers.image = FakePaidImages()

    first = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "ink"}}).json()
    assert first["status"] == "succeeded" and not first["is_mock"]
    assert client.get(f"/api/assets/{first['output']['asset_id']}").content == PNG

    second = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "ink"}}).json()
    assert second["status"] == "failed" and "Daily spending limit" in second["error"]

    usage = client.get("/api/usage").json()
    assert usage["today_usd"] == pytest.approx(0.6)
    assert usage["daily_budget_usd"] == 1.0
    assert usage["paid_calls_today"] == 2  # the blocked attempt is logged too, at $0
    assert usage["recent"][0]["generator_id"] == "sketch"

