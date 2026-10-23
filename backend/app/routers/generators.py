"""Generator routes: list generators, run one, retry, apply, run a package.

Every route needs a signed-in user; project routes only ever see that user's projects.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.generators.registry import BUILT_IN, GENERATORS, TUTORIAL_LANGUAGES, GeneratorInputError
from app.providers.base import ProviderError, UsageMeter
from app.routers.deps import Ctx, get_ctx
from app.schemas.api import (
    GenerateRequest,
    GenerationJob,
    GeneratorInfo,
    PackageRequest,
    PackageResult,
    ProviderOverview,
    ProviderStatus,
    UsageSummary,
)
from app.schemas.outputs import TailorSheetOutput, TutorialVideo
from app.services.generation import GeneratorUnavailableError, UnknownGeneratorError, start_of_today
from app.services.tailor_pdf import ReferenceImage, build_tailor_pdf
from app.services.tutorials import search_library
from app.storage.files import StorageError
from app.storage.repository import NotFoundError

router = APIRouter(prefix="/api", tags=["generators"])
Context = Annotated[Ctx, Depends(get_ctx)]


def _check_rate(ctx: Ctx, cost: int = 1) -> None:
    if not ctx.c.limiter.allow(ctx.user.id, cost):
        raise HTTPException(429, "Too many generation requests. Please wait a minute and try again.")


@router.get("/generators", response_model=list[GeneratorInfo])
def list_generators(ctx: Context) -> Any:
    out = []
    for g in GENERATORS:
        info = g.provider(ctx.c.providers) if g.provider else None
        available = g.run is not None
        out.append(
            GeneratorInfo(
                id=g.id, name=g.name, description=g.description, available=available, phase=g.phase,
                service=g.service, provider=info.name if info else None, is_mock=bool(info and info.is_mock),
                depends_on=g.depends_on,
                unavailable_reason=None if available else f"Planned for Phase {g.phase}",
                in_package_by_default=g.in_package_by_default,
            )
        )
    return out


@router.get("/providers", response_model=ProviderOverview)
def list_providers(ctx: Context) -> Any:
    p, settings = ctx.c.providers, ctx.c.settings
    rows = [
        ("Idea understanding and design planning", p.idea.info), ("Image generation (sketches, previews)", p.image.info),
        ("Fabric recommendation", p.fabric.info), ("Tools and materials", p.materials.info),
        ("Design ideas (variations, moodboard, embroidery)", p.ideas.info),
    ]
    statuses = [
        ProviderStatus(service=s, provider=i.name, is_mock=i.is_mock, configured=True, note=i.note, paid=i.paid)
        for s, i in rows
    ]
    statuses.append(
        ProviderStatus(service="Tutorial search", provider=p.tutorials.info.name, is_mock=False,
                       configured=p.tutorials.connected, note=p.tutorials.info.note, paid=False)
    )
    statuses.append(
        ProviderStatus(service="Cost, PDF, pattern assistance and storyboards", provider=BUILT_IN.name, is_mock=False,
                       configured=True, note="Ordinary code on your own prices and data. Free, no AI.")
    )
    statuses.append(
        ProviderStatus(service="Video generation", provider="none", is_mock=False, configured=False,
                       note="No provider set up. Instructional Video makes a free storyboard and script instead.")
    )
    statuses.append(
        ProviderStatus(service="Vision / sketch analysis", provider="none", is_mock=False, configured=False,
                       note="Not connected yet (later phase).")
    )
    return ProviderOverview(
        services=statuses,
        warnings=p.warnings,
        keys={
            "ANTHROPIC_API_KEY": bool(settings.anthropic_api_key),
            "GEMINI_API_KEY": bool(settings.gemini_api_key),
            "OPENAI_API_KEY": bool(settings.openai_api_key),
            "YOUTUBE_API_KEY": bool(settings.youtube_api_key),
        },
    )


@router.get("/tutorials/search", response_model=list[TutorialVideo])
def search_tutorials(ctx: Context, q: str = Query(min_length=2, max_length=120), language: str = "any") -> Any:
    """Learning Library search. Returns only videos the search provider really returned."""
    if not ctx.c.providers.tutorials.connected:
        raise HTTPException(503, "Tutorial search is not connected. The app owner needs to add a free "
                                 "YOUTUBE_API_KEY to the backend settings (see the README).")
    if language not in TUTORIAL_LANGUAGES:
        raise HTTPException(400, "language must be any, en or hi.")
    _check_rate(ctx)
    try:
        return search_library(q.strip(), ctx.c.providers.tutorials, UsageMeter(), language)
    except ProviderError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.get("/usage", response_model=UsageSummary)
def usage(ctx: Context) -> Any:
    """Estimated spending on paid AI. Totals are for the whole app (that is what the daily limit
    counts); the list of recent calls only shows your own."""
    totals = ctx.c.system.usage_totals(start_of_today())
    return UsageSummary(daily_budget_usd=ctx.c.settings.daily_budget_usd, recent=ctx.repo.recent_usage(), **totals)


@router.post("/projects/{project_id}/generate/{generator_id}", response_model=GenerationJob)
def generate(project_id: str, generator_id: str, body: GenerateRequest, ctx: Context) -> Any:
    ctx.repo.get_project(project_id)
    _check_rate(ctx)
    try:
        return ctx.generation.run(project_id, generator_id, body.options)
    except UnknownGeneratorError as exc:
        raise HTTPException(404, f"Unknown generator '{exc}'") from exc
    except GeneratorUnavailableError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/projects/{project_id}/jobs/{job_id}/retry", response_model=GenerationJob)
def retry_job(project_id: str, job_id: str, ctx: Context) -> Any:
    _check_rate(ctx)
    return ctx.generation.retry(project_id, job_id)


@router.post("/projects/{project_id}/jobs/{job_id}/apply")
def apply_design(project_id: str, job_id: str, ctx: Context) -> dict[str, int]:
    try:
        return {"version_number": ctx.generation.apply_design(project_id, job_id)}
    except GeneratorInputError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/jobs/{job_id}/tailor-sheet.pdf")
def tailor_sheet_pdf(
    project_id: str, job_id: str, ctx: Context,
    tz_offset: int = Query(0, ge=-840, le=840, description="The browser's Date.getTimezoneOffset(), in minutes."),
) -> Response:
    """Download a generated tailor sheet as an A4 PDF."""
    job = ctx.repo.get_job(project_id, job_id)
    if job.generator_id != "tailor_sheet" or job.status != "succeeded" or not job.output:
        raise HTTPException(400, "Only a successful tailor sheet can be exported as a PDF.")
    sheet = TailorSheetOutput.model_validate(job.output)
    images: list[ReferenceImage] = []
    for ref in sheet.references:
        try:
            asset, path = ctx.repo.get_asset_with_path(ref.asset_id)
        except NotFoundError:
            continue  # the picture was deleted after the sheet was made (or is not yours)
        if asset.project_id != job.project_id:
            continue  # never put another project's picture in this PDF
        try:
            data = ctx.c.store.get(path)
        except StorageError:
            data = None  # print the rest of the sheet; a note replaces the picture
        images.append(ReferenceImage(view=ref.view, note=ref.note, mime_type=asset.mime_type, data=data))
    # Timestamps are stored in UTC; print the date as it was for the person downloading.
    created = datetime.fromisoformat(job.created_at.replace("Z", "+00:00")).astimezone(UTC)
    created_on = (created - timedelta(minutes=tz_offset)).strftime("%d %b %Y")
    pdf = build_tailor_pdf(sheet, version_number=job.version_number, created_on=created_on, images=images)
    filename = "".join(ch for ch in sheet.title if ch.isalnum() or ch in "-_ ").strip() or "tailor-sheet"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename} - tailor sheet v{job.version_number}.pdf"'},
    )


@router.delete("/projects/{project_id}/jobs/{job_id}", status_code=204)
def delete_job(project_id: str, job_id: str, ctx: Context) -> Response:
    ctx.repo.delete_job(project_id, job_id)
    return Response(status_code=204)


@router.post("/projects/{project_id}/package", response_model=PackageResult)
def generate_package(project_id: str, body: PackageRequest, ctx: Context) -> Any:
    ctx.repo.get_project(project_id)
    _check_rate(ctx, cost=len(body.generator_ids))
    return ctx.generation.run_package(project_id, body.generator_ids, body.options)
