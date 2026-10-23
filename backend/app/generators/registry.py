"""The list of all generators.

Each generator has:
  * an id and a human name,
  * which service/provider it uses,
  * which design-spec fields it depends on (so we know when its output is
    out of date after the design changes),
  * a `run` function, or `None` when it is planned for a later phase.

To add a new generator: write a run function and add one entry to GENERATORS.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from app.providers.base import GeneratedImage, ImageRequest, ProviderInfo, UsageMeter
from app.providers.registry import Providers
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    SKETCH_STYLES,
    CostInputs,
    DesignConceptOutput,
    FabricOutput,
    MaterialsOutput,
    PreviewOutput,
    SketchOutput,
    TutorialOutput,
)
from app.services.cost_estimate import estimate_cost, starter_inputs
from app.services.image_prompts import preview_prompt, sketch_prompt
from app.services.pattern import build_pattern
from app.services.storyboard import build_storyboard
from app.services.tailor_sheet import build_tailor_sheet
from app.services.tutorials import build_tutorial


class GeneratorInputError(Exception):
    """The request cannot run as given (message is shown to the user)."""


def _no_saver(image: GeneratedImage, label: str) -> str | None:
    return None


def _no_lookup(generator_id: str) -> dict[str, Any] | None:
    return None


def _no_assets() -> list[Any]:
    return []


@dataclass
class GeneratorContext:
    spec: DesignSpec
    options: dict[str, Any]
    providers: Providers
    meter: UsageMeter = field(default_factory=UsageMeter)
    # Saves a generated picture as a project asset (linked to this job and
    # design version) and returns the new asset id.
    save_image: Callable[[GeneratedImage, str], str | None] = _no_saver
    # Returns the newest successful output of another generator, if any.
    latest_output: Callable[[str], dict[str, Any] | None] = _no_lookup
    # The project's pictures (uploads, studio sketches, generated images), newest first.
    project_assets: Callable[[], list[Any]] = _no_assets


RunFn = Callable[[GeneratorContext], BaseModel]


@dataclass(frozen=True)
class GeneratorDefinition:
    id: str
    name: str
    description: str
    service: str
    phase: int
    depends_on: list[str] = field(default_factory=list)
    run: RunFn | None = None
    provider: Callable[[Providers], ProviderInfo] | None = None
    in_package_by_default: bool = False


def _design(ctx: GeneratorContext) -> BaseModel:
    idea = str(ctx.options.get("idea") or ctx.spec.idea).strip()
    if not idea:
        raise GeneratorInputError("Write your design idea first, then press Generate Design.")
    if len(idea) > 4000:
        raise GeneratorInputError("The idea is too long (max 4000 characters).")
    return ctx.providers.idea.analyse_idea(idea, ctx.spec, ctx.meter)


def _sketch(ctx: GeneratorContext) -> BaseModel:
    style = ctx.options.get("style", "pencil")
    if style not in SKETCH_STYLES:
        raise GeneratorInputError(f"Unknown sketch style '{style}'.")
    if not ctx.spec.garment_category:
        raise GeneratorInputError("Set the garment type in the design spec before generating a sketch.")
    prompt = sketch_prompt(ctx.spec, style)
    image = ctx.providers.image.generate_image(
        ImageRequest(prompt=prompt, spec=ctx.spec, purpose="sketch", style=style), ctx.meter
    )
    label = style.replace("_", " ")
    asset_id = ctx.save_image(image, f"sketch-{style}")
    return SketchOutput(
        style=style, svg=image.svg, asset_id=asset_id, prompt=prompt, editable=False,
        caption=image.caption if image.svg else f"{label.capitalize()} of {ctx.spec.title or ctx.spec.garment_category}. {image.caption}.",
    )


def _preview(ctx: GeneratorContext) -> BaseModel:
    if not ctx.spec.garment_category:
        raise GeneratorInputError("Set the garment type in the design spec before generating a preview.")
    prompt = preview_prompt(ctx.spec)
    image = ctx.providers.image.generate_image(ImageRequest(prompt=prompt, spec=ctx.spec, purpose="preview"), ctx.meter)
    asset_id = ctx.save_image(image, "preview")
    return PreviewOutput(
        svg=image.svg, asset_id=asset_id, prompt=prompt, editable=False,
        caption=image.caption if image.svg else (
            f"AI visual preview of {ctx.spec.title or ctx.spec.garment_category}. {image.caption}. "
            "An impression only: the real garment depends on fabric, fit and finishing."
        ),
    )


def _fabric(ctx: GeneratorContext) -> BaseModel:
    if not ctx.spec.garment_category:
        raise GeneratorInputError("Set the garment type in the design spec before asking for fabrics.")
    return ctx.providers.fabric.recommend_fabrics(ctx.spec, ctx.meter)


def spec_basis(spec: DesignSpec) -> list[str]:
    """The design details a checklist was made from, so the user can see what it is tied to."""
    parts = [
        ("Garment", spec.garment_category), ("Silhouette", spec.silhouette), ("Neckline", spec.neckline),
        ("Sleeves", spec.sleeve_style), ("Fabric", ", ".join(spec.preferred_fabrics)),
        ("Closures", ", ".join(spec.closures)), ("Embellishments", ", ".join(spec.embellishments)),
    ]
    return [f"{label}: {value}" for label, value in parts if value]


def _materials(ctx: GeneratorContext) -> BaseModel:
    out = ctx.providers.materials.tools_and_materials(ctx.spec, ctx.meter)
    out.based_on = spec_basis(ctx.spec)
    return out


def _saved(ctx: GeneratorContext, generator_id: str, model: type[BaseModel]) -> Any:
    """The newest saved output of another generator, or None if there is none (or it is from an older format)."""
    data = ctx.latest_output(generator_id)
    if not data:
        return None
    try:
        return model.model_validate(data)
    except ValidationError:
        return None


def _need_garment(ctx: GeneratorContext, what: str) -> None:
    if not ctx.spec.garment_category:
        raise GeneratorInputError(f"Set the garment type in the design spec before {what}.")


def _saved_materials(ctx: GeneratorContext) -> MaterialsOutput:
    """The saved checklist, or the free built-in one: these generators never trigger a paid AI call for it."""
    return _saved(ctx, "materials", MaterialsOutput) or ctx.providers.builtin_materials.tools_and_materials(
        ctx.spec, ctx.meter
    )


def _saved_plan(ctx: GeneratorContext) -> Any:
    """The design plan's order of work, only when it describes this garment."""
    concept = _saved(ctx, "design", DesignConceptOutput)
    return concept.plan if concept and concept.proposed_spec.garment_category == ctx.spec.garment_category else None


