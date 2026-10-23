"""Request and response shapes for chats (direct messages) and notifications (Phase 6C)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.social import PersonSummary

AllowMessages = Literal["everyone", "followers", "nobody"]
ChatStatus = Literal["accepted", "request"]
MessageKind = Literal["text", "post", "design"]
NotificationType = Literal["like", "comment", "reply", "follow", "follow_request", "mention", "repost", "message"]


def _strip(value: str) -> str:
    return str(value or "").strip()


# ---------- settings ----------


class MessagingSettings(BaseModel):
    """Who can start a new chat with me."""

    allow_messages_from: AllowMessages


class NotificationSettings(BaseModel):
    """Which kinds of notification I want (all on by default)."""

    likes: bool = True
    comments: bool = True
    replies: bool = True
    follows: bool = True
    follow_requests: bool = True
    mentions: bool = True
    reposts: bool = True
    messages: bool = True


# ---------- chats ----------


class ChatStart(BaseModel):
    username: str = Field(min_length=3, max_length=31)


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=2000)
    # Share a post in the chat (the words are then optional).
    post_id: str | None = None

    @field_validator("body", mode="before")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        return _strip(value)


class DesignShare(BaseModel):
    """Send one picture (a sketch or generated picture) from one of your own designs."""

    project_id: str
    asset_id: str
    body: str = Field(default="", max_length=2000)

    @field_validator("body", mode="before")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        return _strip(value)


class PostSend(BaseModel):
    """Send a post to one or more people at once."""

    usernames: list[str] = Field(min_length=1, max_length=10)
    body: str = Field(default="", max_length=2000)

    @field_validator("body", mode="before")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        return _strip(value)


class SendResult(BaseModel):
    username: str
    ok: bool
    conversation_id: str | None = None
    error: str | None = None


class SharedPost(BaseModel):
    id: str
    author: PersonSummary
    # The post's first picture, if it has one.
    image_id: str | None = None
    caption: str = ""


class Message(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    is_mine: bool
    kind: MessageKind
    body: str
    # Filled for kind "post" when you may see the post.
    post: SharedPost | None = None
    # True for kind "post" when the post was deleted or you may not see it.
    post_unavailable: bool = False
    # kind "design": load the picture from /api/messages/{id}/image.
    has_image: bool = False
    created_at: str


class MessagePage(BaseModel):
    # Oldest first, ready to show.
    messages: list[Message]
    # Pass back as ?before= to get older messages; null when there are no more.
    next_cursor: str | None = None


class ChatSummary(BaseModel):
    """One row in the inbox."""

    id: str
    # Null when that person's profile is gone.
    other: PersonSummary | None
    # Your side: "request" while it waits in your Requests folder.
    status: ChatStatus
    last_message: str
    last_message_mine: bool
    last_message_at: str
    unread_count: int


class ChatList(BaseModel):
    chats: list[ChatSummary]
    request_count: int


class ChatDetail(BaseModel):
    id: str
    other: PersonSummary | None
    status: ChatStatus
    can_send: bool
    # Why you cannot send (plain words), when can_send is false.
    cannot_send_reason: str | None = None
    blocked_by_me: bool = False
    # Your newest message that the other person has read ("Seen").
    seen_message_id: str | None = None


# ---------- notifications ----------


class NotificationItem(BaseModel):
    id: str
    type: NotificationType
    # Who did it (null if their profile is gone or they never made one).
    actor: PersonSummary | None
    post_id: str | None = None
    post_image_id: str | None = None
    comment_id: str | None = None
    comment_excerpt: str | None = None
    conversation_id: str | None = None
    created_at: str
    read: bool
    # Follow requests: still waiting for your answer?
    request_pending: bool = False
    # Do you follow this person (for "Follow back")?
    following_actor: bool = False


class NotificationPage(BaseModel):
    notifications: list[NotificationItem]
    next_cursor: str | None = None


class Badges(BaseModel):
    """The numbers on the menu: unread notifications, chats with unread messages, message requests."""

    notifications: int
    chats: int
    requests: int
