"""Google Gemini helpers for the Stitching Guide.

* `GeminiPhotoProvider` reads a reference photo of a garment (what the neckline, sleeves, skirt look like).
* `GeminiEmbedder` turns text into numbers so the technique library can be searched by meaning.
* `GeminiVideoIndexer` watches a YouTube video once and says at which seconds each technique is shown.

All three use GEMINI_API_KEY from backend/.env. Prices below are rough estimates, used only by the
daily spending limit; check Google's pricing page for the real ones.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Literal

from pydantic import BaseModel

from app.providers.base import ProviderError, ProviderInfo, UsageMeter, VideoSegment
from app.providers.photo import PHOTO_PROMPT, PhotoAnswer
from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import PhotoHints

log = logging.getLogger(__name__)

# US dollars per million tokens (input, output) for Gemini text/vision/video models. A deliberate over-estimate.
GEMINI_TEXT_PRICE = (0.50, 3.00)
# A YouTube video read at low picture quality costs roughly this many input tokens per second of video.
VIDEO_TOKENS_PER_SECOND = 100
EMBED_DIMENSIONS = 768
MAX_INDEXED_VIDEO_SECONDS = 30 * 60


def _client(api_key: str) -> Any:
    from google import genai  # imported here so the app still starts if the package is missing

    return genai.Client(api_key=api_key)


def _raise_friendly(exc: Exception, what: str, model: str) -> None:
    """Turn a Gemini SDK error into a ProviderError whose message is safe to show."""
    from google.genai import errors

    if isinstance(exc, errors.ClientError):
        if exc.code in (401, 403) or "api key" in str(exc.message).lower():
            raise ProviderError("Gemini rejected the API key. Check GEMINI_API_KEY in backend/.env.") from exc
        if exc.code == 429:
            raise ProviderError("Gemini quota reached. Wait a minute and retry.") from exc
        if exc.code == 404:
            raise ProviderError(f"Gemini model '{model}' was not found. Check the Gemini model names in backend/.env.") from exc
        raise ProviderError(f"Gemini could not accept the {what} request: {exc.message}") from exc
    if isinstance(exc, errors.ServerError):
        raise ProviderError(f"Gemini had a server problem ({exc.code}). Please retry.") from exc
    raise ProviderError("Could not connect to Gemini. Check your internet connection.") from exc


def _usage_cost(response: Any) -> tuple[float, int, int]:
    usage = getattr(response, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0)
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0)
    price_in, price_out = GEMINI_TEXT_PRICE
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000, tokens_in, tokens_out


class GeminiPhotoProvider:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = _client(api_key)
        self.model = model
        self.info = ProviderInfo(
            name=f"gemini ({model})", is_mock=False, paid=True, estimated_cost_usd=0.01,
            note="Real AI: Google Gemini reads the reference photo. Costs a little money per photo.",
        )

    def read_photo(self, image: bytes, mime_type: str, spec: DesignSpec, meter: UsageMeter) -> PhotoHints:
        from google.genai import types

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[types.Part.from_bytes(data=image, mime_type=mime_type), PHOTO_PROMPT],
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=PhotoAnswer),
            )
        except Exception as exc:  # noqa: BLE001 - mapped to a friendly message below
            _raise_friendly(exc, "photo", self.model)
        cost, tokens_in, tokens_out = _usage_cost(response)
        meter.add(cost, f"Gemini reference photo: {tokens_in} in / {tokens_out} out tokens ({self.model})")
        parsed = response.parsed
        if not isinstance(parsed, PhotoAnswer):
            raise ProviderError("Gemini's answer about the photo was not in the expected format.")
        return PhotoHints(**parsed.model_dump())


class GeminiEmbedder:
    """Text -> list of numbers, for searching the technique library by meaning."""

    dimensions = EMBED_DIMENSIONS

    def __init__(self, api_key: str, model: str) -> None:
        self.client = _client(api_key)
        self.model = model
        self.info = ProviderInfo(
            name=f"gemini ({model})", is_mock=False, paid=False,
            note="Gemini text embeddings. Free within Google's free tier.",
        )

    def embed(self, texts: list[str], purpose: Literal["document", "query"] = "document") -> list[list[float]]:
        from google.genai import types

        if not texts:
            return []
        try:
            result = self.client.models.embed_content(
                model=self.model, contents=texts,
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT" if purpose == "document" else "RETRIEVAL_QUERY",
                    output_dimensionality=self.dimensions,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _raise_friendly(exc, "embedding", self.model)
        vectors = [list(e.values or []) for e in result.embeddings or []]
        if len(vectors) != len(texts) or any(len(v) != self.dimensions for v in vectors):
            raise ProviderError("Gemini returned embeddings in an unexpected shape.")
        return [_normalise(v) for v in vectors]  # smaller-than-full embeddings are not unit length by themselves


def _normalise(vector: list[float]) -> list[float]:
    length = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / length for x in vector]


class _SegmentAnswer(BaseModel):
    technique: str
    shown: bool
    start_seconds: int
    end_seconds: int


class _IndexAnswer(BaseModel):
    segments: list[_SegmentAnswer]


INDEX_PROMPT = """You are watching a sewing tutorial. Below is a list of techniques, each as "slug: title". \\
For each technique, say whether the video really shows it being done. If it does, give the second where the \\
demonstration starts and the second where it ends. If it does not, set shown to false and both times to 0. \\
Use the exact slug in the technique field. Do not guess: only report what you can see and hear.