def _tailor_sheet(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "building a tailor sheet")
    return build_tailor_sheet(ctx.spec, _saved_materials(ctx), _saved(ctx, "fabric", FabricOutput), _saved_plan(ctx))


TUTORIAL_LANGUAGES = ("any", "en", "hi")


def _tutorial(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "finding tutorials")
    language = ctx.options.get("language", "any")
    if language not in TUTORIAL_LANGUAGES:
        raise GeneratorInputError("Tutorial language must be any, en (English) or hi (Hindi).")
    return build_tutorial(ctx.spec, ctx.providers.tutorials, ctx.meter, language)


def _variations(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "asking for variations")
    return ctx.providers.ideas.variations(ctx.spec, ctx.meter)


def _moodboard(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "making a moodboard")
    out = ctx.providers.ideas.moodboard(ctx.spec, ctx.meter)
    # Put this project's own pictures on the board: previews and sketches first, then references.
    order = {"visual_preview": 0, "sketch": 1}
    pictures = sorted(ctx.project_assets(), key=lambda a: order.get(a.generator_id or "", 2))
    out.image_asset_ids = [a.id for a in pictures][:4]
    return out


def _embroidery(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "asking for embroidery and print concepts")
    return ctx.providers.ideas.embroidery(ctx.spec, ctx.meter)


def _pattern(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "asking for pattern assistance")
    return build_pattern(ctx.spec)


def _video(ctx: GeneratorContext) -> BaseModel:
    _need_garment(ctx, "planning an instructional video")
    return build_storyboard(ctx.spec, _saved_materials(ctx), _saved_plan(ctx), _saved(ctx, "tutorial", TutorialOutput))


def _cost(ctx: GeneratorContext) -> BaseModel:
    try:
        inputs = CostInputs.model_validate(ctx.options)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = " → ".join(str(p) for p in first["loc"])
        raise GeneratorInputError(f"Check the cost details ({where}): {first['msg']}.") from exc
    if not inputs.materials and not inputs.labour:
        # Nothing typed in yet: list what needs a price, from the saved checklist and fabrics.
        starter = starter_inputs(
            ctx.spec, _saved(ctx, "materials", MaterialsOutput), _saved(ctx, "fabric", FabricOutput)
        )
        inputs = inputs.model_copy(update={
            "materials": starter.materials, "labour": starter.labour, "currency": inputs.currency or starter.currency,
        })
    return estimate_cost(ctx.spec, inputs)


BUILT_IN = ProviderInfo(name="built-in", is_mock=False, note="Ordinary code, no AI involved.")

