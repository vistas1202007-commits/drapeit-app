"""Structured outputs produced by generators.

Each generator returns one of these models. Validating the output means a
broken provider response is caught on the server instead of breaking the UI.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.design_spec import DesignSpec

SketchStyle = Literal["pencil", "ink", "technical_flat", "charcoal", "coloured", "watercolour"]
SKETCH_STYLES: tuple[str, ...] = ("pencil", "ink", "technical_flat", "charcoal", "coloured", "watercolour")


Difficulty = Literal["beginner", "intermediate", "advanced", "professional"]


class ColourSwatch(BaseModel):
    name: str
    hex: str = Field(description="Hex colour such as #6d1a36.")
    role: str = Field(description="How the colour is used, e.g. main body, accent, trim, lining.")


class DesignDetail(BaseModel):
    area: str = Field(description="Part of the garment, e.g. neckline, sleeves, yoke, hem, back.")
    detail: str


class ConstructionStep(BaseModel):
    step: str
    note: str = ""


class DesignPlan(BaseModel):
    """The structured design plan: everything needed to understand the design at a glance."""

    concept_statement: str = Field(description="Two or three sentences describing the design and its mood.")
    style_keywords: list[str] = Field(default_factory=list)
    colour_story: list[ColourSwatch] = Field(default_factory=list)
    design_details: list[DesignDetail] = Field(default_factory=list)
    construction_overview: list[ConstructionStep] = Field(
        default_factory=list, description="High-level order of work. Not cutting dimensions."
    )
    fabric_direction: str = ""
    difficulty: Difficulty = "intermediate"
    difficulty_reason: str = ""


class DesignConceptOutput(BaseModel):
    """Result of "Generate Design": a proposed spec the user can accept."""

    summary: str
    proposed_spec: DesignSpec
    detected: list[str] = Field(default_factory=list, description="What was recognised in the idea.")
    unresolved_questions: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    # Phase 2: richer plan. Older saved outputs do not have it, so it is optional.
    plan: DesignPlan | None = None


class SketchOutput(BaseModel):
    style: SketchStyle
    # The image itself. Built-in (mock) sketches also keep the SVG text here.
    # Every generated image is saved as an asset; asset_id points to it.
    svg: str | None = None
    asset_id: str | None = None
    caption: str
    # The exact text sent to the image model, so the user can see what was asked.
    prompt: str = ""
    # Generated images are pictures (raster/SVG previews), not editable layers.
    editable: bool = False


class PreviewOutput(BaseModel):
    """Result of "Generate Visual Preview": a realistic picture of the finished garment."""

    svg: str | None = None
    asset_id: str | None = None
    caption: str
    prompt: str = ""
    editable: bool = False


Level = Literal["low", "medium", "high"]


class FabricRecommendation(BaseModel):
    name: str
    swatch_colour: str = Field(description="Hex colour used to draw the swatch.")
    texture: Literal["plain", "twill", "satin", "sheer", "knit", "pile", "slub", "crepe"]
    suitability: str
    properties: list[str]
    advantages: list[str]
    limitations: list[str]
    care: str
    drape: Level
    breathability: Level
    approximate_cost: str | None = Field(
        default=None, description="Only filled in when reliable price data exists."
    )
    score: int = Field(ge=0, le=100)
    # Phase 3 factors. They have defaults so outputs saved before Phase 3 still load.
    comfort: Level = Field(default="medium", description="How comfortable it is to wear for this occasion.")
    maintenance: Literal["easy", "moderate", "delicate"] = "moderate"
    weight: Literal["light", "medium", "heavy"] = "medium"
    cost_level: Level | None = Field(
        default=None, description="Cost compared with the other fabrics listed. Not a price."
    )
    climate_fit: str = Field(default="", description="One sentence: how it suits the climate.")
    occasion_fit: str = Field(default="", description="One sentence: how it suits the occasion.")
    budget_note: str = Field(default="", description="One sentence on budget, without prices.")
    lining_needed: bool = False


class Suggestion(BaseModel):
    name: str
    reason: str


class FabricOutput(BaseModel):
    recommendations: list[FabricRecommendation]
    # Plain lining names. Phase 3 also fills lining_options (with reasons);
    # this list is kept so older screens and saved outputs keep working.
    lining: list[str] = Field(default_factory=list)
    complementary_materials: list[str]
    considerations: list[str]
    lining_options: list[Suggestion] = Field(default_factory=list)
    embellishment_options: list[Suggestion] = Field(default_factory=list)


class ChecklistItem(BaseModel):
    item: str
    category: Literal["tool", "material", "notion", "embellishment"]
    reason: str
    optional: bool = False
    linked_to: str = Field(
        default="", description="The part of the design that needs it, e.g. 'Closure: side zip' or 'Fabric: velvet'."
    )
    quantity_hint: str = Field(
        default="", description="Only obvious counts such as '1'. Never fabric lengths: those need measurements."
    )


class MaterialsOutput(BaseModel):
    items: list[ChecklistItem]
    notes: list[str]
    # The design details this checklist was made from (filled in by the app).
    based_on: list[str] = Field(default_factory=list)


class TailorSheetSection(BaseModel):
    heading: str
    rows: list[tuple[str, str]]


class SheetReference(BaseModel):
    asset_id: str
    view: str
    note: str = ""


class TailorSheetOutput(BaseModel):
    title: str
    sections: list[TailorSheetSection]
    # Each row: name, value, status ("Measured", "Estimate – verify before cutting"
    # or "Missing – measure the wearer") and note.
    measurements: list[dict[str, str]]
    missing_measurements: list[str]
    construction_notes: list[str]
    cutting_notes: list[str]
    warnings: list[str]
    # Phase 3 (defaults keep older sheets loadable).
    unit: str = "cm"
    stitching_notes: list[str] = Field(default_factory=list)
    references: list[SheetReference] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


# ---------- cost estimate (Phase 3) ----------

CostKind = Literal["fabric", "lining", "notion", "embellishment", "other"]


class CostLineInput(BaseModel):
    """One material line as typed by the user. Prices are never filled in by the app."""

    item: str = Field(min_length=1, max_length=120)
    kind: CostKind = "other"
    quantity: float | None = Field(default=None, gt=0, lt=100_000)
    unit: str = Field(default="", max_length=20)
    unit_price: float | None = Field(default=None, ge=0, lt=10_000_000)
    price_source: str = Field(default="", max_length=120)


class LabourInput(BaseModel):
    task: str = Field(min_length=1, max_length=120)
    amount: float | None = Field(default=None, ge=0, lt=10_000_000)
    note: str = Field(default="", max_length=200)


class CostInputs(BaseModel):
    """Options for the Cost Estimate generator."""

    currency: str = Field(default="", max_length=8)
    region: str = Field(default="", max_length=80)
    price_date: str = Field(default="", max_length=40)
    materials: list[CostLineInput] = Field(default_factory=list, max_length=60)
    labour: list[LabourInput] = Field(default_factory=list, max_length=20)
    contingency_percent: float = Field(default=0, ge=0, le=50)


class CostLine(CostLineInput):
    line_total: float | None = None
    status: Literal["priced", "missing_price", "missing_quantity", "missing_both"]


class LabourLine(LabourInput):
    status: Literal["quoted", "missing"]


class CostEstimateOutput(BaseModel):
    currency: str
    region: str
    price_date: str
    materials: list[CostLine]
    labour: list[LabourLine]
    materials_subtotal: float
    contingency_percent: float
    contingency_amount: float
    labour_subtotal: float
    total: float
    complete: bool
    missing: list[str]
    assumptions: list[str]
    budget_amount: float | None = None
    budget_currency: str = ""
    budget_status: Literal["within", "over", "unknown"] = "unknown"
    budget_note: str = ""


# ---------- Phase 4: learning and advanced generators ----------

Texture = Literal["plain", "twill", "satin", "sheer", "knit", "pile", "slub", "crepe"]


class TutorialVideo(BaseModel):
    """A real video returned by the video search provider. Nothing here is made up:
    the id, title, channel and thumbnail come straight from the provider's answer."""

    video_id: str
    title: str
    channel: str
    url: str
    thumbnail_url: str
    published_at: str = ""
    duration: str = ""
    description: str = ""
    topic: str = ""
    relevance: list[str] = Field(default_factory=list)
    score: int = 0


