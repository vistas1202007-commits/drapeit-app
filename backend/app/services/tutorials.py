"""Builds a learning guide from real video search results.

Topics come from the design spec (garment, measurements, embellishment,
closures, tricky fabric). Each topic is searched with the tutorial provider;
the reasons shown for each video are worked out from the words in its real
title and description, so they never claim more than the video says.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import quote_plus

from app.providers.base import TutorialSearchProvider, UsageMeter, VideoResult
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import LearningStep, TutorialOutput, TutorialVideo

MAX_TOPICS = 5
STOP_WORDS = {"how", "to", "a", "an", "the", "for", "and", "of", "with", "in", "on", "tutorial", "stitch",
              "stitching", "sew", "sewing", "make", "making", "step", "by", "full", "easy", "hindi"}
TRICKY_FABRICS = ("velvet", "georgette", "chiffon", "organza", "net", "silk", "satin", "brocade")
BEGINNER_WORDS = ("beginner", "beginners", "easy", "basic", "simple", "step by step", "for starters")


@dataclass(frozen=True)
class Topic:
    name: str
    why: str
    query: str
    words: tuple[str, ...]


def search_page_url(query: str) -> str:
    """The provider's own search page for a query (a real search, not a video)."""
    return f"https://www.youtube.com/results?search_query={quote_plus(query)}"


def _words(text: str) -> tuple[str, ...]:
    return tuple(w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP_WORDS and len(w) > 1)


def build_topics(spec: DesignSpec, language: str = "any") -> list[Topic]:
    garment = spec.garment_category.strip() or "garment"
    suffix = " in Hindi" if language == "hi" else ""
    level = "for beginners " if spec.skill_level == "beginner" else ""
    topics = [
        Topic(f"Cutting and stitching the {garment.lower()}",
              f"The main skill for this design: how the {garment.lower()} is cut and put together.",
              f"{garment} cutting and stitching {level}tutorial{suffix}", _words(garment)),
        Topic(f"Taking measurements for the {garment.lower()}",
              "Accurate measurements come before any cutting; the tailor sheet lists which ones you need.",
              f"how to take measurements for {garment}{suffix}", _words(f"{garment} measurement measurements")),
    ]
    for emb in spec.embellishments[:1]:
        topics.append(Topic(f"{emb} technique", f"Your design uses {emb.lower()}.",
                            f"{emb} {level}tutorial{suffix}", _words(emb)))
    neckline = spec.neckline.strip()
    if neckline:
        topics.append(Topic(f"{neckline} finishing", f"Your design has a {neckline.lower()}.",
                            f"{neckline} neck design stitching{suffix}", _words(f"{neckline} neck")))
    fabric = next((f for f in spec.preferred_fabrics if any(t in f.lower() for t in TRICKY_FABRICS)), "")
    if fabric:
        topics.append(Topic(f"Sewing {fabric.lower()}", f"{fabric} needs special handling when cutting and stitching.",
                            f"how to sew {fabric} fabric tips{suffix}", _words(fabric)))
    for closure in spec.closures[:1]:
        if "zip" in closure.lower():
            topics.append(Topic("Inserting a zip", f"Your design closes with a {closure.lower()}.",
                                f"how to insert invisible zipper{suffix}", ("zip", "zipper", "invisible")))
    return topics[:MAX_TOPICS]


