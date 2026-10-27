"""Anthropic API providers: real AI for design planning, fabrics and materials.

How it works, in short:
  1. We send the model a clear instruction ("system prompt") plus the user's idea
     and the current design spec.
  2. We ask for "structured output": the model must answer in an exact JSON shape
     (described by the Pydantic classes below), so the app never has to guess
     how to read the answer.
  3. We check the answer, record what it cost, and hand it to the generator.

The API key comes from backend/.env (ANTHROPIC_API_KEY). It is never sent to
the browser and never saved in the database.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, Literal, TypeVar

import anthropic
from annotated_types import MaxLen
from pydantic import BaseModel

from app.knowledge import fabric_notes_for
from app.providers.base import ProviderError, ProviderInfo, StepPlan, UsageMeter
from app.schemas.design_spec import DesignSpec, TailorNotes
from app.schemas.outputs import (
    DesignConceptOutput,
    DesignPlan,
    EmbroideryOutput,
    FabricOutput,
    FabricRecommendation,
    MaterialsOutput,
    MoodboardOutput,
    Suggestion,
    VariationsOutput,
)
from app.providers.photo import PHOTO_PROMPT, PhotoAnswer
from app.schemas.stitching import PhotoHints

log = logging.getLogger(__name__)

# US dollars per 1 million tokens: (input, output), by model family and version
# (the model name without its first part, e.g. "opus-5-5"). Used only to estimate cost.
# Check the pricing page in the Anthropic console for current prices.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "opus-5-5": (4.0, 20.0),
    "opus-5": (5.0, 25.0),
    "sonnet-5-5": (2.0, 10.0),
    "sonnet-5": (2.0, 10.0),
    "haiku-5-5": (0.10, 0.50),
    "fable-5-1": (10.0, 50.0),
}
UNKNOWN_MODEL_PRICE = (10.0, 50.0)  # be careful (over-estimate) for models not in the table

# Models that support the server-side "fallbacks" option. If the safety filter
# wrongly declines a harmless request, the API retries on another model.
FALLBACK_MODELS = {"opus-5-5", "opus-5", "sonnet-5-5", "fable-5-1"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def model_family(model: str) -> str:
    """The model name without its first part ("<vendor>-opus-5-5" -> "opus-5-5"), as used by the tables above."""
    return model.split("-", 1)[-1]

SYSTEM_PROMPT = """You are the design assistant inside "Drapeit by Vistas Atelier", an app that helps \
tailors, boutique owners, fashion students and ordinary people turn a clothing idea into a design \
a tailor can actually make. Many users are in India and may write in English, Hindi or Hinglish. \
Understand any of these, but always write your answer in clear, simple English.

