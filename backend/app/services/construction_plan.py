"""Versioned construction dependencies. Phase/order only break ties between valid operations.

These are original application rules, not a claim of professional pattern validation.
Use the selected pattern's instructions when they specify a different construction method.
"""

from __future__ import annotations

from graphlib import TopologicalSorter, CycleError

PLAN_VERSION = "construction-1"

DEPENDENCIES = {
    "layout-and-cutting": {"prepare-fabric"},
    "marking-and-notches": {"layout-and-cutting"},
    "test-seam-sample": {"prepare-fabric"},
    "interfacing": {"marking-and-notches"},
    "lining-and-underlining": {"marking-and-notches"},
    "stay-stitching": {"marking-and-notches"},
    "darts": {"marking-and-notches", "stay-stitching"},
    "princess-seams": {"marking-and-notches", "stay-stitching"},
    "gathers": {"marking-and-notches"},
    "pleats": {"marking-and-notches"},
    "shoulder-seams": {"darts", "princess-seams", "plain-seam", "french-seam", "flat-fell-seam", "stretch-seam"},
    "sleeve-sewn-flat": {"shoulder-seams"},
    "bodice-to-skirt": {"shoulder-seams", "darts", "princess-seams", "gathers", "pleats", "kali-panel-joining"},
    "neckline-facing": {"shoulder-seams", "interfacing", "stay-stitching"},
    "bias-binding": {"shoulder-seams", "stay-stitching"},
    "collar-and-stand": {"shoulder-seams", "interfacing", "placket"},
    "invisible-zip": {"bodice-to-skirt"},
    "lapped-zip": {"bodice-to-skirt"},
    "attach-lining": {"lining-and-underlining", "invisible-zip", "lapped-zip", "neckline-facing", "bias-binding"},
    "side-seams": {"shoulder-seams", "sleeve-sewn-flat", "neckline-facing", "bias-binding",
                   "invisible-zip", "lapped-zip", "attach-lining"},
    "set-in-sleeve": {"side-seams", "ease-sleeve-cap", "cuffs"},
    "inseam-and-crotch": {"side-seams"},
    "waistband": {"side-seams", "inseam-and-crotch", "invisible-zip", "lapped-zip"},
    "buttons-and-buttonholes": {"placket", "collar-and-stand", "cuffs"},
    "slit-or-vent": {"side-seams"},
    "hang-and-level-hem": {"side-seams", "bodice-to-skirt", "waistband"},
    "pressing-basics": {"rolled-hem", "blind-hem", "machine-hem"},
    "final-inspection": {"pressing-basics"},
}


def dependencies(slug: str, selected: set[str]) -> set[str]:
    required = DEPENDENCIES.get(slug, set()) & selected
    if slug not in {"prepare-fabric", "layout-and-cutting", "marking-and-notches", "test-seam-sample"}:
        required |= {"marking-and-notches"} & selected
    if slug in {"rolled-hem", "blind-hem", "machine-hem"}:
        required |= selected - {"rolled-hem", "blind-hem", "machine-hem", "pressing-basics", "final-inspection"}
    return required


def order_operations(selected, priority):
    """Stable topological sort; a contradictory rule set is rejected rather than silently reordered."""
    by_slug = {s.module.slug: s for s in selected}
    graph = {slug: dependencies(slug, set(by_slug)) for slug in by_slug}
    sorter = TopologicalSorter(graph)
    try:
        sorter.prepare()
    except CycleError as exc:
        raise ValueError("The construction rules contain a cycle; review the selected construction method.") from exc
    ordered = []
    while sorter.is_active():
        ready = sorted(sorter.get_ready(), key=lambda slug: priority(by_slug[slug]))
        # One operation at a time preserves priority when an earlier operation becomes available.
        first, *rest = ready
        ordered.append(by_slug[first])
        sorter.done(first)
        # TopologicalSorter has already returned these nodes; keep them pending for later priority comparisons.
        pending = rest
        while pending:
            pending += list(sorter.get_ready())
            pending.sort(key=lambda slug: priority(by_slug[slug]))
            slug = pending.pop(0)
            ordered.append(by_slug[slug])
            sorter.done(slug)
    return ordered


def target_piece(slug: str, garment) -> str:
    if "sleeve" in slug or slug == "cuffs":
        part = "sleeves"
    elif slug in {"darts", "princess-seams", "shoulder-seams", "neckline-facing", "collar-and-stand"}:
        part = "bodice"
    elif slug in {"waistband", "kali-panel-joining", "hang-and-level-hem"}:
        part = "skirt or lower section"
    elif "zip" in slug or slug in {"buttons-and-buttonholes", "hooks-eyes-and-ties"}:
        part = f"{garment.closure_position or 'chosen'} opening"
    else:
        part = "garment pieces"
    return f"{garment.garment_type}: {part}"