Techniques:
{topics}"""


class GeminiVideoIndexer:
    """Watches a YouTube video once and finds where each technique is shown."""

    def __init__(self, api_key: str, model: str) -> None:
        self.client = _client(api_key)
        self.model = model
        self.info = ProviderInfo(
            name=f"gemini ({model})", is_mock=False, paid=True, estimated_cost_usd=0.10,
            note="Real AI: Gemini watches a tutorial video once to find where each step starts. Costs money per video.",
        )

    @staticmethod
    def estimate_cost(duration_seconds: int) -> float:
        return duration_seconds * VIDEO_TOKENS_PER_SECOND * GEMINI_TEXT_PRICE[0] / 1_000_000

    def index(self, video_id: str, duration_seconds: int, topics: list[tuple[str, str]],
              meter: UsageMeter) -> list[VideoSegment]:
        """Return a checked segment for each technique the video really shows."""
        from google.genai import types

        prompt = INDEX_PROMPT.format(topics="\n".join(f"{slug}: {title}" for slug, title in topics))
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=types.Content(parts=[
                    types.Part(file_data=types.FileData(file_uri=f"https://www.youtube.com/watch?v={video_id}")),
                    types.Part(text=prompt),
                ]),
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=_IndexAnswer,
                    media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            _raise_friendly(exc, "video", self.model)
        cost, tokens_in, tokens_out = _usage_cost(response)
        meter.add(cost, f"Gemini video index {video_id}: {tokens_in} in / {tokens_out} out tokens ({self.model})")
        parsed = response.parsed
        if not isinstance(parsed, _IndexAnswer):
            raise ProviderError("Gemini's answer about the video was not in the expected format.")
        return checked_segments(parsed.segments, {slug for slug, _ in topics}, duration_seconds)


def checked_segments(answers: list[Any], known_slugs: set[str], duration_seconds: int) -> list[VideoSegment]:
    """Keep only segments that make sense for this video. A model's times are never trusted blindly."""
    out: dict[str, VideoSegment] = {}
    for a in answers:
        if not a.shown or a.technique not in known_slugs or a.technique in out:
            continue
        start, end = int(a.start_seconds), int(a.end_seconds)
        if start < 0 or end <= start or start >= duration_seconds:
            continue
        out[a.technique] = VideoSegment(module_slug=a.technique, start_seconds=start, end_seconds=min(end, duration_seconds))
    return list(out.values())