Rules you must follow:
- Be practical. Prefer details a tailor can construct, and name Indian garment terms correctly \
(anarkali, kali, yoke, gher, dupatta, zari, gota patti and so on).
- Never invent measurements, cutting dimensions, prices or fabric quantities. If something \
essential is unknown, add it to unresolved_questions instead.
- Anything you decide that the user did not say is an assumption: list it in assumptions.
- Keep the user's own decisions. If the current spec already has a value and the new idea does \
not change it, keep that value.
- Use short values in spec fields (a few words), and put longer explanations in the plan."""

T = TypeVar("T", bound=BaseModel)


# ---------- the exact answer shapes we ask the model for ----------


class SpecFields(BaseModel):
    title: str
    garment_category: str
    occasion: str
    silhouette: str
    fit: str
    neckline: str
    sleeve_style: str
    garment_length: str
    fabric_requirements: str
    preferred_fabrics: list[str]
    colour_palette: list[str]
    embellishments: list[str]
    closures: list[str]
    climate: str
    skill_level: Literal["beginner", "intermediate", "advanced", "professional"]
    design_notes: str
    visual_description: str


class DesignAnswer(BaseModel):
    summary: str
    spec: SpecFields
    detected: list[str]
    unresolved_questions: list[str]
    assumptions: list[str]
    plan: DesignPlan


class FabricAnswer(BaseModel):
    recommendations: list[FabricRecommendation]
    lining_options: list[Suggestion]
    embellishment_options: list[Suggestion]
    complementary_materials: list[str]
    considerations: list[str]


# ---------- helpers ----------


def _limit(field_name: str, value: Any) -> Any:
    """Cut a value down to the size DesignSpec allows, so a long answer cannot break saving."""
    info = DesignSpec.model_fields[field_name]
    max_len = next((m.max_length for m in info.metadata if isinstance(m, MaxLen)), None)
    if max_len is None:
        return value
    if isinstance(value, str):
        return value.strip()[:max_len]
    if isinstance(value, list):
        return [str(v).strip()[:120] for v in value if str(v).strip()][:max_len]
    return value


def _spec_context(spec: DesignSpec) -> str:
    """The parts of the current spec that are filled in, as JSON, for the model to build on."""
    data = spec.model_dump(exclude={"reference_asset_ids", "unresolved_questions", "assumptions", "idea"})
    filled = {k: v for k, v in data.items() if v not in ("", [], None)}
    if not filled.get("measurements"):
        filled.pop("measurement_unit", None)
    if spec.budget.amount is None and not spec.budget.note:
        filled.pop("budget", None)
    if spec.tailor == TailorNotes():
        filled.pop("tailor", None)
    return DesignSpec.model_validate(filled).model_dump_json(include=set(filled), indent=1)


def _spec_brief(spec: DesignSpec) -> str:
    return _spec_context(spec) + (f"\n\nOriginal idea: {spec.idea}" if spec.idea else "")


class AnthropicClient:
    """One shared connection to the Anthropic API, used by all Anthropic providers."""

    def __init__(self, api_key: str, model: str, effort: str = "medium", timeout_s: float = 120.0) -> None:
        self.client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s, max_retries=2)
        self.model = model
        self.effort = effort

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        price_in, price_out = PRICES_PER_MTOK.get(model_family(self.model), UNKNOWN_MODEL_PRICE)
        return (input_tokens * price_in + output_tokens * price_out) / 1_000_000

    def ask(self, user_text: str, answer_type: type[T], meter: UsageMeter, label: str,
            images: list[tuple[bytes, str]] | None = None) -> T:
        extra: dict[str, Any] = {}
        content: Any = user_text
        if images:
            content = [
                *({"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}}
                  for data, mime in images),
                {"type": "text", "text": user_text},
            ]
        if model_family(self.model) in FALLBACK_MODELS:
            extra = {"betas": [FALLBACK_BETA], "fallbacks": "default"}
        try:
            response = self.client.beta.messages.parse(
                model=self.model,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": self.effort},
                output_format=answer_type,
                **extra,
            )
        except anthropic.AuthenticationError as exc:
            raise ProviderError("The Anthropic API rejected the API key. Check ANTHROPIC_API_KEY in backend/.env.") from exc
        except anthropic.PermissionDeniedError as exc:
            raise ProviderError("This API key is not allowed to use this model.") from exc
        except anthropic.NotFoundError as exc:
            raise ProviderError(f"Model '{self.model}' was not found. Check ANTHROPIC_MODEL in backend/.env.") from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError("The Anthropic API is busy for this account (rate limit). Wait a minute and retry.") from exc
        except anthropic.BadRequestError as exc:
            # The most common cause for new accounts is "credit balance too low".
            raise ProviderError(f"The Anthropic API could not accept the request: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("Could not connect to the Anthropic API. Check your internet connection.") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(f"The Anthropic API had a server problem ({exc.status_code}). Please retry.") from exc

        usage = response.usage
        cost = self.estimate_cost(usage.input_tokens, usage.output_tokens)
        meter.add(cost, f"{label}: {usage.input_tokens} in / {usage.output_tokens} out tokens ({response.model})")
        log.info("Anthropic %s request %s cost ~$%.4f", label, response._request_id, cost)

        if response.stop_reason == "refusal":
            raise ProviderError("The model declined this request. Try rephrasing the idea.")
        if response.stop_reason == "max_tokens":
            raise ProviderError("The model's answer was too long and got cut off. Please retry.")
        if response.parsed_output is None:
            raise ProviderError("The model's answer was not in the expected format. Please retry.")
        return response.parsed_output


def _info(model: str, what: str, estimate: float) -> ProviderInfo:
    return ProviderInfo(
        name=f"anthropic ({model})", is_mock=False, paid=True, estimated_cost_usd=estimate,
        note=f"Real AI: Anthropic API {what}. Costs money per use.",
    )


class AnthropicIdeaProvider:
    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "design planning", 0.15)

    def analyse_idea(self, idea: str, current: DesignSpec, meter: UsageMeter) -> DesignConceptOutput:
        prompt = (
            "Turn this clothing idea into a structured garment design.\n\n"
            f"<idea>\n{idea}\n</idea>\n\n"
            "<current_spec>\n" + _spec_context(current) + "\n</current_spec>\n\n"
            "Fill every spec field you reasonably can (use an empty string or empty list if there is "
            "no sensible value). visual_description must describe only what the garment looks like "
            "(shape, colours, surface details, fabric look) in 60 to 120 words, so an illustrator could "
            "draw it. In the plan, colour_story needs real hex codes, design_details should cover each "
            "important area of the garment, and construction_overview is the order of work only, with "
            "no measurements."
        )
        answer = self.client.ask(prompt, DesignAnswer, meter, "design")

        spec = current.model_copy(deep=True)
        spec.idea = idea.strip()
        for name, value in answer.spec.model_dump().items():
            setattr(spec, name, _limit(name, value))
        spec.unresolved_questions = _limit("unresolved_questions", answer.unresolved_questions)
        spec.assumptions = _limit("assumptions", answer.assumptions)
        spec = DesignSpec.model_validate(spec.model_dump())
        return DesignConceptOutput(
            summary=answer.summary,
            proposed_spec=spec,
            detected=answer.detected,
            unresolved_questions=spec.unresolved_questions,
            assumptions=spec.assumptions,
            plan=answer.plan,
        )


class AnthropicFabricProvider:
    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "fabric advice", 0.15)

    def recommend_fabrics(self, spec: DesignSpec, meter: UsageMeter) -> FabricOutput:
        prompt = (
            "Recommend 4 to 6 fabrics for this design, best first.\n\n"
            "<design_spec>\n" + _spec_brief(spec) + "\n</design_spec>\n\n"
            "Think about occasion, climate, silhouette, drape, comfort, embellishment weight, budget, "
            "maintenance and the maker's skill level. swatch_colour is a hex code close to the design's "
            "main colour in that fabric. score (0 to 100) is how well it suits this design. "
            "comfort, maintenance and weight describe wearing and caring for it. cost_level only compares "
            "these fabrics with each other (low, medium or high). climate_fit, occasion_fit and "
            "budget_note are one short sentence each; budget_note must not contain any price or number. "
            "Set approximate_cost to null: the app has no reliable price data. Also give lining options "
            "and embellishment options, each with a one-sentence reason, then complementary materials "
            "and the main considerations."
        )
        answer = self.client.ask(prompt, FabricAnswer, meter, "fabric")
        for rec in answer.recommendations:
            rec.approximate_cost = None  # never show a price we cannot verify
        return FabricOutput(
            recommendations=answer.recommendations,
            lining=[o.name for o in answer.lining_options],
            lining_options=answer.lining_options,
            embellishment_options=answer.embellishment_options,
            complementary_materials=answer.complementary_materials,
            considerations=answer.considerations,
        )


class AnthropicMaterialsProvider:
    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "tools and materials checklist", 0.12)

    def tools_and_materials(self, spec: DesignSpec, meter: UsageMeter) -> MaterialsOutput:
        prompt = (
            "Make a checklist of sewing tools, materials, notions and embellishment supplies needed to "
            "make this design. Be specific to this garment (closures, interfacing, lining, threads, "
            "needles for the fabric, embellishment supplies). Mark nice-to-have items as optional. "
            "linked_to names the part of this design that needs the item (for example 'Closure: side zip' "
            "or 'Fabric: velvet'), or is empty for general tools. quantity_hint is only for obvious counts "
            "(for example '1 zip'); leave it empty otherwise. Never give fabric lengths or any measurement: "
            "those need the wearer's measurements and the pattern. Leave based_on empty.\n\n"
            "<design_spec>\n" + _spec_brief(spec) + "\n</design_spec>"
        )
        return self.client.ask(prompt, MaterialsOutput, meter, "materials")



class AnthropicIdeasProvider:
    """Phase 4: design variations, moodboard and embroidery / print concepts."""

    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "design ideas (variations, moodboard, embroidery)", 0.12)

    def variations(self, spec: DesignSpec, meter: UsageMeter) -> VariationsOutput:
        prompt = (
            "Suggest 6 to 8 design variations of this garment: at least one each for neckline, sleeves, "
            "silhouette, embellishment and colour. Each variation changes only one thing; fill only the field "
            "it changes (neckline, sleeve_style, silhouette, embellishments, or colour_palette with matching "
            "colour_hex codes) and leave the others empty. Keep values short, like spec fields. why is one "
            "sentence on why it suits this design and occasion. base_summary is one sentence.\n\n"
            "<design_spec>\n" + _spec_brief(spec) + "\n</design_spec>"
        )
        return self.client.ask(prompt, VariationsOutput, meter, "variations")

    def moodboard(self, spec: DesignSpec, meter: UsageMeter) -> MoodboardOutput:
        prompt = (
            "Create a moodboard for this design: a short title, a two or three sentence story, 4 to 6 mood "
            "words, a palette of 3 to 5 colours with real hex codes and roles, 3 or 4 fabric textures (texture "
            "must be one of the allowed values; colour is a hex code), 3 or 4 motifs, and 3 or 4 visual "
            "references written as words (no links, no brand or designer names). Leave image_asset_ids empty."
            "\n\n<design_spec>\n" + _spec_brief(spec) + "\n</design_spec>"
        )
        out = self.client.ask(prompt, MoodboardOutput, meter, "moodboard")
        out.image_asset_ids = []  # the app adds the project's own pictures
        return out

    def embroidery(self, spec: DesignSpec, meter: UsageMeter) -> EmbroideryOutput:
        prompt = (
            "Suggest 3 to 5 embroidery, print or surface-design concepts for this garment, suited to its "
            "occasion, fabric and the maker's skill level. For each give the technique (use correct Indian "
            "craft names where they fit), the motif, where it goes (placements from the allowed list), a "
            "placement note a tailor can follow, scale, colours with hex codes, the materials needed, "
            "difficulty, and effort described in words. Never give hours, prices or measurements.\n\n"
            "<design_spec>\n" + _spec_brief(spec) + "\n</design_spec>"
        )
        return self.client.ask(prompt, EmbroideryOutput, meter, "embroidery")


class AnthropicPhotoProvider:
    """Reads a reference photo with the Anthropic API (the model can look at pictures)."""

    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "reads a reference photo", 0.05)

    def read_photo(self, image: bytes, mime_type: str, spec: DesignSpec, meter: UsageMeter) -> PhotoHints:
        answer = self.client.ask(PHOTO_PROMPT, PhotoAnswer, meter, "Reference photo", images=[(image, mime_type)])
        return PhotoHints(**answer.model_dump())


class StepAnswer(BaseModel):
    module_slug: str
    why: str
    instructions: list[str]
    tips: list[str]
    fabric_tips: list[str]


class GuideAnswer(BaseModel):
    steps: list[StepAnswer]


GUIDE_PROMPT = """You are a master tailor writing a stitching guide for the garment below. The technique modules are the ONLY source of methods: they are checked, original instructions. For every module, write that step of the guide for this exact garment and fabric.

