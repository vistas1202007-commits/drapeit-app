"""Finds a real tutorial video for each step of the stitching guide, and where in the video to start.

* Every video comes from the YouTube search (never made up). Searches are kept in the database for two
  weeks, shared by everyone, so the free daily quota lasts.
* If a video's description lists chapters ("2:15 Sewing the darts"), the player starts at the chapter
  that matches the step.
* If Gemini is set up and the person asks for it, a video without a matching chapter can be watched by
  Gemini once; the start and end it finds are checked and saved, and reused for everyone after that.
* A step with no suitable video says so ("no video found") and keeps a link to the same search on YouTube.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import timedelta

from app.knowledge import Module
from app.providers.base import ProviderError, TutorialSearchProvider, UsageMeter, VideoIndexProvider, VideoResult
from app.schemas.stitching import GuideStep, GuideVideo, StitchingGuideOutput
from app.services.tutorials import _duration_text, _words, score_video
from app.storage.knowledge_repository import KnowledgeRepository, content_hash

log = logging.getLogger(__name__)

SEARCH_CACHE = timedelta(days=14)
MAX_SEARCHES_PER_GUIDE = 25
MAX_INDEXED_PER_GUIDE = 3
MAX_INDEX_SECONDS = 30 * 60
# A video counts as suitable when its title names the technique (score_video gives 30 per title word)
# or when one of its chapters matches the step.
MIN_SCORE = 30
REUSE_PENALTY = 15

TIMESTAMP = r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})"
LEADING = re.compile(rf"^\s*[\(\[]?{TIMESTAMP}[\)\]]?\s*[-–—:|.)]*\s*(.+?)\s*$")
TRAILING = re.compile(rf"^\s*(.+?)\s*[-–—:|(\[]*\s*{TIMESTAMP}[\)\]]?\s*$")


@dataclass(frozen=True)
class Chapter:
    start: int
    title: str


def _seconds(h: str | None, m: str, s: str) -> int:
    return (int(h) * 3600 if h else 0) + int(m) * 60 + int(s)


def parse_chapters(description: str) -> list[Chapter]:
    """Chapters as YouTube itself accepts them: at least three, the first at 0:00, each later than the last."""
    chapters: list[Chapter] = []
    for line in description.splitlines():
        match = LEADING.match(line)
        if match:
            h, m, s, title = match.groups()
        else:
            match = TRAILING.match(line)
            if not match:
                continue
            title, h, m, s = match.groups()
        title = title.strip(" -–—:|")
        if not title or int(s) > 59:
            continue
        start = _seconds(h, m, s)
        if chapters and start <= chapters[-1].start:
            continue
        chapters.append(Chapter(start, title))
    if len(chapters) < 3 or chapters[0].start != 0:
        return []
    return chapters


# Words that show a chapter is about doing the sewing, or about something around it (intro, cutting, pressing).
DOING_WORDS = {"sew", "sewing", "stitch", "stitching", "attach", "attaching", "insert", "inserting", "join", "joining"}
OTHER_STAGE_WORDS = {"intro", "introduction", "outro", "materials", "supplies", "marking", "mark", "cutting", "cut",
                     "pressing", "press", "measuring", "measure"}


def _chapter_score(title: str, module: Module) -> int:
    low = title.lower()
    # "s?" lets "bust dart" match "bust darts".
    phrases = sum(2 for k in module.keywords if re.search(rf"\b{re.escape(k.lower())}s?\b", low))
    if not phrases:
        return 0  # a chapter must name the technique itself, not only share a word like "sleeve"
    words = set(re.findall(r"[a-z]+", low))
    own = set(_words(module.title)) | {w for k in module.keywords for w in _words(k)}
    score = phrases + len(set(_words(module.title)) & words)
    if words & DOING_WORDS and module.phase != "prep":
        score += 1
    score -= len((words & OTHER_STAGE_WORDS) - own)
    return max(score, 1)


def match_chapter(video: VideoResult, module: Module) -> tuple[Chapter, int | None] | None:
    """The chapter of this video that shows the technique, with the second it ends at (None = end of video)."""
    chapters = parse_chapters(video.full_description or video.description)
    best: tuple[int, int] | None = None
    for i, chapter in enumerate(chapters):
        score = _chapter_score(chapter.title, module)
        if score and (best is None or score > best[0]):
            best = (score, i)
    if best is None:
        return None
    i = best[1]
    end = chapters[i + 1].start if i + 1 < len(chapters) else video.duration_seconds
    return chapters[i], end


def _clock(seconds: int) -> str:
    return _duration_text(seconds) or "0:00"


class CachedSearch:
    """The YouTube search, through the shared two-week cache."""

    def __init__(self, search: TutorialSearchProvider, repo: KnowledgeRepository | None, meter: UsageMeter,
                 language: str) -> None:
        self.search, self.repo, self.meter, self.language = search, repo, meter, language
        self.searches = 0
        self.cache_hits = 0

    def find(self, query: str) -> list[VideoResult]:
        key = f"{self.language}|{query.strip().lower()}"
        if self.repo is not None:
            try:
                cached = self.repo.get_cached_search(key, SEARCH_CACHE)
                if cached is not None:
                    self.cache_hits += 1
                    return [VideoResult(**v) for v in cached]
            except Exception:  # noqa: BLE001 - without the cache we simply search
                log.warning("Tutorial search cache could not be read", exc_info=True)
        if self.searches >= MAX_SEARCHES_PER_GUIDE:
            return []
        self.searches += 1
        found = self.search.search(query, 8, self.language, self.meter)
        if self.repo is not None:
            try:
                self.repo.put_cached_search(key, query, self.language, [v.__dict__ for v in found])
            except Exception:  # noqa: BLE001
                log.warning("Tutorial search cache could not be written", exc_info=True)
        return found


def _guide_video(video: VideoResult, reasons: list[str], start: int = 0, end: int | None = None,
                 timing: str = "whole_video", chapter: str = "") -> GuideVideo:
    return GuideVideo(
        video_id=video.video_id, title=video.title, channel=video.channel,
        url=f"https://www.youtube.com/watch?v={video.video_id}" + (f"&t={start}s" if start else ""),
        thumbnail_url=video.thumbnail_url, duration=_duration_text(video.duration_seconds), start_seconds=start,
        end_seconds=end, timing=timing, chapter_title=chapter, relevance=reasons,
        evidence="chapter" if timing == "chapter" else "candidate",
    )


def _pick(module: Module, found: list[VideoResult], used: set[str], beginner: bool) -> list[tuple[int, GuideVideo, VideoResult]]:
    topic_words = tuple(dict.fromkeys(w for k in module.keywords for w in _words(k)))
    ranked = []
    for v in found:
        score, reasons = score_video(v, topic_words, (), beginner)
        chapter = match_chapter(v, module)
        if chapter:
            score += 25
            reasons = [f"Its chapter “{chapter[0].title}” covers this step (starts at {_clock(chapter[0].start)})", *reasons]
        if score < MIN_SCORE:
            continue  # not about this technique: better no video than a wrong one
        if v.video_id in used and not chapter:
            score -= REUSE_PENALTY
        video = (_guide_video(v, reasons, chapter[0].start, chapter[1], "chapter", chapter[0].title) if chapter
                 else _guide_video(v, reasons))
        ranked.append((score, video, v))
    ranked.sort(key=lambda t: -t[0])
    return ranked


def attach_videos(guide: StitchingGuideOutput, modules: dict[str, Module], search: TutorialSearchProvider,
                  repo: KnowledgeRepository | None, meter: UsageMeter, language: str = "any", beginner: bool = False,
                  indexer: VideoIndexProvider | None = None, index_videos: bool = False,
                  budget_problem=None) -> None:  # noqa: ANN001 - Callable[[float], str | None]
    """Fill in the video of every step (in place)."""
    if not search.connected:
        if not any(s.video and s.video.evidence == "reviewed" for s in guide.steps):
            guide.video_source, guide.video_connected = "not connected", False
        guide.notes.insert(0, ("Reviewed clips are shown where available; other steps keep their search links. "
                               if guide.video_connected else "Tutorial search is not connected, so no videos are shown (the app never makes them up). ")
                              + "Add a free YOUTUBE_API_KEY to backend/.env; meanwhile each step links to the same search on YouTube.")
        return
    has_reviewed = any(s.video and s.video.evidence == "reviewed" for s in guide.steps)
    guide.video_source, guide.video_connected = ("Reviewed clips + YouTube Data API" if has_reviewed else "YouTube Data API"), True
    finder = CachedSearch(search, repo, meter, language)
    suffix = " in Hindi" if language == "hi" else ""
    used: set[str] = set()
    found_by_step: dict[str, list[VideoResult]] = {}
    failed: str | None = None
    for step in guide.steps:
        if step.video and step.video.evidence == "reviewed":
            continue
        module = modules[step.module_slug]
        step.search_query = module.video_query + suffix
        if failed:
            step.video_status = "none"
            continue
        try:
            found = finder.find(step.search_query)
        except ProviderError as exc:
            failed = str(exc)
            step.video_status = "none"
            continue
        found_by_step[step.key] = found
        ranked = _pick(module, found, used, beginner)
        if not ranked:
            step.video_status = "none"
            continue
        step.video, step.more_videos = ranked[0][1], [r[1] for r in ranked[1:3]]
        step.video_status = "found"
        used.add(step.video.video_id)

    _apply_saved_and_new_segments(guide, modules, found_by_step, repo, meter, indexer, index_videos, budget_problem)

    if failed:
        guide.notes.insert(0, f"YouTube search stopped part-way: {failed} Steps without a video keep their search link.")
    if finder.searches >= MAX_SEARCHES_PER_GUIDE:
        guide.notes.append(f"To save the free YouTube quota, at most {MAX_SEARCHES_PER_GUIDE} new searches are made per guide.")
    guide.notes.append("Videos, titles and channels come straight from YouTube. Watch before you rely on one: tailors' methods differ.")


def _apply_saved_and_new_segments(guide: StitchingGuideOutput, modules: dict[str, Module],
                                  found_by_step: dict[str, list[VideoResult]], repo: KnowledgeRepository | None,
                                  meter: UsageMeter, indexer: VideoIndexProvider | None, index_videos: bool,
                                  budget_problem) -> None:
    """A negative observation removes a candidate. Checks belong to a technique revision, never just a video."""
    if repo is None:
        return
    waiting = [s for s in guide.steps if s.video and s.video.source == "youtube" and s.video.evidence != "reviewed"]
    if not waiting:
        return
    ids = sorted({s.video.video_id for s in waiting})
    try:
        supported = repo.has_topic_checks()
        checks = repo.topic_checks(ids) if supported else {}
        _, legacy = repo.indexed_segments(ids) if not supported else (set(), {})
    except Exception:
        log.warning("Saved video checks could not be read", exc_info=True)
        guide.notes.append("Saved video evidence could not be loaded; search candidates remain unverified.")
        return

    def apply(step: GuideStep) -> None:
        if step.video is None:
            return
        vid = step.video.video_id
        key = (vid, step.module_slug, content_hash(modules[step.module_slug]))
        if key in checks and checks[key] is None:
            step.video = None
            step.more_videos = []
            step.video_status = "none"
            return
        seg = checks.get(key) if supported else legacy.get((vid, step.module_slug))
        if seg:
            step.video.start_seconds, step.video.end_seconds = seg.start_seconds, seg.end_seconds
            step.video.timing, step.video.evidence = "indexed", "indexed"
            step.video.url = f"https://www.youtube.com/watch?v={vid}&t={seg.start_seconds}s"
            step.video.relevance.insert(0, f"An AI found a demonstration of this technique at {_clock(seg.start_seconds)}")

    for step in waiting:
        revision = content_hash(modules[step.module_slug])
        step.more_videos = [v for v in step.more_videos
                            if (v.video_id, step.module_slug, revision) not in checks
                            or checks[(v.video_id, step.module_slug, revision)] is not None]
        apply(step)
    if not (index_videos and indexer is not None):
        return
    if not supported:
        guide.notes.append("New video indexing needs migration 0013_verified_sewing_media.sql; existing tutorials still play.")
        return
    durations = {v.video_id: v.duration_seconds for found in found_by_step.values() for v in found}
    by_video: dict[str, list[GuideStep]] = {}
    for step in waiting:
        if not step.video or step.video.timing != "whole_video":
            continue
        vid = step.video.video_id
        key = (vid, step.module_slug, content_hash(modules[step.module_slug]))
        duration = durations.get(vid) or 0
        if key not in checks and 0 < duration <= MAX_INDEX_SECONDS:
            by_video.setdefault(vid, []).append(step)
    for count, (vid, steps) in enumerate(by_video.items()):
        if count >= MAX_INDEXED_PER_GUIDE:
            guide.notes.append(f"Only {MAX_INDEXED_PER_GUIDE} new videos are watched per guide; use the offline worker for bulk indexing.")
            break
        duration = durations[vid]
        if budget_problem and (problem := budget_problem(indexer.estimate_cost(duration))):
            guide.notes.append(f"Videos were not watched for start times: {problem}")
            break
        topics = {s.module_slug: content_hash(modules[s.module_slug]) for s in steps}
        try:
            found = indexer.index(vid, duration, [(slug, modules[slug].title) for slug in topics], meter)
        except ProviderError as exc:
            guide.notes.append(f"A video could not be watched for start times ({exc}).")
            continue
        found = [s for s in found if s.module_slug in topics and 0 <= s.start_seconds < s.end_seconds <= duration]
        try:
            repo.save_topic_checks(vid, indexer.info.name, topics, found)
        except Exception:
            log.warning("Video checks could not be saved", exc_info=True)
            guide.notes.append("Video checks could not be saved; this result may need checking again later.")
        segments = {s.module_slug: s for s in found}
        for slug, revision in topics.items():
            checks[(vid, slug, revision)] = segments.get(slug)
        for step in steps:
            apply(step)
