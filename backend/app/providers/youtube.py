"""Tutorial search with the YouTube Data API v3.

The API is free to use within a daily quota (10,000 units by default). One
search costs 100 units and one details lookup costs 1, so a tutorial with four
topics uses about 404 units. When the quota runs out, searches stop until the
quota resets the next day; there is no bill.

Only videos the API actually returned are passed on, and every link is built
from the video id the API gave us. The key is read from backend/.env
(YOUTUBE_API_KEY) and never leaves the backend.
"""

from __future__ import annotations

import html
import logging
import re
from typing import Any

import httpx

from app.providers.base import ProviderError, ProviderInfo, UsageMeter, VideoResult

log = logging.getLogger(__name__)

API_BASE = "https://www.googleapis.com/youtube/v3"
SEARCH_UNITS = 100
DETAILS_UNITS = 1
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
THUMBNAIL = re.compile(r"^https://i\d?\.ytimg\.com/")
DURATION = re.compile(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

FRIENDLY_ERRORS = {
    "quotaExceeded": "Today's free YouTube search quota is used up. It resets tomorrow (Pacific time).",
    "dailyLimitExceeded": "Today's free YouTube search quota is used up. It resets tomorrow (Pacific time).",
    "keyInvalid": "YouTube rejected the API key. Check YOUTUBE_API_KEY in backend/.env.",
    "accessNotConfigured": "The YouTube Data API is not turned on for this key's Google Cloud project.",
    "forbidden": "This API key is not allowed to use the YouTube Data API.",
    "keyExpired": "The YouTube API key has expired. Create a new one in Google Cloud.",
}


def parse_duration(value: str) -> int | None:
    """'PT1H2M3S' -> 3723 seconds."""
    match = DURATION.match(value or "")
    if not match or not any(match.groups()):
        return None
    days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


class YouTubeSearchProvider:
    connected = True

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=20.0)
        self.info = ProviderInfo(
            name="youtube-data-api",
            is_mock=False,
            paid=False,
            note="Real YouTube search. Free within a daily quota (about 100 searches a day).",
        )

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            # The key goes in a header, not the URL, so it can never end up in a logged URL.
            res = self.client.get(f"{API_BASE}/{path}", params=params, headers={"X-Goog-Api-Key": self.api_key})
        except httpx.HTTPError as exc:
            raise ProviderError("Could not reach YouTube. Check your internet connection.") from exc
        if res.status_code != 200:
            reason = ""
            try:
                errors = res.json().get("error", {})
                reason = (errors.get("errors") or [{}])[0].get("reason", "")
                if not reason and "API key not valid" in errors.get("message", ""):
                    reason = "keyInvalid"
            except ValueError:
                pass
            raise ProviderError(FRIENDLY_ERRORS.get(reason, f"YouTube search failed ({res.status_code}). Please retry."))
        return res.json()

    def search(self, query: str, max_results: int, language: str, meter: UsageMeter) -> list[VideoResult]:
        params: dict[str, Any] = {
            "part": "snippet", "type": "video", "q": query, "maxResults": max(1, min(max_results, 10)),
            "safeSearch": "strict", "videoEmbeddable": "true",
        }
        if language in ("en", "hi"):
            params["relevanceLanguage"] = language
        data = self._get("search", params)
        meter.add(0.0, f"YouTube search '{query}': {SEARCH_UNITS} quota units (free)")

        found: list[VideoResult] = []
        for item in data.get("items", []):
            video_id = (item.get("id") or {}).get("videoId", "")
            snippet = item.get("snippet") or {}
            thumbs = snippet.get("thumbnails") or {}
            thumb = next((thumbs[k]["url"] for k in ("medium", "high", "default") if k in thumbs and "url" in thumbs[k]), "")
            if not VIDEO_ID.match(video_id) or not THUMBNAIL.match(thumb) or not snippet.get("title"):
                log.info("Skipping a YouTube result with missing or unexpected data")
                continue  # never pass on anything we cannot trust
            found.append(VideoResult(
                video_id=video_id,
                title=html.unescape(snippet["title"]),
                channel=html.unescape(snippet.get("channelTitle", "")),
                description=html.unescape(snippet.get("description", "")),
                published_at=snippet.get("publishedAt", "")[:10],
                thumbnail_url=thumb,
            ))
        if not found:
            return []

        details = self._get("videos", {"part": "contentDetails", "id": ",".join(v.video_id for v in found)})
        meter.add(0.0, f"YouTube video details: {DETAILS_UNITS} quota unit (free)")
        durations = {
            d.get("id"): parse_duration((d.get("contentDetails") or {}).get("duration", ""))
            for d in details.get("items", [])
        }
        # A video missing from the details answer was removed or made private since the search.
        return [
            VideoResult(**{**v.__dict__, "duration_seconds": durations[v.video_id]})
            for v in found if v.video_id in durations
        ]


class NoTutorialSearch:
    """Used when no YOUTUBE_API_KEY is set. It never returns videos: we do not make them up."""

    connected = False
    info = ProviderInfo(
        name="not connected",
        is_mock=True,
        note="No video search key set. Shows search links only, never made-up videos.",
    )

    def search(self, query: str, max_results: int, language: str, meter: UsageMeter) -> list[VideoResult]:
        return []