Rules:
- Return one step for each module, using its exact slug in module_slug. Do not add steps that are not in the modules, and do not drop any.
- Keep every instruction of the module, in the same order. You may reword to fit this garment (name its neckline, sleeves, closure and fabric where it helps), but do not change the method.
- why: one sentence on why this step matters for THIS design. Start from the reason given.
- tips: the module's tips, adapted. fabric_tips: advice specific to this fabric, taken from the fabric card and the module's fabric notes only. Leave it empty if there is none.
- Never invent measurements, seam allowances, stitch lengths or product names. If a number is not in the modules or the fabric card, do not write one.
- Plain, short sentences. English only."""


class AnthropicGuideProvider:
    """The master tailor, as the Anthropic API: words each step for this design, from the retrieved modules."""

    def __init__(self, client: AnthropicClient) -> None:
        self.client = client
        self.info = _info(client.model, "writes the stitching guide for this design", 0.15)

    def compose(self, garment, modules, reasons, fabric, meter) -> list[StepPlan]:  # noqa: ANN001 - see base.py
        payload = {
            "garment": garment.model_dump(exclude={"features"}),
            "fabric_card": None if fabric is None else {
                "fabric": fabric.title, "needle": fabric.needle, "thread": fabric.thread,
                "stitch_length": fabric.stitch_length, "seam_types": list(fabric.seam_types),
                "pressing": fabric.pressing, "notes": list(fabric.notes),
            },
            "modules": [
                {"slug": m.slug, "title": m.title, "phase": m.phase, "reason": reasons.get(m.slug, ""),
                 "instructions": list(m.steps), "tips": list(m.tips), "fabric_notes": fabric_notes_for(m, fabric)}
                for m in modules
            ],
        }
        brief = f"{GUIDE_PROMPT}\n\n{json.dumps(payload, ensure_ascii=False)}"
        answer = self.client.ask(brief, GuideAnswer, meter, "Stitching guide")
        known = {m.slug for m in modules}
        return [StepPlan(s.module_slug, s.why, s.instructions, s.tips, s.fabric_tips)
                for s in answer.steps if s.module_slug in known]
