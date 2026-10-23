"""Request and response shapes for onboarding, verification requests, warnings and suspensions, and
the admin panel (Phase 6E)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.social import PersonSummary

OnboardingStep = Literal["profile", "avatar", "interests", "follow", "tour", "done"]
VerificationStatus = Literal["pending", "approved", "rejected"]
ReportStatus = Literal["open", "reviewing", "resolved", "dismissed"]


def _clean_list(values: list[str]) -> list[str]:
    out: dict[str, None] = {}
    for v in values or []:
        text = " ".join(str(v).split())[:40]
        if text:
            out.setdefault(text, None)
    return list(out)


# ---------- onboarding ----------


class Interests(BaseModel):
    garments: list[str] = Field(default_factory=list, max_length=30)
    fabrics: list[str] = Field(default_factory=list, max_length=30)
    styles: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("garments", "fabrics", "styles", mode="before")
    @classmethod
    def _clean(cls, value: list[str]) -> list[str]:
        return _clean_list(value)


class Onboarding(BaseModel):
    step: OnboardingStep
    interests: Interests
    completed: bool
    skipped: bool
    has_profile: bool
    # True once they opened the welcome steps (there is a saved row).
    started: bool = False
    # True for someone who has never started onboarding and has no profile yet (open it for them once).
    is_new: bool


class OnboardingUpdate(BaseModel):
    step: OnboardingStep | None = None
    interests: Interests | None = None


class SuggestedPerson(PersonSummary):
    """Someone to follow, suggested during onboarding."""

    role: str
    is_private: bool
    follower_count: int
    post_count: int


# ---------- warnings, suspensions, verification ----------


class Suspension(BaseModel):
    id: str
    reason: str
    starts_at: str
    # Null = permanent.
    ends_at: str | None
    permanent: bool


class Warning(BaseModel):
    id: str
    reason: str
    created_at: str


class VerificationRequestCreate(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)
    portfolio_url: str = Field(default="", max_length=300)

    @field_validator("reason", "portfolio_url", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("portfolio_url")
    @classmethod
    def _url(cls, value: str) -> str:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("The portfolio link must start with http:// or https://")
        return value


class VerificationRequest(BaseModel):
    id: str
    reason: str
    portfolio_url: str
    status: VerificationStatus
    review_note: str
    created_at: str
    reviewed_at: str | None = None
    person: PersonSummary | None = None


class VerificationState(BaseModel):
    verified: bool
    # 'admin' or 'premium' when verified.
    source: str | None = None
    latest_request: VerificationRequest | None = None


# ---------- admin ----------


class AdminStats(BaseModel):
    total_users: int
    new_users_this_week: int
    profiles: int
    published_posts: int
    open_reports: int
    open_problem_reports: int
    pending_verifications: int
    active_suspensions: int


class AdminReport(BaseModel):
    id: str
    target_type: Literal["post", "comment", "user", "message"]
    reason: str
    details: str
    excerpt: str
    status: ReportStatus
    created_at: str
    reporter: PersonSummary | None = None
    reported: PersonSummary | None = None
    reported_user_id: str | None = None
    post_id: str | None = None
    comment_id: str | None = None
    message_id: str | None = None
    # Is the reported post / comment / message still there?
    target_exists: bool
    # How many open reports there are about the same person.
    reports_about_person: int = 0
    resolution_note: str = ""
    resolved_at: str | None = None


class AdminNote(BaseModel):
    note: str = Field(default="", max_length=1000)


class WarnRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    report_id: str | None = None


class SuspendRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    # Null = permanent.
    days: int | None = Field(default=None, ge=1, le=365)
    report_id: str | None = None


class AdminSuspension(Suspension):
    person: PersonSummary | None = None
    user_id: str
    lifted_at: str | None = None


class AdminProblemReport(BaseModel):
    id: str
    category: str
    description: str
    page: str
    browser: str
    status: ReportStatus
    has_screenshot: bool
    created_at: str
    person: PersonSummary | None = None
    email: str | None = None


class ProblemStatusUpdate(BaseModel):
    status: ReportStatus
    note: str = Field(default="", max_length=1000)


class AdminAction(BaseModel):
    id: str
    action: str
    admin: PersonSummary | None = None
    target: PersonSummary | None = None
    note: str
    details: dict
    created_at: str
