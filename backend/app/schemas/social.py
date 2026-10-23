"""Request and response shapes for profiles, posts and the feed (Phase 6A), and for
follow requests, comments, reposts, safety tools and Explore (Phase 6B)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.appearance import ProfileAppearance

Role = Literal["designer", "tailor", "boutique", "student", "other"]
Visibility = Literal["public", "followers", "close_friends", "private"]
PostStatus = Literal["draft", "published", "archived", "deleted"]
FollowStatus = Literal["none", "requested", "following"]
ReportReason = Literal["spam", "nudity", "harassment", "hate", "violence", "scam", "copied_design",
                       "false_information", "other"]

USERNAME_PATTERN = r"^[a-z0-9_.]{3,30}$"


class ProfileUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    display_name: str = Field(default="", max_length=60)
    bio: str = Field(default="", max_length=300)
    role: Role = "other"

    @field_validator("username", mode="before")
    @classmethod
    def _clean_username(cls, value: str) -> str:
        return str(value).strip().lstrip("@").lower()

    @field_validator("display_name", "bio", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return str(value or "").strip()


class Profile(BaseModel):
    user_id: str
    username: str
    display_name: str
    bio: str
    role: Role
    has_avatar: bool
    # Changes whenever the picture changes, so browsers do not show an old cached one.
    avatar_version: str | None = None
    # Private account: only approved followers see the posts (Phase 6B).
    is_private: bool = False
    # Phase 6E: the verified badge.
    verified: bool = False


class ProfileDetail(Profile):
    post_count: int
    follower_count: int
    following_count: int
    is_me: bool
    is_following: bool
    # Only filled in for your own close friends (never shown to other people).
    is_close_friend: bool = False
    # "requested" while your follow request to a private account waits for an answer.
    follow_status: FollowStatus = "none"
    follows_me: bool = False
    # False for a private account you do not follow: its posts and lists are hidden.
    can_see_posts: bool = True
    # Your own choices about this person (never shown to them).
    blocked_by_me: bool = False
    restricted_by_me: bool = False
    muted_by_me: bool = False
    # Only for your own profile: follow requests waiting for you.
    request_count: int = 0
    # Phase 6C: may you open a chat with this person (an old chat, or their settings allow it)?
    can_message: bool = False
    # Phase 8: the owner's profile theme and the Premium tag.
    appearance: ProfileAppearance = Field(default_factory=ProfileAppearance)


class PersonSummary(BaseModel):
    user_id: str
    username: str
    display_name: str
    has_avatar: bool
    avatar_version: str | None = None
    # Phase 6E: the verified badge.
    verified: bool = False


class PaletteColour(BaseModel):
    name: str = Field(max_length=40)
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class FabricChoice(BaseModel):
    name: str = Field(max_length=80)
    texture: str = Field(default="plain", max_length=20)
    swatch: str = Field(default="#cccccc", pattern=r"^#[0-9a-fA-F]{6}$")


class PostTags(BaseModel):
    garment: str = Field(default="", max_length=60)
    fabric: str = Field(default="", max_length=60)
    occasion: str = Field(default="", max_length=60)


class PostContentChoice(BaseModel):
    """What the author chose to show from the design."""

    image_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    show_palette: bool = True
    show_fabric: bool = True


class PostCreate(BaseModel):
    project_id: str
    status: Literal["draft", "published"] = "draft"
    visibility: Visibility = "public"
    caption: str = Field(default="", max_length=2200)
    tags: PostTags = Field(default_factory=PostTags)
    content: PostContentChoice = Field(default_factory=PostContentChoice)


class PostUpdate(BaseModel):
    """Only the fields that are sent are changed."""

    status: PostStatus | None = None
    visibility: Visibility | None = None
    caption: str | None = Field(default=None, max_length=2200)
    tags: PostTags | None = None
    pinned: bool | None = None
    # Re-pick pictures, colours and fabric from the design (only if it still exists).
    content: PostContentChoice | None = None


class PostImage(BaseModel):
    id: str
    kind: Literal["sketch", "generated"]


class Post(BaseModel):
    id: str
    author: PersonSummary
    status: PostStatus
    visibility: Visibility
    caption: str
    tags: PostTags
    palette: list[PaletteColour]
    fabrics: list[FabricChoice]
    images: list[PostImage]
    pinned: bool
    like_count: int
    save_count: int
    liked_by_me: bool
    saved_by_me: bool
    is_mine: bool
    repost_count: int = 0
    reposted_by_me: bool = False
    # Public posts from public accounts can be reposted (never your own).
    can_repost: bool = False
    comment_count: int = 0
    # Phase 6D: may you comment (the author's "Who can comment")?
    can_comment: bool = True
    # Phase 6D: when it was moved to "Recently deleted" (only for the author).
    deleted_at: str | None = None
    # Set in the Home Feed when someone you follow reposted it, and on a profile's Reposts tab.
    reposted_by: PersonSummary | None = None
    # Only for the author: which design it came from (null if that design was deleted).
    project_id: str | None = None
    published_at: str | None
    created_at: str
    updated_at: str


class PostPage(BaseModel):
    posts: list[Post]
    # Pass this back as ?cursor= to get the next page; null when there are no more.
    next_cursor: str | None = None


class PublishImageOption(BaseModel):
    asset_id: str
    kind: Literal["sketch", "generated"]
    label: str


class PublishOptions(BaseModel):
    """What a design can show in a post, and suggested caption and tags."""

    images: list[PublishImageOption]
    palette: list[PaletteColour]
    fabrics: list[FabricChoice]
    suggested_caption: str
    suggested_tags: PostTags
    has_profile: bool


class CloseFriendAdd(BaseModel):
    username: str = Field(min_length=3, max_length=31)


# ---------- Phase 6B ----------


class PrivacyUpdate(BaseModel):
    is_private: bool


class PersonListItem(PersonSummary):
    """Someone in a followers / following / requests / blocked list."""

    since: str


class PeoplePage(BaseModel):
    people: list[PersonListItem]
    # Pass back as ?offset= for the next page; null when there are no more.
    next_offset: int | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    # Reply to this comment (it must be a top-level comment on the same post).
    parent_id: str | None = None

    @field_validator("body", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return str(value or "").strip()


class Comment(BaseModel):
    id: str
    post_id: str
    parent_id: str | None
    author: PersonSummary
    body: str
    # False while it waits for the post owner's approval (restricted writer).
    approved: bool
    like_count: int
    liked_by_me: bool
    is_mine: bool
    # You wrote it, or it is on your post.
    can_delete: bool
    can_approve: bool
    # Phase 6D: it has one of the post owner's hidden words (only its writer and the owner see it).
    hidden: bool = False
    created_at: str
    replies: list[Comment] = Field(default_factory=list)


class CommentList(BaseModel):
    comments: list[Comment]
    total: int
    # True when there were more than we send at once (the oldest are shown).
    truncated: bool = False


class ReportCreate(BaseModel):
    target_type: Literal["post", "comment", "user", "message"]
    # A post id, a comment id, a message id (Phase 6E), or a username.
    target: str = Field(min_length=1, max_length=64)
    reason: ReportReason
    details: str = Field(default="", max_length=500)

    @field_validator("details", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return str(value or "").strip()


class ReportReceipt(BaseModel):
    id: str
    status: str
    created_at: str


class FilterOption(BaseModel):
    value: str
    count: int


class ExploreFilters(BaseModel):
    garments: list[FilterOption]
    occasions: list[FilterOption]
    colours: list[FilterOption]
    fabrics: list[FilterOption]


class TagResult(BaseModel):
    kind: Literal["garment", "fabric", "occasion"]
    value: str
    count: int


class SearchResults(BaseModel):
    people: list[PersonSummary]
    tags: list[TagResult]
    posts: list[Post]
