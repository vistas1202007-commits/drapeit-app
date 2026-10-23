"""The signed-in person's onboarding, verification request and warnings, and the suspension check
used by every route that publishes, comments, reposts or messages (Phase 6E). Also their themes (Phase 8)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response

from app.routers.deps import Ctx, get_ctx
from app.schemas.admin import Onboarding, OnboardingUpdate, SuggestedPerson, VerificationRequestCreate, VerificationState
from app.schemas.appearance import Appearance, AppearanceUpdate
from app.storage.appearance_repository import AppearanceRepository, PremiumRequired
from app.storage.member_repository import MemberRepository, suspension_message
from app.storage.social_repository import SocialError

router = APIRouter(prefix="/api", tags=["members"])

Context = Annotated[Ctx, Depends(get_ctx)]


def check_not_suspended(ctx: Ctx) -> None:
    """403 with a clear message while the signed-in person is suspended. (The database refuses too.)"""
    suspension = MemberRepository(ctx.c.db, ctx.user.id).active_suspension()
    if suspension:
        raise HTTPException(403, suspension_message(suspension))


def _member(ctx: Ctx) -> MemberRepository:
    return MemberRepository(ctx.c.db, ctx.user.id)


def _check_rate(ctx: Ctx) -> None:
    if not ctx.c.social_limiter.allow(ctx.user.id):
        raise HTTPException(429, "You are doing that very fast. Please wait a moment and try again.")


# ---------- onboarding ----------


@router.get("/me/onboarding", response_model=Onboarding)
def onboarding(ctx: Context) -> Any:
    return _member(ctx).onboarding()


@router.put("/me/onboarding", response_model=Onboarding)
def save_onboarding(body: OnboardingUpdate, ctx: Context) -> Any:
    """Remember the step reached and the chosen interests (step "done" finishes onboarding)."""
    _check_rate(ctx)
    return _member(ctx).save_onboarding(body)


@router.post("/me/onboarding/skip", response_model=Onboarding)
def skip_onboarding(ctx: Context) -> Any:
    return _member(ctx).skip()


@router.get("/onboarding/suggestions", response_model=list[SuggestedPerson])
def suggestions(ctx: Context) -> Any:
    return _member(ctx).suggestions()


# ---------- verification ----------


@router.get("/me/verification", response_model=VerificationState)
def verification(ctx: Context) -> Any:
    return _member(ctx).verification()


@router.post("/me/verification", response_model=VerificationState, status_code=201)
def request_verification(body: VerificationRequestCreate, ctx: Context) -> Any:
    _check_rate(ctx)
    try:
        return _member(ctx).request_verification(body.reason, body.portfolio_url)
    except SocialError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---------- themes (Phase 8) ----------


@router.get("/me/appearance", response_model=Appearance)
def appearance(ctx: Context) -> Any:
    return AppearanceRepository(ctx.c.db, ctx.user.id).get()


@router.put("/me/appearance", response_model=Appearance)
def save_appearance(body: AppearanceUpdate, ctx: Context) -> Any:
    """Save the app theme, the profile theme and / or the custom theme. Premium ones need Premium (403)."""
    _check_rate(ctx)
    try:
        return AppearanceRepository(ctx.c.db, ctx.user.id).save(body)
    except PremiumRequired as exc:
        raise HTTPException(403, str(exc)) from exc


# ---------- warnings ----------


@router.post("/me/warnings/{warning_id}/ack", status_code=204)
def acknowledge_warning(warning_id: str, ctx: Context) -> Response:
    _member(ctx).acknowledge(warning_id)
    return Response(status_code=204)