def _duration_text(seconds: int | None) -> str:
    if seconds is None:
        return ""
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def score_video(video: VideoResult, topic_words: tuple[str, ...], spec_words: tuple[str, ...], beginner: bool) -> tuple[int, list[str]]:
    """How well a real video fits, with the reasons, based only on its own title and description."""
    title, description = video.title.lower(), video.description.lower()
    score, reasons = 0, []
    in_title = [w for w in dict.fromkeys(topic_words) if w in title]
    if in_title:
        score += 30 * len(in_title)
        reasons.append("Title mentions " + ", ".join(f"“{w}”" for w in in_title))
    extra = [w for w in dict.fromkeys(spec_words) if w not in topic_words and (w in title or w in description)]
    if extra:
        score += 8 * min(len(extra), 3)
        reasons.append("Also mentions your design's " + ", ".join(extra[:3]))
    if beginner and any(w in title for w in BEGINNER_WORDS):
        score += 10
        reasons.append("Says it is for beginners")
    if video.duration_seconds is not None:
        if video.duration_seconds < 60:
            score -= 20
            reasons.append("Very short (a clip, not a full tutorial)")
        elif video.duration_seconds >= 30 * 60:
            reasons.append("Long, in-depth video")
    return score, reasons


def build_tutorial(spec: DesignSpec, search: TutorialSearchProvider, meter: UsageMeter,
                   language: str = "any", per_topic: int = 3) -> TutorialOutput:
    topics = build_topics(spec, language)
    spec_words = _words(" ".join([spec.garment_category, spec.neckline, spec.sleeve_style,
                                  *spec.embellishments, *spec.preferred_fabrics]))
    beginner = spec.skill_level == "beginner"
    videos: dict[str, TutorialVideo] = {}
    steps: list[LearningStep] = []
    for topic in topics:
        found = search.search(topic.query, per_topic + 3, language, meter) if search.connected else []
        ranked = sorted(
            ((score_video(v, topic.words, spec_words, beginner), v) for v in found if v.video_id not in videos),
            key=lambda t: t[0][0], reverse=True,
        )[:per_topic]
        ids = []
        for (score, reasons), v in ranked:
            videos[v.video_id] = TutorialVideo(
                video_id=v.video_id, title=v.title, channel=v.channel,
                url=f"https://www.youtube.com/watch?v={v.video_id}", thumbnail_url=v.thumbnail_url,
                published_at=v.published_at, duration=_duration_text(v.duration_seconds),
                description=v.description[:300], topic=topic.name, score=max(score, 0),
                relevance=reasons or [f"Returned by YouTube for “{topic.query}” (no exact word match)"],
            )
            ids.append(v.video_id)
        steps.append(LearningStep(topic=topic.name, why=topic.why, search_query=topic.query,
                                  search_url=search_page_url(topic.query), video_ids=ids))

    if search.connected:
        notes = [
            "Videos come straight from YouTube search. Titles, channels and thumbnails are theirs; the app wrote only "
            "the reasons, from the words in each video's title and description.",
            "Watch before you rely on a video: methods and measurements differ between tailors.",
        ]
        if not videos:
            notes.append("YouTube returned no suitable videos for these topics. Try the search links, or another language.")
        source = "YouTube Data API"
    else:
        notes = [
            "Tutorial search is not connected, so no videos are shown. The app never makes up video titles or links.",
            "Add a free YOUTUBE_API_KEY to backend/.env (see README) to get real videos here.",
            "Meanwhile, each step has a link that opens the same search on YouTube.",
        ]
        source = "not connected"
    return TutorialOutput(source=source, connected=search.connected, language=language, steps=steps,
                          videos=list(videos.values()), notes=notes)


def search_library(query: str, search: TutorialSearchProvider, meter: UsageMeter, language: str = "any") -> list[TutorialVideo]:
    """Free-text search for the Learning Library page."""
    words = _words(query)
    results = search.search(query, 12, language, meter)
    out = []
    for v in results:
        score, reasons = score_video(v, words, (), False)
        out.append(TutorialVideo(
            video_id=v.video_id, title=v.title, channel=v.channel, url=f"https://www.youtube.com/watch?v={v.video_id}",
            thumbnail_url=v.thumbnail_url, published_at=v.published_at, duration=_duration_text(v.duration_seconds),
            description=v.description[:300], topic=query, score=max(score, 0),
            relevance=reasons or ["Returned by YouTube for your search (no exact word match in the title)"],
        ))
    return out
