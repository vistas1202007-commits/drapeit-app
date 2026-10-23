"""Who is calling? Supabase Auth login checks, and short-lived media links.

The browser signs in with Supabase Auth (email + password) and sends the access
token it gets as "Authorization: Bearer <token>". We check that token here:

* Projects using Supabase's signing keys (the default for new projects) sign
  tokens with ES256 or RS256. We fetch the public keys from the project's JWKS
  address and cache them.
* Older projects sign with a shared secret (HS256). That needs
  SUPABASE_JWT_SECRET in the backend's environment.

<img> tags cannot send an Authorization header, so pictures use a "media
token" instead: a short-lived, signed value that only proves who the user is.
The picture endpoint still checks that the picture belongs to that user.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

log = logging.getLogger(__name__)

JWKS_TTL_S = 10 * 60
ASYMMETRIC = {"ES256", "RS256", "EdDSA"}


class AuthError(Exception):
    """The request is not signed in, or the sign-in has expired. Safe to show."""


@dataclass(frozen=True)
class User:
    id: str
    email: str = ""


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError):
        return False
    return True


class TokenVerifier:
    def __init__(self, supabase_url: str, jwt_secret: str | None = None, client: httpx.Client | None = None) -> None:
        self.issuer = f"{supabase_url.rstrip('/')}/auth/v1"
        self.jwks_url = f"{self.issuer}/.well-known/jwks.json"
        self.jwt_secret = jwt_secret
        self.client = client or httpx.Client(timeout=10.0)
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _fetch_keys(self) -> None:
        try:
            res = self.client.get(self.jwks_url)
            res.raise_for_status()
            keys = res.json().get("keys", [])
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Could not load Supabase signing keys: %s", type(exc).__name__)
            raise AuthError("Sign-in could not be checked right now. Please try again in a moment.") from exc
        self._keys = {k["kid"]: jwt.PyJWK(k) for k in keys if "kid" in k}
        self._fetched_at = time.monotonic()

    def _public_key(self, kid: str | None) -> Any:
        with self._lock:
            if not self._keys or time.monotonic() - self._fetched_at > JWKS_TTL_S:
                self._fetch_keys()
            if kid not in self._keys and time.monotonic() - self._fetched_at > 30:
                self._fetch_keys()  # keys may have been rotated
            if kid not in self._keys:
                raise AuthError("Your sign-in is not valid for this app. Please sign in again.")
            return self._keys[kid].key

    def verify(self, token: str) -> User:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthError("Your sign-in is not valid. Please sign in again.") from exc
        alg = header.get("alg")
        if alg == "HS256":
            if not self.jwt_secret:
                raise AuthError("This project signs logins with a shared secret. Set SUPABASE_JWT_SECRET on the backend.")
            key: Any = self.jwt_secret
        elif alg in ASYMMETRIC:
            key = self._public_key(header.get("kid"))
        else:
            raise AuthError("Your sign-in uses an unsupported format. Please sign in again.")
        try:
            claims = jwt.decode(
                token, key, algorithms=[alg], audience="authenticated", issuer=self.issuer, leeway=30,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("Your sign-in has expired. Please sign in again.") from exc
        except jwt.PyJWTError as exc:
            raise AuthError("Your sign-in is not valid. Please sign in again.") from exc
        if claims.get("role") != "authenticated" or not _valid_uuid(str(claims.get("sub"))):
            raise AuthError("Please sign in with a user account.")
        return User(id=str(uuid.UUID(claims["sub"])), email=str(claims.get("email") or ""))


# ---------- media tokens (for <img> tags) ----------


def _sign(secret: str, message: str) -> str:
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def make_media_token(user_id: str, secret: str, ttl_s: int, now: float | None = None) -> tuple[str, int]:
    expires = int((now or time.time()) + ttl_s)
    payload = f"{user_id}.{expires}"
    return f"{payload}.{_sign(secret, payload)}", expires


def read_media_token(token: str, secret: str, now: float | None = None) -> str | None:
    """The user id inside a valid, unexpired media token, else None."""
    try:
        user_id, expires, signature = token.rsplit(".", 2)
        expired = int(expires) < (now or time.time())
    except ValueError:
        return None
    if expired or not _valid_uuid(user_id):
        return None
    if not hmac.compare_digest(signature, _sign(secret, f"{user_id}.{expires}")):
        return None
    return user_id
