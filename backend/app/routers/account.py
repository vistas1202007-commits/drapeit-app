"""Account settings, extra privacy controls, "Your activity", Download my data and
Report a problem (Phase 6D).

Every route needs a signed-in user and only ever touches that user's own rows
(Row Level Security, migration 0009). Changing the email or password happens in
the browser with Supabase Auth, not here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile

from app.routers.deps import Ctx, get_ctx
from app.routers.projects import _detail
from app.schemas.account import (
    AccountStatus,
    DeleteAccountRequest,
    MyCommentPage,
    PrivacyChoices,
    ProblemCategory,
    ProblemReceipt,
    SearchEntry,
    SearchSave,
    TimeDay,
    TimePing,
)
from app.services.uploads import ALLOWED, UploadError, validate_image
from app.storage.account_repository import AccountRepository
from app.storage.appearance_repository import AppearanceRepository
from app.storage.repository import new_id
from app.storage.social_repository import SocialError

router = APIRouter(prefix="/api", tags=["account"])


@dataclass
class AccountCtx:
    ctx: Ctx
    account: AccountRepository


def get_account(ctx: Annotated[Ctx, Depends(get_ctx)]) -> AccountCtx:
    return AccountCtx(ctx=ctx, account=AccountRepository(ctx.c.db, ctx.user.id, ctx.user.email))


Account = Annotated[AccountCtx, Depends(get_account)]


def _check_rate(s: AccountCtx) -> None:
    if not s.ctx.c.social_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "You are doing that very fast. Please wait a moment and try again.")


def _bad(exc: SocialError) -> HTTPException:
    return HTTPException(400, str(exc))


# ---------- account ----------


@router.get("/me/account", response_model=AccountStatus)
def account_status(s: Account) -> Any:
    return s.account.full_status()


@router.post("/me/deactivate", response_model=AccountStatus)
def deactivate(s: Account) -> Any:
    """Hide your profile, posts and comments until you sign in again."""
    _check_rate(s)
    return s.account.deactivate()


@router.post("/me/reactivate", response_model=AccountStatus)
def reactivate(s: Account) -> Any:
    return s.account.reactivate()


@router.post("/me/delete", response_model=AccountStatus)
def request_delete(body: DeleteAccountRequest, s: Account) -> Any:
    """Ask for the account to be deleted. It is hidden now and deleted for good after 30 days."""
    _check_rate(s)
    try:
        return s.account.request_delete(body.confirm)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.delete("/me/delete", response_model=AccountStatus)
def cancel_delete(s: Account) -> Any:
    return s.account.cancel_delete()


@router.get("/me/export")
def export_my_data(s: Account) -> Response:
    """Everything about you as one JSON file: profile, settings, designs, posts, comments, messages, ..."""
    if not s.ctx.c.upload_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "Please wait a minute before downloading again.")
    designs = []
    for summary in s.ctx.repo.list_projects():
        detail = _detail(s.ctx, summary.id)
        designs.append({**detail.model_dump(mode="json"), "canvas": s.ctx.repo.get_canvas(summary.id).model_dump(mode="json")})
    payload = {
        "format": "croquis/my-data@1",
        "exported_at": datetime.now(UTC).isoformat(),
        "account": {"user_id": s.ctx.user.id, "email": s.ctx.user.email},
        **s.account.social_export(),
        "appearance": AppearanceRepository(s.ctx.c.db, s.ctx.user.id).get().model_dump(mode="json"),
        "designs": designs,
        "note": "Pictures are not inside this file. Each design lists its pictures; download them from the app.",
    }
    return Response(content=json.dumps(payload, indent=2, default=str), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="drapeit-my-data.json"'})


# ---------- privacy ----------


@router.get("/me/privacy-settings", response_model=PrivacyChoices)
def privacy_settings(s: Account) -> Any:
    return s.account.privacy()


@router.put("/me/privacy-settings", response_model=PrivacyChoices)
def save_privacy_settings(body: PrivacyChoices, s: Account) -> Any:
    _check_rate(s)
    return s.account.save_privacy(body)


# ---------- your activity ----------


@router.get("/me/search-history", response_model=list[SearchEntry])
def search_history(s: Account) -> Any:
    return s.account.searches()


@router.post("/me/search-history", status_code=204)
def save_search(body: SearchSave, s: Account) -> Response:
    _check_rate(s)
    if len(body.query) >= 2:
        s.account.save_search(body.query)
    return Response(status_code=204)


@router.delete("/me/search-history", status_code=204)
def clear_search_history(s: Account) -> Response:
    s.account.delete_search(None)
    return Response(status_code=204)


@router.delete("/me/search-history/{entry_id}", status_code=204)
def delete_search(entry_id: str, s: Account) -> Response:
    s.account.delete_search(entry_id)
    return Response(status_code=204)


@router.post("/me/time", status_code=204)
def time_ping(body: TimePing, s: Account) -> Response:
    """Sent about once a minute while the app is open and visible."""
    try:
        s.account.ping(body.day)
    except SocialError as exc:
        raise _bad(exc) from exc
    return Response(status_code=204)


@router.get("/me/time", response_model=list[TimeDay])
def time_spent(s: Account, today: date = Query(...)) -> Any:
    """The last 7 days, ending on `today` (the user's own date)."""
    return s.account.time_spent(today)


@router.get("/me/comments", response_model=MyCommentPage)
def my_comments(s: Account, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.account.my_comments(cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


# ---------- help ----------


@router.post("/problem-reports", response_model=ProblemReceipt, status_code=201)
async def report_problem(
    s: Account,
    category: Annotated[ProblemCategory, Form()],
    description: Annotated[str, Form(min_length=5, max_length=2000)],
    page: Annotated[str, Form(max_length=300)] = "",
    browser: Annotated[str, Form(max_length=300)] = "",
    screenshot: Annotated[UploadFile | None, File()] = None,
) -> Any:
    """'Report a problem' with an optional screenshot (PNG, JPEG or WebP)."""
    c = s.ctx.c
    if not c.upload_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "Too many reports in a minute. Please wait a moment and try again.")
    if len(description.strip()) < 5:
        raise HTTPException(400, "Please describe the problem in a few words.")
    report_id, shot = new_id(), None
    if screenshot is not None and screenshot.filename:
        max_bytes = c.settings.max_upload_mb * 1024 * 1024
        data = await screenshot.read(max_bytes + 1)
        try:
            mime = validate_image(data, max_bytes)
        except UploadError as exc:
            raise HTTPException(400, str(exc)) from exc
        shot = (f"problem-reports/{s.ctx.user.id}/{report_id}{ALLOWED[mime]}", mime)
        c.store.put(shot[0], data, mime)
    try:
        return s.account.add_problem_report(report_id, category, description.strip(), page, browser, shot)
    except Exception:
        if shot:
            c.store.delete([shot[0]])
        raise
