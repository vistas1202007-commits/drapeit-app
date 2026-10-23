"""Provider interfaces.

A *service* is a job the app needs done (understand an idea, draw a sketch,
recommend fabrics). A *provider* is who actually does it: a mock, the Anthropic API, an
image API, and so on.

Generators only talk to these interfaces, never to a specific company's SDK.
To add a real provider, write a new class with the same methods and register
it in `app/providers/registry.py`. Nothing else has to change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    DesignConceptOutput,
    EmbroideryOutput,
    FabricOutput,
    MaterialsOutput,
    MoodboardOutput,
    SketchStyle,
    VariationsOutput,
)


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    is_mock: bool
    note: str = ""
    # True when calling this provider costs real money.
    paid: bool = False
    # A rough upper estimate of one call, used by the daily spending limit
    # before the call is made. The real cost is recorded after the call.
    estimated_cost_usd: float = 0.0


class ProviderError(Exception):
    """A provider failed. The message is safe to show to the user."""


@dataclass
class UsageMeter:
    """Collects what one generator run cost, so it can be saved in provider_usage."""

    cost_usd: float = 0.0
    details: list[str] = field(default_factory=list)

    def add(self, cost_usd: float, detail: str) -> None:
        self.cost_usd += cost_usd
        self.details.append(detail)


ImagePurpose = Literal["sketch", "preview"]


@dataclass(frozen=True)
class ImageRequest:
    prompt: str
    spec: DesignSpec
    purpose: ImagePurpose
    style: SketchStyle | None = None


@dataclass(frozen=True)
class GeneratedImage:
    """Raw image from a provider. Exactly one of `data` or `svg` is set."""

    mime_type: str
    data: bytes | None = None
    svg: str | None = None
    caption: str = ""


class IdeaUnderstandingProvider(Protocol):
    info: ProviderInfo

    def analyse_idea(self, idea: str, current: DesignSpec, meter: UsageMeter) -> DesignConceptOutput: ...


class ImageGenerationProvider(Protocol):
    info: ProviderInfo

    def generate_image(self, request: ImageRequest, meter: UsageMeter) -> GeneratedImage: ...


class FabricRecommendationProvider(Protocol):
    info: ProviderInfo

    def recommend_fabrics(self, spec: DesignSpec, meter: UsageMeter) -> FabricOutput: ...


class MaterialsProvider(Protocol):
    info: ProviderInfo

    def tools_and_materials(self, spec: DesignSpec, meter: UsageMeter) -> MaterialsOutput: ...


class DesignIdeasProvider(Protocol):
    """Phase 4: alternatives and inspiration for an existing design."""

    info: ProviderInfo

    def variations(self, spec: DesignSpec, meter: UsageMeter) -> VariationsOutput: ...

    def moodboard(self, spec: DesignSpec, meter: UsageMeter) -> MoodboardOutput: ...

    def embroidery(self, spec: DesignSpec, meter: UsageMeter) -> EmbroideryOutput: ...


@dataclass(frozen=True)
class VideoResult:
    """One video exactly as the search provider returned it."""

    video_id: str
    title: str
    channel: str
    description: str
    published_at: str
    thumbnail_url: str
    duration_seconds: int | None = None


class TutorialSearchProvider(Protocol):
    info: ProviderInfo
    # False when no real search service is connected (then search returns nothing).
    connected: bool

    def search(self, query: str, max_results: int, language: str, meter: UsageMeter) -> list[VideoResult]: ...
