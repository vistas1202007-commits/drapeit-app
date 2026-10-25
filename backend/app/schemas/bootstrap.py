"""What the app frame needs when a page opens, in one answer (see routers/bootstrap.py)."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.account import AccountStatus
from app.schemas.admin import Onboarding
from app.schemas.appearance import Appearance
from app.schemas.chat import Badges
from app.schemas.social import Profile


class Bootstrap(BaseModel):
    # None until the person has chosen a username.
    profile: Profile | None
    account: AccountStatus
    onboarding: Onboarding
    appearance: Appearance
    badges: Badges
