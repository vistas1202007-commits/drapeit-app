"""The master tailor: turns a parsed garment into an ordered, step-by-step stitching guide.

1. Retrieve: pick the technique modules the garment needs. Mostly this is exact: the garment parser
   names the features (darts, gathers, invisible zip...) and each module says which features call for it.
   Free text in the design (notes, embellishments, the photo's notes) is searched too: by meaning when
   the library has embeddings, by plain words otherwise. This can only add steps, never contradict the
   exact ones.
2. Order: a versioned dependency graph orders operations; phase and order break ties. A closed-armhole
   set-in sleeve follows body side seams; a flat sleeve precedes them. AI cannot change dependencies.
3. Write: a provider words each step for this design and fabric. Without an AI key the built-in writer
   uses the library text as it is and adds the fabric's advice.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from urllib.parse import quote_plus

from app.knowledge import FabricRule, Module, all_fabric_rules, all_modules, fabric_notes_for
from app.providers.base import EmbeddingProvider, ProviderError, StepPlan, StitchingGuideProvider, UsageMeter
from app.schemas.design_spec import DesignSpec
from app.services.construction_plan import PLAN_VERSION, dependencies, order_operations, target_piece
from app.storage.knowledge_repository import content_hash
from app.schemas.stitching import PHASE_LABELS, PHASES, FabricCard, GarmentComponents, GuideStep, StitchingGuideOutput
from app.storage.knowledge_repository import KnowledgeRepository

log = logging.getLogger(__name__)

# Only one of each group can be in a guide: the tags decide which, free-text search may not add a second.
EXCLUSIVE_GROUPS: tuple[frozenset[str], ...] = (
    frozenset({"rolled-hem", "blind-hem", "machine-hem"}),
    frozenset({"plain-seam", "french-seam", "flat-fell-seam", "stretch-seam"}),
    frozenset({"invisible-zip", "lapped-zip"}),
)
# Words too general to show that a module was meant (they appear in almost any design note).
GENERIC_KEYWORDS = {
    "hem", "hemming", "press", "pressing", "iron", "ironing", "steam", "zip", "zipper", "button", "buttons", "tie",
    "opening", "finishing", "ease", "hang", "panels", "sleeves", "armhole", "lining", "shoulders", "cutting", "grain",
    "marking", "test", "sample", "scrap", "prepare", "inspect", "needle", "tension", "interface", "line a",
}
MAX_FREE_TEXT_STEPS = 3
MIN_MEANING_SIMILARITY = 0.72
LIBRARY_CACHE_SECONDS = 300


@dataclass
class Knowledge:
    """The sewing library as the builder reads it."""

    modules: list[Module]
    fabric_rules: dict[str, FabricRule]
    source: str  # shown to the user
    repo: KnowledgeRepository | None = None
    embedder: EmbeddingProvider | None = None
    vectors: bool = False


# One remembered answer per library connection: (that connection, when it was read, what was read).
_cache: dict[int, tuple[KnowledgeRepository | None, float, Knowledge]] = {}


def load_knowledge(repo: KnowledgeRepository | None, embedder: EmbeddingProvider | None = None) -> Knowledge:
    """The database library when it is there (migration 0012 + seed script), otherwise the files in the app."""
    key = id(repo)
    cached = _cache.get(key)
    if cached and cached[0] is repo and time.monotonic() - cached[1] < LIBRARY_CACHE_SECONDS:
        found = cached[2]
        found.embedder = embedder
        return found
    knowledge = Knowledge(all_modules(), {r.fabric: r for r in all_fabric_rules()}, "built-in library")
    if repo is not None:
        try:
            if repo.has_library():
                modules, rules = repo.load_modules(), repo.load_fabric_rules()
                if modules:
                    knowledge = Knowledge(modules, {r.fabric: r for r in rules}, "technique library (database)", repo,
                                          embedder, repo.has_vectors())
        except Exception:  # noqa: BLE001 - the guide must still work if the library tables cannot be read
            log.exception("Could not read the sewing library from the database; using the built-in files")
    _cache[key] = (repo, time.monotonic(), knowledge)
    knowledge.embedder = embedder
    return knowledge


def clear_knowledge_cache() -> None:
    _cache.clear()


# ---------- 1. retrieve ----------

TAG_REASONS: dict[str, str] = {
    "base": "Every garment needs this step.",
    "darts": "The bodice is fitted, so it is shaped with darts.",
    "princess-seams": "The bodice is shaped with princess seams.",
    "pleats": "The design has pleats.",
    "gathers": "The design has gathered fullness.",
    "shoulder-seams": "The garment has shoulder seams to join.",
    "side-seams": "The garment closes with side seams.",
    "neckline-facing": "The {neckline} neckline is finished with a facing.",
    "neckline-binding": "The {neckline} neckline is finished with bias binding.",
    "armhole-finish": "The armholes are left sleeveless, so their edges need a clean finish.",
    "stay-stitch": "The {neckline} neckline is a curve cut across the grain, which stretches.",
    "interfacing": "The {neckline} neckline finish needs a firmer layer.",
    "collar": "The design has a collar.",
    "sleeve-set-in": "The design has set-in sleeves ({sleeves}).",
    "sleeve-flat": "The sleeves ({sleeves}) are sewn flat, before the side seams.",
    "cuffs": "The sleeves end in cuffs.",
    "closure-zip-invisible": "The closure is a {closure_position} invisible zip ({closure}).",
    "closure-zip-lapped": "The closure is a {closure_position} lapped zip ({closure}).",
    "closure-buttons": "The closure uses buttons ({closure}).",
    "closure-hooks": "The closure uses hooks or ties ({closure}).",
    "waistband": "The design has a waistband.",
    "bodice-to-skirt": "The bodice is joined to the skirt at the waist.",
    "kali-panels": "The skirt is made of kali panels.",
    "yoke": "The design has a yoke.",
    "placket": "The design has a placket.",
    "slit": "The design has a side slit.",
    "inseam": "The garment has leg seams and a crotch seam.",
    "lined": "The garment is lined.",
    "french-seam": "{fabric} is light and fraying, so seams are enclosed (French seams).",
    "flat-fell": "{fabric} is hard-wearing, so seams are flat-felled.",
    "plain-seam": "The main seams are plain seams.",
    "hem-rolled": "{fabric} is light, so the hem is rolled.",
    "hem-blind": "The hem is a blind hem, for a clean finish.",
    "hem-machine": "The hem is a double-fold machine hem, quick and strong.",
    "hem-curved": "The skirt is flared, so its hem is on a curve and needs to hang first.",
    "sheer": "{fabric} is sheer, so test your settings on a scrap first.",
    "delicate": "{fabric} is delicate, so test your settings on a scrap first.",
    "heavy-fabric": "{fabric} is heavy, so test your settings on a scrap first.",
}


@dataclass
class Selected:
    module: Module
    reason: str


def _lower_first(text: str) -> str:
    """"Round" -> "round", but "V-neck" stays as it is."""
    return text if len(text) > 1 and (text[1] == "-" or text[:2].isupper()) else text[:1].lower() + text[1:]


def _reason(module: Module, tags: set[str], garment: GarmentComponents) -> str:
    tag = next((t for t in module.triggers if t in tags), "base")
    text = TAG_REASONS.get(tag, module.summary)
    values = {"neckline": _lower_first(garment.neckline) or "neck", "sleeves": _lower_first(garment.sleeves) or "sleeve",
              "closure": _lower_first(garment.closure), "closure_position": garment.closure_position or "",
              "fabric": garment.fabric or "The fabric"}
    return re.sub(r"\s+", " ", text.format(**values)).strip()


def _in_group(slug: str) -> frozenset[str] | None:
    return next((g for g in EXCLUSIVE_GROUPS if slug in g), None)


def free_text_for(spec: DesignSpec, garment: GarmentComponents) -> str:
    parts = [spec.design_notes, ", ".join(spec.embellishments), spec.visual_description, *garment.photo_notes]
    return ". ".join(p.strip() for p in parts if p and p.strip())[:900]


def _lexical(text: str, modules: list[Module]) -> list[Module]:
    low = text.lower()
    scored = []
    for m in modules:
        hits = [k for k in m.keywords if k.lower() not in GENERIC_KEYWORDS and re.search(rf"\b{re.escape(k.lower())}\b", low)]
        if hits:
            scored.append((len(hits), m))
    return [m for _, m in sorted(scored, key=lambda t: -t[0])]


def retrieve(garment: GarmentComponents, spec: DesignSpec, knowledge: Knowledge, notes: list[str]) -> list[Selected]:
    tags = set(garment.features)
    chosen: dict[str, Selected] = {}
    for m in knowledge.modules:
        if tags & set(m.triggers):
            chosen[m.slug] = Selected(m, _reason(m, tags, garment))

    text = free_text_for(spec, garment)
    if text:
        taken = set(chosen)
        by_slug = {m.slug: m for m in knowledge.modules}
        candidates: list[tuple[Module, str]] = []
        if knowledge.vectors and knowledge.repo is not None and knowledge.embedder is not None:
            try:
                (query,) = knowledge.embedder.embed([text], "query")
                for slug, similarity in knowledge.repo.match(query, 6, MIN_MEANING_SIMILARITY):
                    if slug in by_slug:
                        candidates.append((by_slug[slug], "Found in the library by the meaning of your design notes."))
            except Exception as exc:  # noqa: BLE001 - search by meaning is a bonus, never a requirement
                log.warning("Search by meaning failed: %s", exc)
                notes.append("Search by meaning was not available, so only exact matches were used.")
        if not candidates:
            candidates = [(m, "Your design notes mention it.") for m in _lexical(text, knowledge.modules)]
        added = 0
        for module, reason in candidates:
            if module.slug in taken or _in_group(module.slug) or added >= MAX_FREE_TEXT_STEPS:
                continue
            # Semantic retrieval cannot override explicit shaping or add anatomy absent from this garment.
            if module.slug == "princess-seams" and "darts" in tags:
                continue
            if garment.family in {"skirt", "trousers", "dupatta"} and any(
                word in module.slug for word in ("sleeve", "shoulder", "neckline", "collar", "bodice")
            ):
                continue
            chosen[module.slug] = Selected(module, reason)
            taken.add(module.slug)
            added += 1
    return list(chosen.values())


# ---------- 2. order ----------


def order_modules(selected: list[Selected]) -> list[Selected]:
    """The order a tailor works in: phase first, then the module's place in the phase."""
    return order_operations(selected, lambda s: (PHASES.index(s.module.phase), s.module.order, s.module.slug))


