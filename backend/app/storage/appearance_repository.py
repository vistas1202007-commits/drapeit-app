"""The signed-in person's themes and Premium flag (Phase 8).

Works for ONE signed-in user in their own database session, so Row Level Security
(migration 0011) only shows them their own row. Other people's profile themes are read
through profile_appearance(), which never shows their app theme.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.schemas.appearance import PREMIUM_THEMES, Appearance, AppearanceUpdate, ProfileAppearance
from app.storage.database import Database
from app.storage.repository import check_id

PREMIUM_MESSAGE = "Premium themes and custom themes come with Premium, which is coming soon."


class PremiumRequired(Exception):
    pass


def profile_appearance(conn: psycopg.Connection, user_id: str) -> ProfileAppearance:
    row = conn.execute("SELECT * FROM profile_appearance(%s)", (user_id,)).fetchone()
    return ProfileAppearance(**row) if row else ProfileAppearance()


class AppearanceRepository:
    def __init__(self, db: Database, user_id: str) -> None:
        self.db = db
        self.user_id = check_id(user_id, "User")

    def _conn(self):
        return self.db.connect(self.user_id)

    @staticmethod
    def _read(conn: psycopg.Connection, user_id: str) -> Appearance:
        row = conn.execute("SELECT * FROM appearance_settings WHERE user_id = %s", (user_id,)).fetchone()
        premium = conn.execute("SELECT is_premium(%s) AS ok", (user_id,)).fetchone()["ok"]
        if row is None:
            return Appearance(is_premium=premium)
        return Appearance(app_theme=row["app_theme"], profile_theme=row["profile_theme"],
                          custom_theme=row["custom_theme"], is_premium=premium)

    def get(self) -> Appearance:
        with self._conn() as conn:
            return self._read(conn, self.user_id)

    def save(self, update: AppearanceUpdate) -> Appearance:
        with self._conn() as conn:
            # Make sure the row exists (plain defaults pass the Premium check), then lock it: two saves sent at
            # the same moment (an app theme and a profile theme, say) run one after the other, and the second
            # one reads what the first one wrote instead of putting the old value back.
            conn.execute("INSERT INTO appearance_settings (user_id) VALUES (%s) ON CONFLICT (user_id) DO NOTHING",
                         (self.user_id,))
            conn.execute("SELECT 1 FROM appearance_settings WHERE user_id = %s FOR UPDATE", (self.user_id,))
            current = self._read(conn, self.user_id)
            fields: dict[str, Any] = {
                "app_theme": update.app_theme or current.app_theme,
                "profile_theme": update.profile_theme or current.profile_theme,
                "custom_theme": update.custom_theme if "custom_theme" in update.model_fields_set else current.custom_theme,
            }
            changed_to_premium = (
                (update.app_theme in PREMIUM_THEMES and update.app_theme != current.app_theme)
                or (update.profile_theme in PREMIUM_THEMES and update.profile_theme != current.profile_theme)
                or ("custom_theme" in update.model_fields_set and update.custom_theme is not None)
            )
            if changed_to_premium and not current.is_premium:
                raise PremiumRequired(PREMIUM_MESSAGE)
            custom = fields["custom_theme"]
            values = {"me": self.user_id, "app": fields["app_theme"], "profile": fields["profile_theme"],
                      "custom": Jsonb(custom.model_dump()) if custom else None}
            # An UPDATE, not INSERT ... ON CONFLICT DO UPDATE: the database's Premium check treats an insert as
            # a new choice, which would refuse a Premium theme kept from before Premium ended.
            try:
                conn.execute(
                    "UPDATE appearance_settings SET app_theme = %(app)s, profile_theme = %(profile)s,"
                    " custom_theme = %(custom)s WHERE user_id = %(me)s", values,
                )
            except psycopg.errors.CheckViolation as exc:
                raise PremiumRequired(PREMIUM_MESSAGE) from exc
            return self._read(conn, self.user_id)
