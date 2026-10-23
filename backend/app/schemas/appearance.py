"""Themes for the app and the public profile, the custom theme, and the Premium flag (Phase 8)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FabricTheme = Literal["light", "dark", "linen", "cotton", "denim", "silk", "velvet", "brocade", "khadi", "chiffon"]
AppTheme = Literal["system", "light", "dark", "linen", "cotton", "denim", "silk", "velvet", "brocade", "khadi", "chiffon", "custom"]
ProfileTheme = Literal["default", "light", "dark", "linen", "cotton", "denim", "silk", "velvet", "brocade", "khadi", "chiffon", "custom"]
Texture = Literal["none", "linen", "cotton", "denim", "silk", "velvet", "brocade", "khadi", "chiffon"]
Font = Literal["fraunces", "cormorant", "playfair", "inter"]
Cover = Literal["drape", "stripes", "motif", "plain"]

# Need Premium (the database refuses them too, see migration 0011).
PREMIUM_THEMES = {"silk", "velvet", "brocade", "khadi", "chiffon", "custom"}

HEX = r"^#[0-9a-fA-F]{6}$"


class CustomTheme(BaseModel):
    brand: str = Field(pattern=HEX)
    background: str = Field(pattern=HEX)
    text: str = Field(pattern=HEX)
    texture: Texture = "none"
    font: Font = "fraunces"
    cover: Cover = "drape"


class Appearance(BaseModel):
    app_theme: AppTheme = "system"
    profile_theme: ProfileTheme = "default"
    custom_theme: CustomTheme | None = None
    # Read only: set by Premium (with SQL for now, later by payments).
    is_premium: bool = False


class AppearanceUpdate(BaseModel):
    """Only the fields sent are changed."""

    app_theme: AppTheme | None = None
    profile_theme: ProfileTheme | None = None
    custom_theme: CustomTheme | None = None


class ProfileAppearance(BaseModel):
    """What visitors of a profile see: its theme, and the Premium tag."""

    profile_theme: ProfileTheme = "default"
    custom_theme: CustomTheme | None = None
    is_premium: bool = False
