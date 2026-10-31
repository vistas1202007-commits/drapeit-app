"""The Stitching Guide: what the garment is made of, and the steps to sew it.

`GarmentComponents` is what the garment parser reads out of the design spec (and a
reference photo, when there is one). `StitchingGuideOutput` is the finished guide:
steps in the order a tailor works, each one tied to the technique module it came
from and, when one was found, a real tutorial video.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# The order a tailor works in. Every technique module belongs to exactly one phase.
Phase = Literal["prep", "shaping", "main_seams", "openings", "side_seams", "hem", "pressing"]
PHASES: tuple[Phase, ...] = ("prep", "shaping", "main_seams", "openings", "side_seams", "hem", "pressing")
PHASE_LABELS: dict[str, str] = {
    "prep": "Prep & cutting",
    "shaping": "Shaping",
    "main_seams": "Main seams",
    "openings": "Openings & finishes",
    "side_seams": "Side seams",
    "hem": "Hem",
    "pressing": "Pressing",
}

FabricWeight = Literal["light", "medium", "heavy"]


class PhotoHints(BaseModel):
    """What an image-reading provider saw in a reference photo. Every field may stay empty."""

    garment_type: str = ""
    bodice: str = ""
    neckline: str = ""
    sleeves: str = ""
    skirt: str = ""
    closure_position: str = ""
    length: str = ""
    features: list[str] = Field(default_factory=list, description="e.g. pleats, gathers, darts, lining, slit.")
    notes: list[str] = Field(default_factory=list)


class ConstructionDecision(BaseModel):
    key: str
    label: str
    value: str = ""
    source: Literal["specified", "observed", "proposed", "unknown"] = "unknown"
    needs_confirmation: bool = True


class GarmentComponents(BaseModel):
    """The garment taken apart into the pieces a tailor thinks in."""

    decisions: list[ConstructionDecision] = Field(default_factory=list)
    fabric_construction: Literal["woven", "knit", "unknown"] = "unknown"
    garment_type: str
    family: str = Field(description="Broad group used to pick techniques: dress, lehenga, kurta, blouse, skirt...")
    bodice: str = ""
    neckline: str = ""
    neckline_finish: str = ""
    sleeves: str = ""
    skirt: str = ""
    closure: str = ""
    closure_position: str = ""
    length: str = ""
    fabric: str = ""
    fabric_class: str = Field(default="", description="silk, chiffon, georgette, cotton, linen, denim, velvet, khadi or other.")
    fabric_weight: FabricWeight = "medium"
    lined: bool = False
    features: list[str] = Field(default_factory=list, description="Technique tags, e.g. darts, gathers, set-in-sleeve.")
    source: Literal["spec", "spec+photo"] = "spec"
    # What was worked out rather than read from the spec or the photo.
    assumptions: list[str] = Field(default_factory=list)
    photo_notes: list[str] = Field(default_factory=list)


class GuideVideo(BaseModel):
    """A video the search really returned. `start_seconds` says where to begin playing it."""

    source: Literal["youtube", "hosted"] = "youtube"
    media_url: str | None = None
    evidence: Literal["candidate", "chapter", "indexed", "reviewed"] = "candidate"
    reviewed_by: str = ""
    license_note: str = ""
    video_id: str = ""
    title: str
    channel: str
    url: str
    thumbnail_url: str
    duration: str = ""
    start_seconds: int = 0
    end_seconds: int | None = None
    # How the start time was found: the video's own chapters, an AI index, or not at all.
    timing: Literal["chapter", "indexed", "whole_video"] = "whole_video"
    chapter_title: str = ""
    relevance: list[str] = Field(default_factory=list)


class GuideStep(BaseModel):
    key: str = Field(description="Stable id of the step (its technique module), used to save ticks.")
    number: int
    phase: Phase
    phase_label: str
    title: str
    module_slug: str
    module_title: str
    why: str = Field(description="Why this step is in the guide, in terms of the design.")
    instructions: list[str]
    depends_on: list[str] = Field(default_factory=list)
    preconditions: list[str] = Field(default_factory=list)
    target_piece: str = ""
    source_hash: str = ""
    instruction_source: str = "library"
    tips: list[str] = Field(default_factory=list)
    fabric_tips: list[str] = Field(default_factory=list)
    video: GuideVideo | None = None
    more_videos: list[GuideVideo] = Field(default_factory=list)
    video_status: Literal["found", "none", "not_connected"] = "not_connected"
    search_query: str = ""
    search_url: str = ""


class FabricCard(BaseModel):
    """Machine settings for the main fabric. Starting points: always sew a scrap first."""

    fabric: str
    needle: str
    thread: str
    stitch_length: str
    seam_types: list[str]
    pressing: str
    notes: list[str] = Field(default_factory=list)


class StitchingGuideOutput(BaseModel):
    garment: GarmentComponents
    plan_version: str = ""
    requires_confirmation: bool = False
    media_policy: str = "Technique demonstrations on example pieces, linked to this garment's steps."
    fabric_card: FabricCard | None = None
    # Advice for the main fabric that covers a whole phase (shown under the phase heading), by phase.
    phase_tips: dict[Phase, list[str]] = Field(default_factory=dict)
    steps: list[GuideStep]
    # Where the steps came from: "technique library" (database) or "built-in library" (files).
    knowledge_source: str = "built-in library"
    video_source: str = "not connected"
    video_connected: bool = False
    video_language: str = "any"
    notes: list[str] = Field(default_factory=list)


class ProgressUpdate(BaseModel):
    version_number: int = Field(ge=1)
    step_key: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    done: bool


class ProgressState(BaseModel):
    version_number: int
    done_keys: list[str]
