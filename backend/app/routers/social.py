"""Profiles, publishing, the home feed, likes, saves and close friends (Phase 6A);
private accounts, follow requests, follower lists, block / restrict / mute and
reposts (Phase 6B).

Every route needs a signed-in user. What each user may see is enforced by Row
Level Security (migrations 0006 and 0007) as well as by the queries in social_repository.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile

from app.auth import read_media_token
from app.routers.deps import SIGN_IN_HEADERS, Ctx, current_user, get_container, get_ctx
from app.routers.members import check_not_suspended
from app.schemas.social import (
    CloseFriendAdd,
    PeoplePage,
    PersonListItem,
    PersonSummary,
    Post,
    PostContentChoice,
    PostCreate,
    PostPage,
    PostUpdate,
    PrivacyUpdate,
    Profile,
    ProfileDetail,
    ProfileUpdate,
    PublishOptions,
)
from app.services.generation import IMAGE_EXTENSIONS
from app.services.publishing import PublishError, build_content, clean_svg_for_post, publish_options
from app.services.uploads import ALLOWED, UploadError, validate_image
from app.storage.repository import new_id
from app.storage.social_repository import PrivateAccount, SocialError, SocialRepository, UsernameTaken

router = APIRouter(prefix="/api", tags=["social"])


@dataclass
class SocialCtx:
    ctx: Ctx
    social: SocialRepository


def get_social(ctx: Annotated[Ctx, Depends(get_ctx)]) -> SocialCtx:
    return SocialCtx(ctx=ctx, social=SocialRepository(ctx.c.db, ctx.user.id))


Social = Annotated[SocialCtx, Depends(get_social)]


def _check_social_rate(s: SocialCtx) -> None:
    if not s.ctx.c.social_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "You are doing that very fast. Please wait a moment and try again.")


def _bad(exc: Exception) -> HTTPException:
    status = 409 if isinstance(exc, UsernameTaken) else 403 if isinstance(exc, PrivateAccount) else 400
    return HTTPException(status, str(exc))


def _media_user(request: Request, c: Any, mt: str) -> str:
    """Who is asking for a picture: from the media token (for <img>) or the sign-in header."""
    user_id = read_media_token(mt, c.settings.media_token_secret) if mt else None
    if user_id is None:
        if not request.headers.get("authorization"):
            raise HTTPException(401, "This picture link has expired. Reload the page.", headers=SIGN_IN_HEADERS)
        user_id = current_user(request, c).id
    request.state.user_id = user_id
    return user_id


def _picture(c: Any, path: str, mime: str) -> Response:
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    if mime == "image/svg+xml":
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return Response(content=c.store.get(path), media_type=mime, headers=headers)


# ---------- my profile ----------


@router.get("/me/profile", response_model=Profile | None)
def my_profile(s: Social) -> Any:
    return s.social.my_profile()


@router.put("/me/profile", response_model=Profile)
def save_my_profile(body: ProfileUpdate, s: Social) -> Any:
    try:
        return s.social.save_profile(body)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.put("/me/privacy", response_model=Profile)
def save_privacy(body: PrivacyUpdate, s: Social) -> Any:
    _check_social_rate(s)
    try:
        return s.social.set_privacy(body.is_private)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/me/avatar", response_model=Profile)
async def upload_avatar(s: Social, file: Annotated[UploadFile, File()]) -> Any:
    c = s.ctx.c
    if not c.upload_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "Too many uploads in a minute. Please wait a moment and try again.")
    max_bytes = c.settings.max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    try:
        mime = validate_image(data, max_bytes)
    except UploadError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = f"avatars/{s.ctx.user.id}/{new_id()}{ALLOWED[mime]}"
    c.store.put(path, data, mime)
    try:
        old = s.social.set_avatar(path)
    except SocialError as exc:
        c.store.delete([path])
        raise _bad(exc) from exc
    if old:
        c.store.delete([old])
    return s.social.my_profile()


@router.get("/avatars/{user_id}")
def avatar(user_id: str, request: Request, c: Annotated[Any, Depends(get_container)],
           mt: str = Query("", max_length=200)) -> Response:
    viewer = _media_user(request, c, mt)
    path = SocialRepository(c.db, viewer).avatar_path(user_id)
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}.get(path[path.rfind("."):], "image/jpeg")
    return _picture(c, path, mime)


# ---------- people ----------


@router.get("/profiles/search", response_model=list[PersonSummary])
def search_people(s: Social, q: str = Query("", max_length=60)) -> Any:
    return s.social.search_people(q)


@router.get("/profiles/{username}", response_model=ProfileDetail)
def profile(username: str, s: Social) -> Any:
    return s.social.profile_detail(username)


@router.get("/profiles/{username}/posts")
def profile_posts(username: str, s: Social, cursor: str | None = Query(None, max_length=200)) -> dict[str, Any]:
    try:
        pinned, page = s.social.profile_posts(username, cursor)
    except SocialError as exc:
        raise _bad(exc) from exc
    return {"pinned": [p.model_dump() for p in pinned], **page.model_dump()}


@router.post("/profiles/{username}/follow", response_model=ProfileDetail)
def follow(username: str, s: Social) -> Any:
    _check_social_rate(s)
    try:
        return s.social.set_following(username, True)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.delete("/profiles/{username}/follow", response_model=ProfileDetail)
def unfollow(username: str, s: Social) -> Any:
    """Unfollow, or cancel a follow request that is still waiting."""
    _check_social_rate(s)
    return s.social.set_following(username, False)


@router.get("/profiles/{username}/followers", response_model=PeoplePage)
def followers(username: str, s: Social, offset: int = Query(0, ge=0, le=100000)) -> Any:
    try:
        return s.social.followers(username, offset)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/profiles/{username}/following", response_model=PeoplePage)
def following(username: str, s: Social, offset: int = Query(0, ge=0, le=100000)) -> Any:
    try:
        return s.social.following(username, offset)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/profiles/{username}/reposts", response_model=PostPage)
def profile_reposts(username: str, s: Social, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.social.profile_reposts(username, cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.delete("/me/followers/{username}", status_code=204)
def remove_follower(username: str, s: Social) -> Response:
    _check_social_rate(s)
    try:
        s.social.remove_follower(username)
    except SocialError as exc:
        raise _bad(exc) from exc
    return Response(status_code=204)


# ---------- follow requests (private accounts) ----------


@router.get("/me/follow-requests", response_model=list[PersonListItem])
def follow_requests(s: Social) -> Any:
    return s.social.follow_requests()


@router.post("/me/follow-requests/{username}/accept", response_model=list[PersonListItem])
def accept_request(username: str, s: Social) -> Any:
    _check_social_rate(s)
    return s.social.answer_request(username, True)


@router.delete("/me/follow-requests/{username}", response_model=list[PersonListItem])
def decline_request(username: str, s: Social) -> Any:
    _check_social_rate(s)
    return s.social.answer_request(username, False)


# ---------- block, restrict, mute ----------

SAFETY_TABLES = {"block": "blocks", "restrict": "restricts", "mute": "mutes"}


def _safety(s: SocialCtx, what: str, username: str, on: bool) -> Any:
    _check_social_rate(s)
    try:
        return s.social.set_safety(SAFETY_TABLES[what], username, on)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/profiles/{username}/{what}", response_model=ProfileDetail)
def add_safety(username: str, what: str, s: Social) -> Any:
    if what not in SAFETY_TABLES:
        raise HTTPException(404, "Not found")
    return _safety(s, what, username, True)


@router.delete("/profiles/{username}/{what}", response_model=ProfileDetail)
def remove_safety(username: str, what: str, s: Social) -> Any:
    if what not in SAFETY_TABLES:
        raise HTTPException(404, "Not found")
    return _safety(s, what, username, False)


@router.get("/me/blocked", response_model=list[PersonListItem])
def blocked(s: Social) -> Any:
    return s.social.safety_list("blocks")


@router.get("/me/restricted", response_model=list[PersonListItem])
def restricted(s: Social) -> Any:
    return s.social.safety_list("restricts")


@router.get("/me/muted", response_model=list[PersonListItem])
def muted(s: Social) -> Any:
    return s.social.safety_list("mutes")


# ---------- close friends ----------


@router.get("/me/close-friends", response_model=list[PersonSummary])
def close_friends(s: Social) -> Any:
    return s.social.close_friends()


@router.post("/me/close-friends", response_model=list[PersonSummary])
def add_close_friend(body: CloseFriendAdd, s: Social) -> Any:
    _check_social_rate(s)
    try:
        return s.social.set_close_friend(body.username, True)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.delete("/me/close-friends/{username}", response_model=list[PersonSummary])
def remove_close_friend(username: str, s: Social) -> Any:
    _check_social_rate(s)
    return s.social.set_close_friend(username, False)


# ---------- publishing ----------


@router.get("/projects/{project_id}/publish-options", response_model=PublishOptions)
def get_publish_options(project_id: str, s: Social) -> Any:
    images, palette, fabrics, caption, tags = publish_options(s.ctx.repo, project_id)
    return PublishOptions(images=images, palette=palette, fabrics=fabrics, suggested_caption=caption,
                          suggested_tags=tags, has_profile=s.social.my_profile() is not None)


def _copy_images(s: SocialCtx, post_id: str, project_id: str, choice: PostContentChoice) -> Any:
    """Copy the chosen pictures into the post's own folder, then point the post at them."""
    content = build_content(s.ctx.repo, project_id, choice)
    copies, written = [], []
    try:
        for asset in content.images:
            _, source = s.ctx.repo.get_asset_with_path(asset.id)
            data = s.ctx.c.store.get(source)
            if asset.mime_type == "image/svg+xml":
                data = clean_svg_for_post(data)  # mock pictures print the design's name; never publish it
            image_id = new_id()
            path = s.social.image_path(post_id, image_id, IMAGE_EXTENSIONS[asset.mime_type])
            s.ctx.c.store.put(path, data, asset.mime_type)
            written.append(path)
            copies.append({"id": image_id, "kind": asset.kind, "mime_type": asset.mime_type, "size_bytes": len(data),
                           "storage_path": path})
        old = s.social.replace_images(post_id, copies)
    except Exception:
        s.ctx.c.store.delete(written)
        raise
    s.ctx.c.store.delete(old)
    return content


