"""The admin panel's API (Phase 6E). Every route first checks, in the signed-in person's own
database session, that they are in admin_users (`require_admin`); everyone else gets 404, so
the panel does not even reveal that it exists. Every change is logged in admin_actions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.routers.deps import Ctx, get_ctx
from app.routers.social import _picture
from app.schemas.admin import (
    AdminAction,
    AdminNote,
    AdminProblemReport,
    AdminReport,
    AdminStats,
    AdminSuspension,
    ProblemStatusUpdate,
    SuspendRequest,
    VerificationRequest,
    WarnRequest,
)
from app.storage.admin_repository import AdminRepository
from app.storage.member_repository import MemberRepository
from app.storage.social_repository import SocialError

router = APIRouter(prefix="/api/admin", tags=["admin"])


@dataclass
class AdminCtx:
    ctx: Ctx
    admin: AdminRepository


def require_admin(ctx: Annotated[Ctx, Depends(get_ctx)]) -> AdminCtx:
    if not MemberRepository(ctx.c.db, ctx.user.id).is_admin():
        raise HTTPException(404, "Not found")
    return AdminCtx(ctx=ctx, admin=AdminRepository(ctx.c.db, ctx.user.id))


Admin = Annotated[AdminCtx, Depends(require_admin)]


def _bad(exc: SocialError) -> HTTPException:
    return HTTPException(400, str(exc))


@router.get("/stats", response_model=AdminStats)
def stats(a: Admin) -> Any:
    return a.admin.stats()


# ---------- reports ----------


@router.get("/reports", response_model=list[AdminReport])
def reports(a: Admin, status: str = Query("open", pattern="^(open|closed)$"),
            type: str = Query("", pattern="^(|post|comment|user|message)$")) -> Any:  # noqa: A002 - the query name
    return a.admin.reports(status, type)


@router.post("/reports/{report_id}/dismiss", status_code=204)
def dismiss(report_id: str, body: AdminNote, a: Admin) -> Response:
    a.admin.dismiss(report_id, body.note.strip())
    return Response(status_code=204)


@router.post("/reports/{report_id}/resolve", status_code=204)
def resolve(report_id: str, body: AdminNote, a: Admin) -> Response:
    a.admin.resolve(report_id, body.note.strip())
    return Response(status_code=204)


@router.post("/reports/{report_id}/remove", status_code=204)
def remove_content(report_id: str, body: AdminNote, a: Admin) -> Response:
    """Delete the reported post, comment or message for good."""
    try:
        paths = a.admin.remove_content(report_id, body.note.strip())
    except SocialError as exc:
        raise _bad(exc) from exc
    a.ctx.c.store.delete(paths)
    return Response(status_code=204)


# ---------- people ----------


@router.post("/users/{user_id}/warn", status_code=204)
def warn(user_id: str, body: WarnRequest, a: Admin) -> Response:
    try:
        a.admin.warn(user_id, body.reason, body.report_id)
    except SocialError as exc:
        raise _bad(exc) from exc
    return Response(status_code=204)


@router.post("/users/{user_id}/suspend", status_code=204)
def suspend(user_id: str, body: SuspendRequest, a: Admin) -> Response:
    """Suspend for `days` days, or permanently when days is empty."""
    try:
        a.admin.suspend(user_id, body.reason, body.days, body.report_id)
    except SocialError as exc:
        raise _bad(exc) from exc
    return Response(status_code=204)


@router.get("/suspensions", response_model=list[AdminSuspension])
def suspensions(a: Admin) -> Any:
    return a.admin.suspensions()


@router.post("/suspensions/{suspension_id}/lift", status_code=204)
def lift(suspension_id: str, body: AdminNote, a: Admin) -> Response:
    a.admin.lift(suspension_id, body.note.strip())
    return Response(status_code=204)


# ---------- problem reports ----------


@router.get("/problem-reports", response_model=list[AdminProblemReport])
def problem_reports(a: Admin, status: str = Query("open", pattern="^(open|closed)$")) -> Any:
    return a.admin.problem_reports(status)


@router.post("/problem-reports/{report_id}", status_code=204)
def update_problem_report(report_id: str, body: ProblemStatusUpdate, a: Admin) -> Response:
    a.admin.set_problem_status(report_id, body.status, body.note.strip())
    return Response(status_code=204)


@router.get("/problem-reports/{report_id}/screenshot")
def problem_screenshot(report_id: str, a: Admin) -> Response:
    path, mime = a.admin.problem_screenshot(report_id)
    return _picture(a.ctx.c, path, mime)


# ---------- verification ----------


@router.get("/verification-requests", response_model=list[VerificationRequest])
def verification_requests(a: Admin, status: str = Query("pending", pattern="^(pending|approved|rejected)$")) -> Any:
    return a.admin.verification_requests(status)


@router.post("/verification-requests/{request_id}/approve", status_code=204)
def approve(request_id: str, body: AdminNote, a: Admin) -> Response:
    a.admin.review_verification(request_id, True, body.note.strip())
    return Response(status_code=204)


@router.post("/verification-requests/{request_id}/reject", status_code=204)
def reject(request_id: str, body: AdminNote, a: Admin) -> Response:
    a.admin.review_verification(request_id, False, body.note.strip())
    return Response(status_code=204)


@router.delete("/verified/{user_id}", status_code=204)
def remove_badge(user_id: str, a: Admin) -> Response:
    a.admin.remove_verification(user_id, "Badge removed")
    return Response(status_code=204)


# ---------- log ----------


@router.get("/actions", response_model=list[AdminAction])
def actions(a: Admin) -> Any:
    return a.admin.actions()
