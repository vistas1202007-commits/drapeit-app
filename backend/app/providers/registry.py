"""Chooses which provider each service uses, based on settings.

LANGUAGE_PROVIDER (design planning, fabrics, materials):
    "auto"      -> the Anthropic API if ANTHROPIC_API_KEY is set, otherwise the free mock
    "anthropic" -> the Anthropic API (falls back to the mock, with a warning, if no key)
    The Anthropic API also needs ANTHROPIC_MODEL; without it the mock is used, with a warning.
    "mock"      -> always the free mock

IMAGE_PROVIDER (sketches and visual previews):
    "auto"   -> Gemini if GEMINI_API_KEY is set, else OpenAI if OPENAI_API_KEY is set, else mock
    "gemini" / "openai" -> that provider (falls back to the mock, with a warning, if no key)
    "mock"   -> always the free built-in SVG drawer

TUTORIAL_PROVIDER (Generate Tutorial and the Learning Library):
    "auto" / "youtube" -> YouTube Data API if YOUTUBE_API_KEY is set, otherwise "not connected"
    "mock"   -> always "not connected" (search links only, never made-up videos)

Design ideas (variations, moodboard, embroidery) follow LANGUAGE_PROVIDER.
Instructional videos have no provider yet: the generator makes a storyboard instead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.config import Settings
from app.providers.base import (
    DesignIdeasProvider,
    FabricRecommendationProvider,
    IdeaUnderstandingProvider,
    ImageGenerationProvider,
    MaterialsProvider,
    TutorialSearchProvider,
)
from app.providers.mock.fabric import MockFabricProvider, MockMaterialsProvider
from app.providers.mock.idea import MockIdeaProvider
from app.providers.mock.ideas import MockIdeasProvider
from app.providers.mock.sketch import MockImageProvider
from app.providers.youtube import NoTutorialSearch

log = logging.getLogger(__name__)

LANGUAGE_CHOICES = {"auto", "mock", "anthropic"}
IMAGE_CHOICES = {"auto", "mock", "gemini", "openai"}
TUTORIAL_CHOICES = {"auto", "mock", "youtube"}


class ProviderConfigError(Exception):
    pass


@dataclass
class Providers:
    idea: IdeaUnderstandingProvider
    image: ImageGenerationProvider
    fabric: FabricRecommendationProvider
    materials: MaterialsProvider
    # Free rule-based checklist, used inside the tailor sheet when no saved
    # materials output exists (so building a sheet never costs money).
    builtin_materials: MaterialsProvider
    ideas: DesignIdeasProvider
    tutorials: TutorialSearchProvider
    # Problems with the setup worth showing on the AI Providers page.
    warnings: list[str] = field(default_factory=list)


def build_providers(settings: Settings) -> Providers:
    latency = settings.mock_latency_ms
    if settings.language_provider not in LANGUAGE_CHOICES:
        raise ProviderConfigError(
            f"LANGUAGE_PROVIDER={settings.language_provider!r} is not valid. Use one of: {sorted(LANGUAGE_CHOICES)}"
        )
    if settings.image_provider not in IMAGE_CHOICES:
        raise ProviderConfigError(
            f"IMAGE_PROVIDER={settings.image_provider!r} is not valid. Use one of: {sorted(IMAGE_CHOICES)}"
        )
    if settings.tutorial_provider not in TUTORIAL_CHOICES:
        raise ProviderConfigError(
            f"TUTORIAL_PROVIDER={settings.tutorial_provider!r} is not valid. Use one of: {sorted(TUTORIAL_CHOICES)}"
        )
    warnings: list[str] = []
    mock_materials = MockMaterialsProvider(latency)
    providers = Providers(
        idea=MockIdeaProvider(latency),
        image=MockImageProvider(latency),
        fabric=MockFabricProvider(latency),
        materials=mock_materials,
        builtin_materials=mock_materials,
        ideas=MockIdeasProvider(latency),
        tutorials=NoTutorialSearch(),
        warnings=warnings,
    )

    # ----- language (Anthropic API) -----
    want_anthropic = settings.language_provider == "anthropic" or (
        settings.language_provider == "auto" and settings.anthropic_api_key
    )
    if want_anthropic and not settings.anthropic_api_key:
        warnings.append("LANGUAGE_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is empty, so the mock is used.")
    elif want_anthropic and not settings.anthropic_model:
        warnings.append("ANTHROPIC_API_KEY is set but ANTHROPIC_MODEL is empty, so the mock is used.")
    elif want_anthropic:
        from app.providers.anthropic_provider import (
            AnthropicClient,
            AnthropicFabricProvider,
            AnthropicIdeaProvider,
            AnthropicIdeasProvider,
            AnthropicMaterialsProvider,
        )

        client = AnthropicClient(settings.anthropic_api_key or "", settings.anthropic_model, settings.anthropic_effort)
        providers.idea = AnthropicIdeaProvider(client)
        providers.fabric = AnthropicFabricProvider(client)
        providers.materials = AnthropicMaterialsProvider(client)
        providers.ideas = AnthropicIdeasProvider(client)

    # ----- tutorial search (free quota, no billing) -----
    if settings.tutorial_provider != "mock" and settings.youtube_api_key:
        from app.providers.youtube import YouTubeSearchProvider

        providers.tutorials = YouTubeSearchProvider(settings.youtube_api_key)
    elif settings.tutorial_provider == "youtube":
        warnings.append("TUTORIAL_PROVIDER is 'youtube' but YOUTUBE_API_KEY is empty, so tutorial search is off.")

    # ----- images -----
    choice = settings.image_provider
    if choice == "auto":
        choice = "gemini" if settings.gemini_api_key else "openai" if settings.openai_api_key else "mock"
    if choice == "gemini":
        if settings.gemini_api_key:
            from app.providers.image_providers import GeminiImageProvider

            providers.image = GeminiImageProvider(settings.gemini_api_key, settings.gemini_image_model)
        else:
            warnings.append("IMAGE_PROVIDER is 'gemini' but GEMINI_API_KEY is empty, so the mock is used.")
    elif choice == "openai":
        if settings.openai_api_key:
            from app.providers.image_providers import OpenAIImageProvider

            providers.image = OpenAIImageProvider(
                settings.openai_api_key, settings.openai_image_model, settings.openai_image_quality
            )
        else:
            warnings.append("IMAGE_PROVIDER is 'openai' but OPENAI_API_KEY is empty, so the mock is used.")

    for w in warnings:
        log.warning(w)
    for name, p in (("idea", providers.idea), ("image", providers.image)):
        log.info("Provider for %s: %s%s", name, p.info.name, " (mock)" if p.info.is_mock else "")
    return providers