class LearningStep(BaseModel):
    topic: str
    why: str
    search_query: str
    # A link to the provider's own search page for this query (not a video).
    search_url: str
    video_ids: list[str] = Field(default_factory=list)


class TutorialOutput(BaseModel):
    source: str
    connected: bool
    language: str = "any"
    steps: list[LearningStep]
    videos: list[TutorialVideo]
    notes: list[str]


VariationKind = Literal["neckline", "sleeves", "silhouette", "embellishment", "colour"]


class DesignVariation(BaseModel):
    kind: VariationKind
    name: str
    description: str
    why: str = Field(description="One sentence: why this alternative suits the design or occasion.")
    # Only the fields this variation changes are filled in; empty means "keep as is".
    neckline: str = ""
    sleeve_style: str = ""
    silhouette: str = ""
    embellishments: list[str] = Field(default_factory=list)
    colour_palette: list[str] = Field(default_factory=list)
    colour_hex: list[str] = Field(default_factory=list, description="Hex codes matching colour_palette.")


class VariationsOutput(BaseModel):
    base_summary: str
    variations: list[DesignVariation]
    notes: list[str]


class MoodTexture(BaseModel):
    name: str
    texture: Texture
    colour: str = Field(description="Hex colour.")
    note: str = ""


class MoodboardOutput(BaseModel):
    title: str
    story: str = Field(description="Two or three sentences describing the mood.")
    mood_words: list[str]
    palette: list[ColourSwatch]
    textures: list[MoodTexture]
    motifs: list[str]
    references: list[str] = Field(description="Visual themes to look at, as words. No links.")
    # Pictures from this project placed on the board (filled in by the app).
    image_asset_ids: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


