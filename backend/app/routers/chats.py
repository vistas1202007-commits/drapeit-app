"""Chats (direct messages), message requests and notifications (Phase 6C).

Every route needs a signed-in user. Who may read and send is enforced by Row
Level Security (migration 0008) as well as by the queries in chat_repository.py
and notification_repository.py. Live updates reach the browser through Supabase
Realtime (sent by the database itself); these routes are what the browser then
calls to load the new data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.routers.deps import Ctx, get_container, get_ctx
from app.routers.members import check_not_suspended
from app.routers.social import _media_user, _picture
from app.schemas.chat import (
    Badges,
    ChatDetail,
    ChatList,
    ChatStart,
    DesignShare,
    Message,
    MessageCreate,
    MessagePage,
    MessagingSettings,
    NotificationPage,
    NotificationSettings,
    PostSend,
    SendResult,
)
from app.services.generation import IMAGE_EXTENSIONS
from app.services.publishing import clean_svg_for_post, publishable_images
from app.storage.chat_repository import ChatRepository
from app.storage.notification_repository import NotificationRepository
from app.storage.repository import NotFoundError, check_id, new_id
from app.storage.social_repository import SocialError, SocialRepository

router = APIRouter(prefix="/api", tags=["chats"])


@dataclass
class ChatCtx:
    ctx: Ctx
    chats: ChatRepository
    notes: NotificationRepository


def get_chats(ctx: Annotated[Ctx, Depends(get_ctx)]) -> ChatCtx:
    return ChatCtx(ctx=ctx, chats=ChatRepository(ctx.c.db, ctx.user.id),
                   notes=NotificationRepository(ctx.c.db, ctx.user.id))


Chats = Annotated[ChatCtx, Depends(get_chats)]


def _check_rate(s: ChatCtx) -> None:
    if not s.ctx.c.social_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "You are sending very fast. Please wait a moment and try again.")


def _bad(exc: SocialError) -> HTTPException:
    return HTTPException(400, str(exc))


# ---------- settings ----------


@router.get("/me/messaging", response_model=MessagingSettings)
def messaging_settings(s: Chats) -> Any:
    try:
        return MessagingSettings(allow_messages_from=s.chats.messaging_setting())
    except SocialError as exc:
        raise _bad(exc) from exc


@router.put("/me/messaging", response_model=MessagingSettings)
def save_messaging_settings(body: MessagingSettings, s: Chats) -> Any:
    _check_rate(s)
    try:
        return MessagingSettings(allow_messages_from=s.chats.set_messaging_setting(body.allow_messages_from))
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/me/notification-settings", response_model=NotificationSettings)
def notification_settings(s: Chats) -> Any:
    return s.notes.settings()


@router.put("/me/notification-settings", response_model=NotificationSettings)
def save_notification_settings(body: NotificationSettings, s: Chats) -> Any:
    _check_rate(s)
    return s.notes.save_settings(body)


@router.get("/me/badges", response_model=Badges)
def badges(s: Chats) -> Any:
    return s.notes.badges()


# ---------- chats ----------


@router.get("/chats", response_model=ChatList)
def chats(s: Chats, folder: str = Query("inbox", pattern="^(inbox|requests)$")) -> Any:
    return s.chats.chats("accepted" if folder == "inbox" else "request")


@router.post("/chats", response_model=ChatDetail)
def start_chat(body: ChatStart, s: Chats) -> Any:
    """Open the chat with this person (it is created now if the rules allow)."""
    _check_rate(s)
    try:
        return s.chats.detail(s.chats.start(body.username))
    except SocialError as exc:
        raise _bad(exc) from exc


@router.get("/chats/{chat_id}", response_model=ChatDetail)
def chat(chat_id: str, s: Chats) -> Any:
    return s.chats.detail(chat_id)


@router.get("/chats/{chat_id}/messages", response_model=MessagePage)
def messages(chat_id: str, s: Chats, before: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.chats.messages(chat_id, before)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/chats/{chat_id}/messages", response_model=Message, status_code=201)
def send_message(chat_id: str, body: MessageCreate, s: Chats) -> Any:
    _check_rate(s)
    check_not_suspended(s.ctx)
    try:
        return s.chats.send(chat_id, body.body, body.post_id)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/chats/{chat_id}/design", response_model=Message, status_code=201)
def send_design(chat_id: str, body: DesignShare, s: Chats) -> Any:
    """Send a COPY of one sketch or generated picture from your own design. Uploaded reference
    photos are never offered (they may show a client), the same rule as publishing."""
    c = s.ctx.c
    if not c.upload_limiter.allow(s.ctx.user.id):
        raise HTTPException(429, "Too many pictures in a minute. Please wait a moment and try again.")
    check_not_suspended(s.ctx)
    allowed = {a.id: a for a in publishable_images(s.ctx.repo, body.project_id)}
    asset = allowed.get(body.asset_id)
    if asset is None:
        raise NotFoundError("Picture not found")
    try:
        s.chats.can_send(chat_id)
    except SocialError as exc:
        raise _bad(exc) from exc
    _, source = s.ctx.repo.get_asset_with_path(asset.id)
    data = c.store.get(source)
    if asset.mime_type == "image/svg+xml":
        data = clean_svg_for_post(data)  # mock pictures print the design's name; never send it
    message_id = new_id()
    path = f"messages/{check_id(chat_id, 'Chat')}/{message_id}{IMAGE_EXTENSIONS[asset.mime_type]}"
    c.store.put(path, data, asset.mime_type)
    try:
        return s.chats.send(chat_id, body.body, message_id=message_id, image=(path, asset.mime_type))
    except Exception as exc:
        c.store.delete([path])
        if isinstance(exc, SocialError):
            raise _bad(exc) from exc
        raise


@router.post("/posts/{post_id}/send", response_model=list[SendResult])
def send_post(post_id: str, body: PostSend, s: Chats) -> Any:
    """Share a post with up to 10 people. Each person gets their own result (one may refuse messages)."""
    _check_rate(s)
    check_not_suspended(s.ctx)
    post = SocialRepository(s.ctx.c.db, s.ctx.user.id).get_post(post_id)  # "not found" if you may not see it
    if post.status != "published":
        raise NotFoundError("Post not found")
    results = []
    for username in dict.fromkeys(u.strip().lstrip("@").lower() for u in body.usernames):
        try:
            chat_id = s.chats.start(username)
            s.chats.send(chat_id, body.body, post.id)
            results.append(SendResult(username=username, ok=True, conversation_id=chat_id))
        except NotFoundError:
            results.append(SendResult(username=username, ok=False, error="Account not found."))
        except SocialError as exc:
            results.append(SendResult(username=username, ok=False, error=str(exc)))
    return results


@router.delete("/messages/{message_id}", status_code=204)
def unsend(message_id: str, s: Chats) -> Response:
    _check_rate(s)
    path = s.chats.unsend(message_id)
    if path:
        s.ctx.c.store.delete([path])
    return Response(status_code=204)


@router.get("/messages/{message_id}/image")
def message_image(message_id: str, request: Request, c: Annotated[Any, Depends(get_container)],
                  mt: str = Query("", max_length=200)) -> Response:
    viewer = _media_user(request, c, mt)
    path, mime = ChatRepository(c.db, viewer).image(message_id)
    return _picture(c, path, mime)


@router.post("/chats/{chat_id}/read", status_code=204)
def mark_read(chat_id: str, s: Chats) -> Response:
    s.chats.mark_read(chat_id)
    return Response(status_code=204)


@router.post("/chats/{chat_id}/accept", response_model=ChatDetail)
def accept(chat_id: str, s: Chats) -> Any:
    _check_rate(s)
    s.chats.accept(chat_id)
    return s.chats.detail(chat_id)


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str, s: Chats) -> Response:
    """Delete the chat (or decline the request) for you only."""
    _check_rate(s)
    s.chats.delete_for_me(chat_id)
    return Response(status_code=204)


# ---------- notifications ----------


@router.get("/notifications", response_model=NotificationPage)
def notifications(s: Chats, cursor: str | None = Query(None, max_length=200)) -> Any:
    try:
        return s.notes.list(cursor)
    except SocialError as exc:
        raise _bad(exc) from exc


@router.post("/notifications/read", status_code=204)
def read_all(s: Chats) -> Response:
    s.notes.mark_all_read()
    return Response(status_code=204)


@router.post("/notifications/{notification_id}/read", status_code=204)
def read_one(notification_id: str, s: Chats) -> Response:
    s.notes.mark_read(notification_id)
    return Response(status_code=204)
