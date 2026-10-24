"""GET /api/me/bootstrap: the signed-in person's profile, account status, onboarding, themes, menu numbers and
picture token in one request, instead of six requests every time a page opens."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth import make_media_token
from app.routers.deps import Ctx, get_ctx
from app.schemas.bootstrap import Bootstrap, MediaToken
from app.storage.account_repository import AccountRepository
from app.storage.appearance_repository import AppearanceRepository
from app.storage.member_repository import MemberRepository
from app.storage.notification_repository import NotificationRepository
from app.storage.social_repository import SocialRepository

router = APIRouter(prefix="/api", tags=["bootstrap"])

Context = Annotated[Ctx, Depends(get_ctx)]


@router.get("/me/bootstrap", response_model=Bootstrap)
def bootstrap(ctx: Context) -> Any:
    c, uid = ctx.c, ctx.user.id
    token, expires = make_media_token(uid, c.settings.media_token_secret, c.settings.media_token_ttl_s)
    # One database step around all the reads: they share it instead of each opening its own.
    with c.db.connect(uid):
        return Bootstrap(
            media_token=MediaToken(token=token, expires_at=datetime.fromtimestamp(expires, UTC).isoformat().replace("+00:00", "Z")),
            profile=SocialRepository(c.db, uid).my_profile(),
            account=AccountRepository(c.db, uid, ctx.user.email).full_status(),
            onboarding=MemberRepository(c.db, uid).onboarding(),
            appearance=AppearanceRepository(c.db, uid).get(),
            badges=NotificationRepository(c.db, uid).badges(),
        )