@router.post("/posts", response_model=Post, status_code=201)
def create_post(body: PostCreate, s: Social) -> Any:
    if not s.ctx.c.upload_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "Too many posts in a minute. Please wait a moment and try again.")
    if body.status == "published":
        check_not_suspended(s.ctx)
    try:
        s.social.require_profile()
        s.ctx.repo.get_project(body.project_id)
        if body.status == "published" and not body.content.image_asset_ids:
            raise PublishError("Choose at least one picture to publish. (A draft can be saved without pictures.)")
        content = build_content(s.ctx.repo, body.project_id, body.content)
    except (SocialError, PublishError) as exc:
        raise _bad(exc) from exc
    post_id = s.social.create_post(body.project_id, body.status, body.visibility, body.caption.strip(), body.tags,
                                   content.palette, content.fabrics)
    try:
        _copy_images(s, post_id, body.project_id, body.content)
    except Exception:
        s.ctx.c.store.delete(s.social.delete_post(post_id))  # do not leave a half-made post behind
        raise
    return s.social.get_post(post_id)


@router.get("/posts/{post_id}", response_model=Post)
def get_post(post_id: str, s: Social) -> Any:
    return s.social.get_post(post_id)


@router.patch("/posts/{post_id}", response_model=Post)
def update_post(post_id: str, body: PostUpdate, s: Social) -> Any:
    changes: dict[str, Any] = body.model_dump(exclude_unset=True, exclude={"content", "tags"})
    if body.tags is not None:
        changes["tags"] = body.tags
    if "caption" in changes and changes["caption"] is not None:
        changes["caption"] = changes["caption"].strip()
    changes = {k: v for k, v in changes.items() if v is not None}
    if changes.get("status") != "archived":
        current = s.social.get_post(post_id, include_deleted=True)
        if current.is_mine and (changes.get("status") == "published" or current.status == "published"):
            check_not_suspended(s.ctx)
    try:
        if body.content is not None:
            project_id = s.social.post_project(post_id)
            if project_id is None:
                raise SocialError("The design this post came from was deleted, so its pictures cannot be changed.")
            content = _copy_images(s, post_id, project_id, body.content)
            changes |= {"palette": content.palette, "fabrics": content.fabrics}
        if changes.get("status") == "published" and not s.social.get_post(post_id).images:
            raise PublishError("Choose at least one picture to publish. (A draft can be saved without pictures.)")
        s.social.update_post(post_id, changes)
    except (SocialError, PublishError) as exc:
        raise _bad(exc) from exc
    return s.social.get_post(post_id)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: str, s: Social, permanent: bool = False) -> Response:
    """Move the post to Recently deleted (30 days), or with ?permanent=true delete it for good."""
    if permanent:
        s.ctx.c.store.delete(s.social.delete_post(post_id))
    else:
        s.social.move_to_deleted(post_id)
    return Response(status_code=204)


