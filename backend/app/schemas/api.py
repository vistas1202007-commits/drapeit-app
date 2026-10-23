"""Request and response shapes for the HTTP API.

FastAPI uses these classes to validate what comes in and to document what goes
out (open http://localhost:8000/docs to see them).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.design_spec import DesignSpec

JobStatus = Literal["running", "succeeded", "failed"]
AssetKind = Literal["upload", "sketch", "generated"]
MessageRole = Literal["user", "assistant"]


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    garment_category: str = Field(default="", max_length=60)
    idea: str = Field(default="", max_length=4000)


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)


class ProjectSummary(BaseModel):
    id: str
    title: str
    garment_category: str
    current_version: int
    thumbnail_asset_id: str | None
    output_count: int
    created_at: str
    updated_at: str


class DesignVersion(BaseModel):
    id: str
    project_id: str
    version_number: int
    spec: DesignSpec
    note: str
    created_at: str


class VersionCreate(BaseModel):
    spec: DesignSpec
    note: str = Field(default="", max_length=200)


class NotebookMessage(BaseModel):
    id: str
    project_id: str
    role: MessageRole
    content: str
    is_mock: bool
    created_at: str


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class GenerationJob(BaseModel):
    id: str
    project_id: str
    generator_id: str
    version_number: int
    status: JobStatus
    provider: str
    is_mock: bool
    output: dict[str, Any] | None
    error: str | None
    created_at: str
    finished_at: str | None
    # Filled in when returned with a project: True if the design changed in a
    # way that affects this output since it was generated.
    stale: bool = False
    stale_fields: list[str] = Field(default_factory=list)


class Asset(BaseModel):
    id: str
    project_id: str
    kind: AssetKind
    filename: str
    mime_type: str
    size_bytes: int
    created_at: str
    # Only set for generated pictures.
    job_id: str | None = None
    generator_id: str | None = None
    version_number: int | None = None
    provider: str | None = None
    is_mock: bool = False


class CanvasDocument(BaseModel):
    """The editable drawing from the Design Studio (layers + strokes as JSON)."""

    data: dict[str, Any]
    updated_at: str | None = None


class ProjectDetail(BaseModel):
    project: ProjectSummary
    current_spec: DesignSpec
    versions: list[DesignVersion]
    messages: list[NotebookMessage]
    jobs: list[GenerationJob]
    assets: list[Asset]


class GenerateRequest(BaseModel):
    # Optional extra options, e.g. {"style": "ink"} for the sketch generator.
    options: dict[str, Any] = Field(default_factory=dict)


class PackageRequest(BaseModel):
    generator_ids: list[str] = Field(min_length=1, max_length=20)
    options: dict[str, dict[str, Any]] = Field(default_factory=dict)


class PackageStepResult(BaseModel):
    generator_id: str
    status: Literal["succeeded", "failed", "skipped"]
    job_id: str | None = None
    reason: str | None = None


class PackageResult(BaseModel):
    steps: list[PackageStepResult]


class GeneratorInfo(BaseModel):
    id: str
    name: str
    description: str
    available: bool
    phase: int
    service: str
    provider: str | None
    is_mock: bool
    depends_on: list[str]
    unavailable_reason: str | None
    in_package_by_default: bool


class ProviderStatus(BaseModel):
    service: str
    provider: str
    is_mock: bool
    configured: bool
    note: str
    paid: bool = False


class ProviderOverview(BaseModel):
    services: list[ProviderStatus]
    warnings: list[str]
    keys: dict[str, bool]  # which API keys are set (never the keys themselves)


class UsageSummary(BaseModel):
    today_usd: float
    total_usd: float
    daily_budget_usd: float
    paid_calls_today: int
    paid_calls_total: int
    recent: list[dict[str, Any]]