# ---------- 3. write ----------


def direct_plans(garment: GarmentComponents, selected: list[Selected], fabric: FabricRule | None) -> list[StepPlan]:
    """Steps straight from the library text: no AI. Each step gets the fabric advice written for its own technique."""
    return [StepPlan(s.module.slug, s.reason, list(s.module.steps), list(s.module.tips), fabric_notes_for(s.module, fabric))
            for s in selected]


def _clean_list(values: list[str]) -> list[str]:
    return [v.strip() for v in values if v and v.strip()]


def build_guide(spec: DesignSpec, garment: GarmentComponents, knowledge: Knowledge,
                writer: StitchingGuideProvider | None, meter: UsageMeter) -> StitchingGuideOutput:
    """The guide without videos (see guide_videos.py for those)."""
    notes: list[str] = []
    fabric = knowledge.fabric_rules.get(garment.fabric_class)
    ordered = order_modules(retrieve(garment, spec, knowledge, notes))
    by_slug = {s.module.slug: s for s in ordered}
    plans = direct_plans(garment, ordered, fabric)

    if writer is not None and ordered:
        try:
            written = {p.module_slug: p for p in writer.compose(garment, [s.module for s in ordered],
                                                                {s.module.slug: s.reason for s in ordered}, fabric, meter)}
            for i, base in enumerate(plans):
                p = written.get(base.module_slug)
                if p and _clean_list(p.instructions):
                    # Preserve the grounded method, tips, numbers and fabric settings.
                    # The model provides a contextual explanation, not a second construction authority.
                    why = p.why.strip()[:500]
                    if set(re.findall(r"[0-9]+", why)) - set(re.findall(r"[0-9]+", base.why)):
                        why = base.why
                    plans[i] = StepPlan(base.module_slug, why or base.why, base.instructions,
                                        base.tips, base.fabric_tips)
        except ProviderError as exc:
            notes.append(f"The AI could not word the steps for this design ({exc}), so the library text is shown as it is.")

    steps: list[GuideStep] = []
    for number, plan in enumerate(plans, start=1):
        m = by_slug[plan.module_slug].module
        query = m.video_query
        steps.append(GuideStep(
            key=m.slug, number=number, phase=m.phase, phase_label=PHASE_LABELS[m.phase], title=m.title,
            module_slug=m.slug, module_title=m.title, why=plan.why, instructions=plan.instructions, tips=plan.tips,
            depends_on=sorted(dependencies(m.slug, set(by_slug))), source_hash=content_hash(m),
            preconditions=[f"Complete: {by_slug[d].module.title}" for d in sorted(dependencies(m.slug, set(by_slug)))],
            target_piece=target_piece(m.slug, garment),
            fabric_tips=plan.fabric_tips, search_query=query,
            search_url=f"https://www.youtube.com/results?search_query={quote_plus(query)}",
        ))

    card = None
    phase_tips: dict[str, list[str]] = {}
    if fabric is not None:
        used = {s.phase for s in steps}
        phase_tips = {phase: list(tips) for phase, tips in fabric.by_phase.items() if phase in used and tips}
        card = FabricCard(fabric=fabric.title, needle=fabric.needle, thread=fabric.thread, stitch_length=fabric.stitch_length,
                          seam_types=list(fabric.seam_types), pressing=fabric.pressing, notes=list(fabric.notes))
    elif garment.fabric:
        notes.append(f"There is no fabric card for “{garment.fabric}” yet, so only the general advice is shown.")
    notes.append("The settings on the fabric card are starting points. Always sew a test seam on a scrap of your real fabric.")
    notes.append("This guide explains the order and the methods. It has no cutting measurements: those come from the tailor sheet.")
    needs_review = any(d.needs_confirmation for d in garment.decisions)
    if needs_review:
        notes.insert(0, "Draft construction plan: confirm the proposed choices before using these steps to sew.")
    notes.append("Technique instructions are original application content and still need professional tailoring review.")
    return StitchingGuideOutput(garment=garment, fabric_card=card, phase_tips=phase_tips, steps=steps,
                                plan_version=PLAN_VERSION, requires_confirmation=needs_review,
                                knowledge_source=knowledge.source, notes=notes)