@router.post("/posts/{post_id}/restore", response_model=Post)
def restore_post(post_id: str, s: Social) -> Any:
    check_not_suspended(s.ctx)
    try:
        s.social.restore_post(post_id)
    except SocialError as exc:
        raise _bad(exc) from exc
    return s.social.get_post(post_id)


@router.get("/me/posts", response_model=PostPage)
def my_posts(s: Social, status: str = Query("published", pattern="^(draft|published|archived|deleted)$"),
             cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.social.my_posts(status, cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/post-images/{image_id}")
def post_image(image_id: str, request: Request, c: Annotated[Any, Depends(get_container)],
               mt: str = Query("", max_length=200)) -> Response:
    viewer = _media_user(request, c, mt)
    path, mime = SocialRepository(c.db, viewer).image(image_id)
    return _picture(c, path, mime)


# ---------- feed, likes, saves ----------


@router.get("/feed", response_model=PostPage)
def feed(s: Social, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.social.feed(cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/me/liked", response_model=PostPage)
def liked(s: Social, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.social.liked(cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/me/saved", response_model=PostPage)
def saved(s: Social, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.social.saved(cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


def _react(s: SocialCtx, post_id: str, table: str, on: bool) -> Post:
    _check_social_rate(s)
    return s.social.set_reaction(post_id, table, on)


@router.post("/posts/{post_id}/like", response_model=Post)
def like(post_id: str, s: Social) -> Any:
    return _react(s, post_id, "post_likes", True)


@router.delete("/posts/{post_id}/like", response_model=Post)
def unlike(post_id: str, s: Social) -> Any:
    return _react(s, post_id, "post_likes", False)


@router.post("/posts/{post_id}/save", response_model=Post)
def save(post_id: str, s: Social) -> Any:
    return _react(s, post_id, "post_saves", True)


@router.delete("/posts/{post_id}/save", response_model=Post)
def unsave(post_id: str, s: Social) -> Any:
    return _react(s, post_id, "post_saves", False)


def _repost(s: SocialCtx, post_id: str, on: bool) -> Post:
    _check_social_rate(s)
    if on:
        check_not_suspended(s.ctx)
    try:
        return s.social.set_repost(post_id, on)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/posts/{post_id}/repost", response_model=Post)
def repost(post_id: str, s: Social) -> Any:
    return _repost(s, post_id, True)


@router.delete("/posts/{post_id}/repost", response_model=Post)
def undo_repost(post_id: str, s: Social) -> Any:
    return _repost(s, post_id, False)

