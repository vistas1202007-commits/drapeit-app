"""The sewing library: technique modules and fabric rules, written for Drapeit.

Everything in this folder is original text written for this app. Nothing is copied from pattern
companies, books or video scripts. A *module* is one technique (darts, invisible zip, rolled hem...).
It says which garment features need it (`triggers`), where in the order of work it belongs
(`phase` and `order`), and what to do, in plain steps.

The same data lives in two places: these files (the source of truth, reviewed in git) and the
`sewing_modules` / `sewing_fabric_rules` tables in the database (see `scripts/seed_sewing_library.py`),
which add search by meaning. If the database does not have the tables yet, the app reads these files.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.stitching import PHASES, Phase


@dataclass(frozen=True)
class Module:
    slug: str
    title: str
    phase: Phase
    # Position inside its phase (lower comes first).
    order: int
    # The garment feature tags that call for this technique (see services/garment_parser.py). "base" = always.
    triggers: tuple[str, ...]
    summary: str
    steps: tuple[str, ...]
    tips: tuple[str, ...] = ()
    # Words that identify this technique: matched against video chapter titles and used for plain-word search.
    keywords: tuple[str, ...] = ()
    video_query: str = ""
    # Extra advice for one fabric class, e.g. {"velvet": "..."}.
    fabric_notes: dict[str, str] = field(default_factory=dict)

    def text_for_search(self) -> str:
        """The text that is turned into an embedding and matched against free-text design notes."""
        return " ".join([self.title, self.summary, *self.keywords, *self.steps[:3]])


@dataclass(frozen=True)
class FabricRule:
    fabric: str  # silk, chiffon, georgette, cotton, linen, denim, velvet or khadi
    title: str
    needle: str
    thread: str
    stitch_length: str
    seam_types: tuple[str, ...]
    pressing: str
    notes: tuple[str, ...]
    # Short advice for each phase of the work, shown on the steps of that phase.
    by_phase: dict[Phase, tuple[str, ...]] = field(default_factory=dict)


def all_modules() -> list[Module]:
    from app.knowledge.hems_pressing import MODULES as hems
    from app.knowledge.openings import MODULES as openings
    from app.knowledge.prep_shaping import MODULES as prep
    from app.knowledge.seams import MODULES as seams

    return [*prep, *seams, *openings, *hems]


def all_fabric_rules() -> list[FabricRule]:
    from app.knowledge.fabrics import RULES

    return list(RULES)


def check_library(modules: list[Module], rules: list[FabricRule]) -> list[str]:
    """Return a list of problems in the library (empty when it is sound). Used by tests and the seed script."""
    problems: list[str] = []
    seen: set[str] = set()
    for m in modules:
        if m.slug in seen:
            problems.append(f"duplicate slug {m.slug}")
        seen.add(m.slug)
        if m.phase not in PHASES:
            problems.append(f"{m.slug}: unknown phase {m.phase}")
        if not m.triggers or not m.steps or not m.summary or not m.keywords or not m.video_query:
            problems.append(f"{m.slug}: triggers, summary, steps, keywords and video_query are all required")
        if not m.slug.replace("-", "").isalnum() or m.slug != m.slug.lower():
            problems.append(f"{m.slug}: slugs are lower-case letters, digits and dashes")
    names = [r.fabric for r in rules]
    if len(set(names)) != len(names):
        problems.append("duplicate fabric rule")
    return problems