GENERATORS: list[GeneratorDefinition] = [
    GeneratorDefinition(
        "design", "Generate Design", "Turn your idea into a structured garment concept.",
        service="idea_understanding", phase=1, depends_on=["idea"], run=_design,
        provider=lambda p: p.idea.info, in_package_by_default=True,
    ),
    GeneratorDefinition(
        "sketch", "Generate Sketch", "Draw a sketch of the design in a chosen style.",
        service="image_generation", phase=1,
        depends_on=["garment_category", "silhouette", "neckline", "sleeve_style", "garment_length",
                    "colour_palette", "embellishments", "title", "visual_description"],
        run=_sketch, provider=lambda p: p.image.info, in_package_by_default=True,
    ),
    GeneratorDefinition(
        "visual_preview", "Generate Visual Preview", "A realistic preview picture of the finished garment.",
        service="image_generation", phase=2,
        depends_on=["garment_category", "silhouette", "fit", "neckline", "sleeve_style", "garment_length",
                    "colour_palette", "embellishments", "closures", "occasion", "visual_description"],
        run=_preview, provider=lambda p: p.image.info, in_package_by_default=False,
    ),
    GeneratorDefinition(
        "fabric", "Generate Fabric Recommendations", "Suggest fabrics, lining and complementary materials.",
        service="fabric_recommendation", phase=1,
        # preferred_fabrics is left out on purpose: saving a suggested fabric should
        # not make the suggestions themselves look out of date.
        depends_on=["garment_category", "occasion", "silhouette", "climate", "embellishments",
                    "skill_level", "budget"],
        run=_fabric, provider=lambda p: p.fabric.info, in_package_by_default=True,
    ),
    GeneratorDefinition(
        "materials", "Generate Tools and Materials",
        "A checklist of tools, notions and embellishments for this design version.",
        service="tools_materials", phase=1,
        depends_on=["garment_category", "silhouette", "neckline", "sleeve_style", "closures", "embellishments",
                    "preferred_fabrics", "fabric_requirements", "idea"],
        run=_materials, provider=lambda p: p.materials.info, in_package_by_default=True,
    ),
    GeneratorDefinition(
        "tailor_sheet", "Generate Tailor Sheet", "Combine everything into a printable tailor specification.",
        service="export", phase=1,
        depends_on=["title", "garment_category", "occasion", "silhouette", "fit", "neckline", "sleeve_style",
                    "garment_length", "closures", "embellishments", "colour_palette", "preferred_fabrics",
                    "fabric_requirements", "measurements", "measurement_unit", "budget", "design_notes",
                    "unresolved_questions", "skill_level", "climate", "tailor"],
        run=_tailor_sheet, provider=lambda p: BUILT_IN, in_package_by_default=True,
    ),
    GeneratorDefinition(
        "cost", "Generate Cost Estimate",
        "Add up the prices you enter. Labour, materials and assumptions shown separately.",
        service="cost_calculation", phase=3,
        depends_on=["garment_category", "preferred_fabrics", "embellishments", "closures", "budget"],
        run=_cost, provider=lambda p: BUILT_IN, in_package_by_default=False,
    ),
    # ----- Phase 4: learning and advanced generators -----
    GeneratorDefinition(
        "variations", "Generate Design Variations",
        "Alternative necklines, sleeves, silhouettes, embellishments and colours.",
        service="design_ideas", phase=4,
        depends_on=["garment_category", "occasion", "silhouette", "neckline", "sleeve_style", "embellishments",
                    "colour_palette"],
        run=_variations, provider=lambda p: p.ideas.info,
    ),
    GeneratorDefinition(
        "moodboard", "Generate Moodboard", "Mood words, palette, textures, motifs and your project's pictures.",
        service="design_ideas", phase=4,
        depends_on=["garment_category", "occasion", "climate", "colour_palette", "embellishments",
                    "preferred_fabrics", "visual_description"],
        run=_moodboard, provider=lambda p: p.ideas.info,
    ),
    GeneratorDefinition(
        "embroidery", "Generate Embroidery & Print Concepts", "Techniques, motifs and where to place them.",
        service="design_ideas", phase=4,
        depends_on=["garment_category", "occasion", "neckline", "sleeve_style", "embellishments", "colour_palette",
                    "preferred_fabrics", "skill_level"],
        run=_embroidery, provider=lambda p: p.ideas.info,
    ),
    GeneratorDefinition(
        "pattern", "Generate Pattern Assistance",
        "Conceptual only: pieces, required measurements, drafting guidance and a cutting layout.",
        service="pattern_assistance", phase=4,
        depends_on=["garment_category", "silhouette", "fit", "neckline", "sleeve_style", "garment_length", "closures",
                    "measurements", "measurement_unit", "preferred_fabrics", "fabric_requirements"],
        run=_pattern, provider=lambda p: BUILT_IN,
    ),
    GeneratorDefinition(
        "tutorial", "Generate Tutorial", "Real videos from YouTube search, organised into a learning guide.",
        service="tutorial_search", phase=4,
        depends_on=["garment_category", "neckline", "embellishments", "closures", "preferred_fabrics", "skill_level"],
        run=_tutorial, provider=lambda p: p.tutorials.info,
    ),
    GeneratorDefinition(
        "video", "Generate Instructional Video",
        "No video provider is set up: makes a storyboard and script, plus links to real tutorials.",
        service="video_generation", phase=4,
        depends_on=["garment_category", "title", "neckline", "sleeve_style", "garment_length", "embellishments",
                    "preferred_fabrics", "fabric_requirements"],
        run=_video, provider=lambda p: BUILT_IN,
    ),
]

GENERATORS_BY_ID: dict[str, GeneratorDefinition] = {g.id: g for g in GENERATORS}

# The order the complete package runs in. Design runs first because the others
# use the spec it produces.
PACKAGE_ORDER = ["design", "sketch", "visual_preview", "fabric", "materials", "variations", "moodboard",
                 "embroidery", "pattern", "tailor_sheet", "cost", "tutorial", "video"]
