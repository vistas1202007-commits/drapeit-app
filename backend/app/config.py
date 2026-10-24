"""Application settings.

Settings come from environment variables. For local development you can put
them in a `.env` file next to this backend (see `.env.example`). Secrets such
as API keys must only ever live in `.env` or the host's environment settings,
never in code.

Phase 5: the app runs on Supabase (Postgres database, Auth and Storage), so the
Supabase settings are required. A clear error lists anything that is missing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Every setting the app cannot start without, with where to find it.
REQUIRED = {
    "DATABASE_URL": "Supabase > Connect > Session pooler connection string (with your database password)",
    "SUPABASE_URL": "Supabase > Project Settings > API > Project URL",
    "SUPABASE_SECRET_KEY": "Supabase > Project Settings > API Keys > secret key (or the legacy service_role key)",
    "MEDIA_TOKEN_SECRET": "any long random text, e.g. from: python -c \"import secrets; print(secrets.token_urlsafe(48))\"",
}


class ConfigError(Exception):
    """The backend cannot start with these settings. The message says how to fix it."""


def _load_dotenv(path: Path) -> None:
    """Very small .env reader so we do not need an extra dependency.

    Lines look like KEY=value. Existing environment variables win.
    """
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    # ----- Supabase (required) -----
    database_url: str = field(default="", repr=False)
    supabase_url: str = ""
    # Server-side key for Storage. Never sent to the browser.
    supabase_secret_key: str = field(default="", repr=False)
    # Only needed if the project still signs logins with the legacy shared JWT secret.
    supabase_jwt_secret: str | None = field(default=None, repr=False)
    storage_bucket: str = "project-assets"
    # Signs the short-lived links used by <img> tags to load a user's own pictures.
    media_token_secret: str = field(default="", repr=False)
    media_token_ttl_s: int = 2 * 60 * 60

    frontend_origins: list[str] = field(default_factory=list)
    # "mock", "anthropic" or "auto" (auto = the Anthropic API if a key is set, else mock).
    language_provider: str = "mock"
    # "mock", "gemini", "openai" or "auto" (auto = whichever image key is set, else mock).
    image_provider: str = "mock"
    # API keys are read from the environment / .env only. They are kept in
    # memory and are never written to the database, logs or API responses.
    anthropic_api_key: str | None = field(default=None, repr=False)
    # The model name from the Anthropic console. No default: real AI needs both the key and the model.
    anthropic_model: str = ""
    anthropic_effort: str = "medium"
    gemini_api_key: str | None = field(default=None, repr=False)
    gemini_image_model: str = "gemini-nano-banana-2.1"
    openai_api_key: str | None = field(default=None, repr=False)
    openai_image_model: str = "gpt-image-2"
    openai_image_quality: str = "medium"
    # "auto", "youtube" or "mock" (auto = YouTube if a key is set, else not connected).
    tutorial_provider: str = "mock"
    # YouTube Data API v3 key: free within a daily quota, no billing needed.
    youtube_api_key: str | None = field(default=None, repr=False)
    # Safety limit: paid AI calls stop for the day once this much (estimated) is spent,
    # counted across all users.
    daily_budget_usd: float = 1.0
    mock_latency_ms: int = 500
    generation_rate_limit_per_minute: int = 30
    upload_rate_limit_per_minute: int = 20
    # Likes, saves, follows and close-friend changes per user per minute.
    social_rate_limit_per_minute: int = 120
    max_upload_mb: int = 5
    # Largest request body accepted for anything that is not an upload.
    max_json_body_mb: int = 5
    db_pool_max: int = 10
    # Connections kept open and ready (opening one takes over a second).
    db_pool_min: int = 4
    # Phase 6D: how often posts and accounts past their 30-day grace period are removed (0 = never).
    purge_interval_hours: float = 6

    def missing(self) -> list[str]:
        values = {
            "DATABASE_URL": self.database_url, "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SECRET_KEY": self.supabase_secret_key, "MEDIA_TOKEN_SECRET": self.media_token_secret,
        }
        return [name for name, value in values.items() if not value]

    def check(self) -> None:
        """Raise ConfigError with a readable list of what to fix."""
        problems = [f"- {name}: {REQUIRED[name]}" for name in self.missing()]
        if self.supabase_url and not self.supabase_url.startswith("https://") and "localhost" not in self.supabase_url:
            problems.append("- SUPABASE_URL must start with https:// (for example https://abcd1234.supabase.co)")
        if self.media_token_secret and len(self.media_token_secret) < 32:
            problems.append("- MEDIA_TOKEN_SECRET is too short: use at least 32 random characters")
        if self.database_url and not self.database_url.startswith(("postgres://", "postgresql://")):
            problems.append("- DATABASE_URL must start with postgresql:// (copy it from Supabase > Connect)")
        if problems:
            raise ConfigError(
                "The backend is not configured yet. Set these in backend/.env (local) or in your host's "
                "environment settings, then restart:\n" + "\n".join(problems) + "\nSee docs/DEPLOYMENT.md."
            )


def _secret(name: str) -> str | None:
    """Read an API key. Empty values and the placeholder text count as "not set"."""
    value = os.environ.get(name, "").strip()
    if not value or value.startswith("paste-") or value.startswith("your-"):
        return None
    return value


def _number(name: str, default: str, kind: type = int):
    raw = os.environ.get(name, default).strip()
    try:
        return kind(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, but it is {raw!r}.") from exc


def load_settings() -> Settings:
    _load_dotenv(BACKEND_DIR / ".env")
    origins = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
    settings = Settings(
        database_url=_secret("DATABASE_URL") or "",
        supabase_url=os.environ.get("SUPABASE_URL", "").strip().rstrip("/"),
        supabase_secret_key=_secret("SUPABASE_SECRET_KEY") or _secret("SUPABASE_SERVICE_ROLE_KEY") or "",
        supabase_jwt_secret=_secret("SUPABASE_JWT_SECRET"),
        storage_bucket=os.environ.get("STORAGE_BUCKET", "project-assets").strip(),
        media_token_secret=_secret("MEDIA_TOKEN_SECRET") or "",
        frontend_origins=[o.strip().rstrip("/") for o in origins.split(",") if o.strip()],
        language_provider=os.environ.get("LANGUAGE_PROVIDER", "auto").strip().lower(),
        image_provider=os.environ.get("IMAGE_PROVIDER", "auto").strip().lower(),
        anthropic_api_key=_secret("ANTHROPIC_API_KEY"),
        anthropic_model=os.environ.get("ANTHROPIC_MODEL", "").strip(),
        anthropic_effort=os.environ.get("ANTHROPIC_EFFORT", "medium").strip().lower(),
        gemini_api_key=_secret("GEMINI_API_KEY"),
        gemini_image_model=os.environ.get("GEMINI_IMAGE_MODEL", "gemini-nano-banana-2.1").strip(),
        openai_api_key=_secret("OPENAI_API_KEY"),
        openai_image_model=os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2").strip(),
        openai_image_quality=os.environ.get("OPENAI_IMAGE_QUALITY", "medium").strip().lower(),
        tutorial_provider=os.environ.get("TUTORIAL_PROVIDER", "auto").strip().lower(),
        youtube_api_key=_secret("YOUTUBE_API_KEY"),
        daily_budget_usd=_number("DAILY_BUDGET_USD", "1.0", float),
        mock_latency_ms=_number("MOCK_LATENCY_MS", "500"),
        generation_rate_limit_per_minute=_number("GENERATION_RATE_LIMIT_PER_MINUTE", "30"),
        upload_rate_limit_per_minute=_number("UPLOAD_RATE_LIMIT_PER_MINUTE", "20"),
        social_rate_limit_per_minute=_number("SOCIAL_RATE_LIMIT_PER_MINUTE", "120"),
        max_upload_mb=_number("MAX_UPLOAD_MB", "5"),
        db_pool_max=_number("DB_POOL_MAX", "10"),
        db_pool_min=_number("DB_POOL_MIN", "4"),
        purge_interval_hours=_number("PURGE_INTERVAL_HOURS", "6", float),
    )
    settings.check()
    return settings
