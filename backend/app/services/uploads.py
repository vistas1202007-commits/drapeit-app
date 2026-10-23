"""Safe file upload checks.

We never trust the file name or the type the browser says. Instead we read the
first bytes of the file ("magic bytes") to confirm it really is an image.
"""

from __future__ import annotations

from pathlib import Path

ALLOWED = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}


class UploadError(Exception):
    pass


def detect_image_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image(data: bytes, max_bytes: int) -> str:
    """Return the real MIME type, or raise UploadError with a friendly message."""
    if not data:
        raise UploadError("The file is empty.")
    if len(data) > max_bytes:
        raise UploadError(f"The file is too large. The limit is {max_bytes // (1024 * 1024)} MB.")
    mime = detect_image_type(data)
    if mime is None:
        raise UploadError("Only PNG, JPEG and WebP images are allowed.")
    return mime


def safe_display_name(name: str | None) -> str:
    base = Path(name or "image").name
    cleaned = "".join(ch for ch in base if ch.isalnum() or ch in "._- ")[:100].strip()
    return cleaned or "image"
