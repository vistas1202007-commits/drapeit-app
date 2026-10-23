"""Request and response shapes for account settings, extra privacy controls, "Your activity"
and Help (Phase 6D)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.admin import Suspension, Warning
from app.schemas.social import PersonSummary

Audience = Literal["everyone", "followers", "nobody"]
ProblemCategory = Literal["bug", "account", "design_tools", "social", "payments", "other"]

GRACE_DAYS = 30
MAX_HIDDEN_WORDS = 100


class AccountStatus(BaseModel):
    email: str
    has_profile: bool
    username: str | None = None
    deactivated: bool = False
    # Set while the account waits to be deleted; it is deleted for good on delete_after.
    delete_requested_at: str | None = None
    delete_after: str | None = None
    # Phase 6E
    is_admin: bool = False
    suspension: Suspension | None = None
    warnings: list[Warning] = Field(default_factory=list)


class DeleteAccountRequest(BaseModel):
    # Your username (or your email if you never made a profile), typed to confirm.
    confirm: str = Field(min_length=1, max_length=320)


class PrivacyChoices(BaseModel):
    allow_comments_from: Audience = "everyone"
    allow_mentions_from: Audience = "everyone"
    hidden_words: list[str] = Field(default_factory=list, max_length=MAX_HIDDEN_WORDS)

    @field_validator("hidden_words", mode="before")
    @classmethod
    def _clean_words(cls, value: list[str]) -> list[str]:
        """Trimmed, lowercase, no empty ones, no repeats, each at most 30 characters."""
        seen: dict[str, None] = {}
        for word in value or []:
            w = " ".join(str(word).split()).lower()
            if len(w) > 30:
                raise ValueError("Each hidden word can be at most 30 characters.")
            if w:
                seen.setdefault(w, None)
        return list(seen)


class SearchEntry(BaseModel):
    id: str
    query: str
    created_at: str


class SearchSave(BaseModel):
    query: str = Field(min_length=2, max_length=60)

    @field_validator("query", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return " ".join(str(value or "").split())


class TimePing(BaseModel):
    # Today's date where the user is (their own time zone).
    day: date


class TimeDay(BaseModel):
    day: str
    seconds: int


class MyComment(BaseModel):
    id: str
    body: str
    approved: bool
    created_at: str
    post_id: str
    post_image_id: str | None = None
    # The post's designer (null if you may no longer see them).
    post_author: PersonSummary | None = None


class MyCommentPage(BaseModel):
    comments: list[MyComment]
    next_cursor: str | None = None


class ProblemReceipt(BaseModel):
    id: str
    created_at: str
