"""Project routes: create, list, open, rename, duplicate, delete, export,
design versions, notebook messages, canvas and uploaded images.

Every route needs a signed-in user and only ever sees that user's projects.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile

from app.auth import make_media_token, read_media_token
from app.routers.deps import SIGN_IN_HEADERS, Ctx, current_user, get_container, get_ctx
from app.schemas.api import (
    Asset,
    CanvasDocument,
    DesignVersion,
    MessageCreate,
    NotebookMessage,
    ProjectCreate,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdate,
    VersionCreate,
)
from app.schemas.design_spec import DesignSpec
from app.services.uploads import ALLOWED, UploadError, safe_display_name, validate_image
from app.storage.repository import new_id

router = APIRouter(prefix="/api", tags=["projects"])
Context = Annotated[Ctx, Depends(get_ctx)]

MAX_CANVAS_BYTES = 4 * 1024 * 1024


def _title(value: str) -> str:
    title = value.strip()
    if not title:
        raise HTTPException(422, "Please give the design a name.")
    return title


def _detail(ctx: Ctx, project_id: str) -> ProjectDetail:
    project = ctx.repo.get_project(project_id)
    versions = ctx.repo.list_versions(project_id)
    current = next(v for v in versions if v.version_number == project.current_version)
    jobs = ctx.generation.mark_stale(project_id, ctx.repo.list_jobs(project_id), current.spec)
    return ProjectDetail(
        project=project,
        current_spec=current.spec,
        versions=versions,
        messages=ctx.repo.list_messages(project_id),
        jobs=jobs,
        assets=ctx.repo.list_assets(project_id),
    )


# ---------- signed links for pictures ----------


@router.get("/media-token")
def media_token(c: Annotated[Any, Depends(get_container)], user: Annotated[Any, Depends(current_user)]) -> dict[str, str]:
    """A short-lived token for <img> tags, which cannot send the sign-in header."""
    token, expires = make_media_token(user.id, c.settings.media_token_secret, c.settings.media_token_ttl_s)
    return {"token": token, "expires_at": datetime.fromtimestamp(expires, UTC).isoformat().replace("+00:00", "Z")}


# ---------- projects ----------


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(ctx: Context, search: str = Query("", max_length=100), garment_category: str = "") -> Any:
    return ctx.repo.list_projects(search.strip(), garment_category.strip())


@router.post("/projects", response_model=ProjectSummary, status_code=201)
def create_project(body: ProjectCreate, ctx: Context) -> Any:
    title = _title(body.title)
    spec = DesignSpec(title=title, garment_category=body.garment_category.strip(), idea=body.idea)
    project = ctx.repo.create_project(title, body.garment_category.strip(), spec)
    if body.idea.strip():
        ctx.repo.add_message(project.id, "user", body.idea.strip())
    return project


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, ctx: Context) -> Any:
    return _detail(ctx, project_id)


@router.patch("/projects/{project_id}", response_model=ProjectSummary)
def update_project(project_id: str, body: ProjectUpdate, ctx: Context) -> Any:
    if body.title is None:
        return ctx.repo.get_project(project_id)
    return ctx.repo.rename_project(project_id, _title(body.title))


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, ctx: Context) -> Response:
    ctx.c.store.delete(ctx.repo.delete_project(project_id))
    return Response(status_code=204)


@router.post("/projects/{project_id}/duplicate", response_model=ProjectSummary, status_code=201)
def duplicate_project(project_id: str, ctx: Context) -> Any:
    """Copy the current design spec, notes and canvas into a new project.
    Generated outputs and pictures are not copied; regenerate them in the copy if needed."""
    source = ctx.repo.get_project(project_id)
    spec = ctx.repo.current_version(project_id).spec
    copy = ctx.repo.create_project(f"{source.title} (copy)"[:120], source.garment_category, spec)
    for msg in ctx.repo.list_messages(project_id):
        ctx.repo.add_message(copy.id, msg.role, msg.content, msg.is_mock)
    canvas = ctx.repo.get_canvas(project_id)
    if canvas.updated_at:
        ctx.repo.save_canvas(copy.id, canvas.data)
    return ctx.repo.get_project(copy.id)


@router.get("/projects/{project_id}/export")
def export_project(project_id: str, ctx: Context) -> Response:
    """Download the whole project (spec, versions, notes, outputs) as JSON."""
    detail = _detail(ctx, project_id)
    payload = {
        "format": "ai-fashion-notebook/project@2",
        "exported_from": "Drapeit by Vistas Atelier (Phase 5)",
        **detail.model_dump(mode="json"),
        "canvas": ctx.repo.get_canvas(project_id).model_dump(mode="json"),
    }
    filename = "".join(ch for ch in detail.project.title if ch.isalnum() or ch in "-_ ").strip() or "project"
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
    )


# ---------- design versions ----------


@router.post("/projects/{project_id}/versions", response_model=DesignVersion, status_code=201)
def save_version(project_id: str, body: VersionCreate, ctx: Context) -> Any:
    return ctx.repo.add_version(project_id, body.spec, body.note.strip() or "Edited design spec")


@router.post("/projects/{project_id}/versions/{version_number}/restore", response_model=DesignVersion)
def restore_version(project_id: str, version_number: int, ctx: Context) -> Any:
    """Restoring never deletes anything: it saves a copy of the old version as the newest one."""
    old = ctx.repo.get_version(project_id, version_number)
    return ctx.repo.add_version(project_id, old.spec, f"Restored from version {version_number}")


# ---------- notebook messages ----------


@router.post("/projects/{project_id}/messages", response_model=NotebookMessage, status_code=201)
def add_message(project_id: str, body: MessageCreate, ctx: Context) -> Any:
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "The note is empty.")
    return ctx.repo.add_message(project_id, "user", content)


@router.delete("/projects/{project_id}/messages/{message_id}", status_code=204)
def delete_message(project_id: str, message_id: str, ctx: Context) -> Response:
    ctx.repo.delete_message(project_id, message_id)
    return Response(status_code=204)


# ---------- canvas ----------


@router.get("/projects/{project_id}/canvas", response_model=CanvasDocument)
def get_canvas(project_id: str, ctx: Context) -> Any:
    return ctx.repo.get_canvas(project_id)


@router.put("/projects/{project_id}/canvas", response_model=CanvasDocument)
def save_canvas(project_id: str, body: CanvasDocument, ctx: Context) -> Any:
    if len(json.dumps(body.data)) > MAX_CANVAS_BYTES:
        raise HTTPException(413, "The drawing is too large to save (limit 4 MB). Try flattening imported images.")
    return ctx.repo.save_canvas(project_id, body.data)


# ---------- assets (uploaded references and saved sketches) ----------


@router.post("/projects/{project_id}/assets", response_model=Asset, status_code=201)
async def upload_asset(
    project_id: str,
    ctx: Context,
    file: Annotated[UploadFile, File()],
    kind: Annotated[Literal["upload", "sketch"], Form()] = "upload",
) -> Any:
    ctx.repo.get_project(project_id)  # 404 early if the project does not exist (or is not yours)
    if not ctx.c.upload_limiter.allow(ctx.user.id):
        raise HTTPException(429, "Too many uploads in a minute. Please wait a moment and try again.")
    max_bytes = ctx.c.settings.max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    try:
        mime = validate_image(data, max_bytes)
    except UploadError as exc:
        raise HTTPException(400, str(exc)) from exc
    asset_id = new_id()
    path = ctx.repo.storage_path(project_id, asset_id, ALLOWED[mime])
    ctx.c.store.put(path, data, mime)
    try:
        return ctx.repo.add_asset(
            project_id, kind, safe_display_name(file.filename), mime, len(data), path, asset_id=asset_id
        )
    except Exception:
        ctx.c.store.delete([path])  # do not leave an orphan file behind
        raise


@router.delete("/projects/{project_id}/assets/{asset_id}", status_code=204)
def delete_asset(project_id: str, asset_id: str, ctx: Context) -> Response:
    ctx.c.store.delete([ctx.repo.delete_asset(project_id, asset_id)])
    return Response(status_code=204)


@router.get("/assets/{asset_id}")
def get_asset_file(
    asset_id: str, request: Request, c: Annotated[Any, Depends(get_container)],
    mt: str = Query("", max_length=200, description="Media token from /api/media-token"),
) -> Response:
    """A picture of one of your projects. Works from <img> tags via the media token."""
    user_id = read_media_token(mt, c.settings.media_token_secret) if mt else None
    if user_id is None:
        if not request.headers.get("authorization"):
            raise HTTPException(401, "This picture link has expired. Reload the page.", headers=SIGN_IN_HEADERS)
        user_id = current_user(request, c).id
    request.state.user_id = user_id
    asset, path = c.repo_for(user_id).get_asset_with_path(asset_id)
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    if asset.mime_type == "image/svg+xml":
        # SVGs here are only ever drawn by our own code, but block scripts anyway.
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return Response(content=c.store.get(path), media_type=asset.mime_type, headers=headers)