Placement = Literal["neckline", "yoke", "bodice", "sleeves", "cuffs", "waist", "hem", "back", "dupatta", "all_over"]


class EmbroideryConcept(BaseModel):
    name: str
    kind: Literal["embroidery", "print", "surface"]
    technique: str = Field(description="e.g. zardozi, aari, gota patti, block print, mirror work.")
    motif: str
    placements: list[Placement]
    placement_note: str
    scale: Literal["fine", "medium", "bold"]
    colours: list[ColourSwatch]
    materials: list[str]
    difficulty: Difficulty
    effort_note: str = Field(description="How much work it is, in words. No hours or prices.")


class EmbroideryOutput(BaseModel):
    concepts: list[EmbroideryConcept]
    notes: list[str]


class PatternPiece(BaseModel):
    name: str
    cut: str
    fabric: Literal["main", "lining", "interfacing"]
    grain: str
    size: Literal["large", "medium", "small"] = "medium"
    notes: str = ""


class DraftingStep(BaseModel):
    step: str
    uses: list[str] = Field(default_factory=list)
    note: str = ""


class CuttingLayout(BaseModel):
    fold: str
    nap: bool
    steps: list[str]


class PatternOutput(BaseModel):
    """Pattern assistance. Always conceptual: it explains, it does not draft."""

    conceptual: bool = True
    disclaimer: str
    garment: str
    unit: str
    required_measurements: list[dict[str, str]]
    missing_measurements: list[str]
    pieces: list[PatternPiece]
    drafting_steps: list[DraftingStep]
    layout: CuttingLayout
    warnings: list[str]


class StoryboardScene(BaseModel):
    number: int
    title: str
    shot: str
    action: str
    narration: str
    on_screen_text: str = ""
    seconds: int


class VideoOutput(BaseModel):
    mode: Literal["generated", "storyboard"]
    provider_note: str
    title: str
    scenes: list[StoryboardScene]
    script: str
    tutorial_videos: list[TutorialVideo] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
