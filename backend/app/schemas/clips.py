"""A reviewed clip catalog. Empty catalogs are valid; fictional media is never seeded."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator
from app.schemas.design_spec import ConstructionChoices


class CuratedClip(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=100)
    module_slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    module_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    title: str = Field(min_length=1, max_length=200)
    source: Literal["youtube", "hosted"]
    video_id: str = ""
    media_url: str = ""
    source_url: str = Field(min_length=1)
    channel: str = ""
    thumbnail_url: str = ""
    start_seconds: int = Field(default=0, ge=0)
    end_seconds: int = Field(gt=0)
    language: Literal["en", "hi", "any"] = "any"
    fabric_constructions: list[Literal["woven", "knit"]] = Field(default_factory=list)
    fabric_classes: list[str] = Field(default_factory=list)
    fabric_weights: list[Literal["light", "medium", "heavy"]] = Field(default_factory=list)
    garment_families: list[str] = Field(default_factory=list)
    required_features: list[str] = Field(default_factory=list)
    excluded_features: list[str] = Field(default_factory=list)
    required_choices: dict[str, str] = Field(default_factory=dict)
    requires_completed: list[str] = Field(default_factory=list)
    entry_state: str = ""
    exit_state: str = ""
    review_status: Literal["draft", "approved", "rejected"] = "draft"
    reviewed_by: str = ""
    reviewed_at: datetime | None = None
    rights: Literal["owned", "licensed", "youtube_embed"]
    license_note: str = ""

    @field_validator("source_url", "media_url", "thumbnail_url")
    @classmethod
    def https_only(cls, value: str) -> str:
        if value:
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Media references must be HTTPS URLs without credentials.")
        return value

    @model_validator(mode="after")
    def compatible_source(self):
        import re
        if self.end_seconds <= self.start_seconds:
            raise ValueError("The clip must end after its start.")
        if self.source == "youtube":
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", self.video_id) or self.media_url or self.rights != "youtube_embed":
                raise ValueError("YouTube clips need a video id and embedding rights; do not provide downloaded media.")
        elif not self.media_url or self.rights == "youtube_embed":
            raise ValueError("Hosted clips need an owned or licensed HTTPS media URL.")
        if self.source == "hosted":
            host = urlparse(self.media_url).hostname or ""
            if any(host == h or host.endswith("." + h) for h in ("youtube.com", "youtu.be", "googlevideo.com")):
                raise ValueError("Use the official embed for YouTube footage.")
        if set(self.required_choices) - set(ConstructionChoices.model_fields):
            raise ValueError("Unknown construction choice in clip metadata.")
        ConstructionChoices.model_validate(self.required_choices)
        if self.review_status == "approved" and not (
            self.reviewed_by.strip() and self.reviewed_at and self.reviewed_at.tzinfo
            and self.license_note.strip() and self.entry_state.strip() and self.exit_state.strip()
        ):
            raise ValueError("Approved clips require a dated reviewer, rights provenance, and entry/exit states.")
        return self
