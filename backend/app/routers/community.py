"""Comments, comment likes, reports, Explore and search (Phase 6B).

Every route needs a signed-in user. What each user may see is enforced by Row
Level Security (migration 0007) as well as by the queries in the repositories.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.routers.deps import Ctx, get_ctx
from app.routers.members import check_not_suspended
from app.schemas.social import (
    Comment,
    CommentCreate,
    CommentList,
    ExploreFilters,
    PostPage,
    ReportCreate,
    ReportReceipt,
    SearchResults,
)
from app.storage.community_repository import CommunityRepository
from app.storage.social_repository import SocialError, SocialRepository

router = APIRouter(prefix="/api", tags=["community"])


@dataclass
class CommunityCtx:
    ctx: Ctx
    social: SocialRepository
    community: CommunityRepository


def get_community(ctx: Annotated[Ctx, Depends(get_ctx)]) -> CommunityCtx:
    return CommunityCtx(ctx=ctx, social=SocialRepository(ctx.c.db, ctx.user.id),
                        community=CommunityRepository(ctx.c.db, ctx.user.id))


Community = Annotated[CommunityCtx, Depends(get_community)]


def _check_rate(s: CommunityCtx) -> None:
    if not s.ctx.c.social_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "You are doing that very fast. Please wait a moment and try again.")


def _filters(garment: str, occasion: str, colour: str, fabric: str) -> dict[str, str]:
    return {"garment": garment, "occasion": occasion, "colour": colour, "fabric": fabric}


def _text() -> Any:
    """A fresh optional filter parameter (FastAPI needs one object per parameter)."""
    return Query("", max_length=60)


# ---------- comments ----------


@router.get("/posts/{post_id}/comments", response_model=CommentList)
def comments(post_id: str, s: Community) -> Any:
    return s.community.list(post_id)


@router.post("/posts/{post_id}/comments", response_model=Comment, status_code=201)
def add_comment(post_id: str, body: CommentCreate, s: Community) -> Any:
    _check_rate(s)
    check_not_suspended(s.ctx)
    if not body.body:
        raise HTTPException(400, "Write something first.")
    try:
        return s.community.add(post_id, body.body, body.parent_id)
    except SocialError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, s: Community) -> Response:
    _check_rate(s)
    s.community.delete(comment_id)
    return Response(status_code=204)


@router.post("/comments/{comment_id}/approve", response_model=Comment)
def approve_comment(comment_id: str, s: Community) -> Any:
    _check_rate(s)
    return s.community.approve(comment_id)


@router.post("/comments/{comment_id}/like", response_model=Comment)
def like_comment(comment_id: str, s: Community) -> Any:
    _check_rate(s)
    return s.community.set_like(comment_id, True)


@router.delete("/comments/{comment_id}/like", response_model=Comment)
def unlike_comment(comment_id: str, s: Community) -> Any:
    _check_rate(s)
    return s.community.set_like(comment_id, False)


# ---------- reports ----------


@router.post("/reports", response_model=ReportReceipt, status_code=201)
def report(body: ReportCreate, s: Community) -> Any:
    _check_rate(s)
    try:
        return s.community.report(body.target_type, body.target, body.reason, body.details)
    except SocialError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---------- Explore and search ----------


@router.get("/explore", response_model=PostPage)
def explore(s: Community, cursor: str | None = Query(None, max_length=200), garment: str = _text(),
            occasion: str = _text(), colour: str = _text(), fabric: str = _text()) -> Any:
    try:
        return s.social.explore(cursor, _filters(garment, occasion, colour, fabric))
    except SocialError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/explore/trending", response_model=PostPage)
def trending(s: Community, garment: str = _text(), occasion: str = _text(), colour: str = _text(),
             fabric: str = _text()) -> Any:
    return s.social.trending(_filters(garment, occasion, colour, fabric))


@router.get("/explore/filters", response_model=ExploreFilters)
def explore_filters(s: Community) -> Any:
    return s.social.explore_filters()


@router.get("/search", response_model=SearchResults)
def search(s: Community, q: str = Query("", max_length=60)) -> Any:
    return s.social.search(q)
