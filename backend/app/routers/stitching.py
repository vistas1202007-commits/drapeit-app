"""Stitching Guide checklist: which steps a person has ticked, saved per design version."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.routers.deps import Ctx, get_ctx
from app.schemas.stitching import ProgressState, ProgressUpdate

router = APIRouter(prefix="/api", tags=["stitching guide"])
Context = Annotated[Ctx, Depends(get_ctx)]


@router.get("/projects/{project_id}/stitching-progress", response_model=ProgressState)
def get_progress(project_id: str, ctx: Context, version: int = Query(ge=1)) -> Any:
    return ProgressState(version_number=version, done_keys=ctx.repo.stitch_progress(project_id, version))


@router.put("/projects/{project_id}/stitching-progress", response_model=ProgressState)
def set_progress(project_id: str, body: ProgressUpdate, ctx: Context) -> Any:
    done = ctx.repo.set_stitch_step(project_id, body.version_number, body.step_key, body.done)
    return ProgressState(version_number=body.version_number, done_keys=done)
