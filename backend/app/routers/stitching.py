"""Stitching Guide checklist: which steps a person has ticked, saved per design version."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg.errors import UndefinedTable

from app.routers.deps import Ctx, get_ctx
from app.schemas.stitching import ProgressState, ProgressUpdate

router = APIRouter(prefix="/api", tags=["stitching guide"])
Context = Annotated[Ctx, Depends(get_ctx)]


def _needs_migration() -> HTTPException:
    return HTTPException(503, "The checklist needs one database update first: run "
                              "supabase/migrations/0012_stitching_guide.sql in Supabase (see the README, Stitching Guide).")


@router.get("/projects/{project_id}/stitching-progress", response_model=ProgressState)
def get_progress(project_id: str, ctx: Context, version: int = Query(ge=1)) -> Any:
    try:
        return ProgressState(version_number=version, done_keys=ctx.repo.stitch_progress(project_id, version))
    except UndefinedTable as exc:
        raise _needs_migration() from exc


@router.put("/projects/{project_id}/stitching-progress", response_model=ProgressState)
def set_progress(project_id: str, body: ProgressUpdate, ctx: Context) -> Any:
    if not ctx.c.social_limiter.allow(ctx.user.id):
        raise HTTPException(429, "You are ticking very fast. Please wait a moment and try again.")
    try:
        done = ctx.repo.set_stitch_step(project_id, body.version_number, body.step_key, body.done)
    except UndefinedTable as exc:
        raise _needs_migration() from exc
    return ProgressState(version_number=body.version_number, done_keys=done)
