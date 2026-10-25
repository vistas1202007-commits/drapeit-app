"""GET /api/me/bootstrap: the signed-in person's profile, account status, onboarding, themes and menu numbers in
one request, instead of five requests every time a page opens. (The picture token keeps its own quick endpoint,
which needs no database, so the app frame can appear while this is still loading.)"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.routers.deps import Ctx, get_ctx
from app.schemas.bootstrap import Bootstrap
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
    # One database step around all the reads: they share it instead of each opening its own.
    with c.db.connect(uid):
        return Bootstrap(
            profile=SocialRepository(c.db, uid).my_profile(),
            account=AccountRepository(c.db, uid, ctx.user.email).full_status(),
            onboarding=MemberRepository(c.db, uid).onboarding(),
            appearance=AppearanceRepository(c.db, uid).get(),
            badges=NotificationRepository(c.db, uid).badges(),
        )
