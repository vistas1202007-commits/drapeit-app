"""Explicit construction choices take precedence over inferred or photographed details."""

from __future__ import annotations

import re

from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import ConstructionDecision, GarmentComponents, PhotoHints

LABELS = {
    "bodice": "Bodice shaping", "neckline_finish": "Neckline finish",
    "closure_type": "Closure type", "closure_position": "Closure position", "fabric_construction": "Fabric construction",
    "fabric_weight": "Fabric weight", "seam_finish": "Seam finish",
}


def apply_choices(spec: DesignSpec, garment: GarmentComponents, photo: PhotoHints | None) -> GarmentComponents:
    choices = spec.construction
    tags = set(garment.features)
    body = garment.family not in {"skirt", "trousers", "dupatta", "other"}
    fabric_text = " ".join([*spec.preferred_fabrics, spec.fabric_requirements]).lower()
    inferred_knit = any(w in fabric_text for w in ("jersey", "knit"))
    construction = choices.fabric_construction or ("woven" if "woven" in fabric_text else "knit" if inferred_knit else "woven")
    garment.fabric_construction = construction
    if choices.fabric_weight:
        garment.fabric_weight = choices.fabric_weight
    if construction == "knit":
        garment.fabric_class = "knit"
        tags -= {"french-seam", "flat-fell", "plain-seam", "delicate", "sheer"}
        tags.add("stretch-seam")
    if body and not choices.bodice and re.search(r"\b(?:no|without)\s+(?:bust\s+)?darts?\b",
                                                   f"{spec.fit} {spec.silhouette} {spec.design_notes} {spec.idea}".lower()):
        tags -= {"darts", "fitted-bodice"}
        garment.bodice = "Body without darts"
    if choices.bodice and body:
        tags -= {"darts", "princess-seams", "fitted-bodice"}
        garment.bodice = {"darted": "Darted bodice", "princess": "Princess-seamed bodice",
                          "unfitted": "Unfitted body"}[choices.bodice]
        tags.update({"darted": {"darts", "fitted-bodice"}, "princess": {"princess-seams", "fitted-bodice"},
                     "unfitted": set()}[choices.bodice])
    if choices.neckline_finish and body and garment.neckline:
        tags -= {"neckline-facing", "neckline-binding", "collar"}
        finish = choices.neckline_finish
        garment.neckline_finish = {"facing": "Facing", "binding": "Bias binding", "collar": "Collar with a stand"}[finish]
        tags.add({"facing": "neckline-facing", "binding": "neckline-binding", "collar": "collar"}[finish])
        if finish in {"facing", "collar"}:
            tags.add("interfacing")
    if choices.closure_type:
        tags -= {"closure-zip-invisible", "closure-zip-lapped", "closure-buttons", "closure-hooks"}
        kind = choices.closure_type
        if kind != "none":
            garment.closure = {"invisible_zip": "Invisible zip", "lapped_zip": "Lapped zip",
                               "buttons": "Buttons", "hooks": "Hooks and eyes"}[kind]
            tags.add({"invisible_zip": "closure-zip-invisible", "lapped_zip": "closure-zip-lapped",
                      "buttons": "closure-buttons", "hooks": "closure-hooks"}[kind])
    if choices.closure_position:
        garment.closure_position = choices.closure_position
        if choices.closure_position == "none":
            garment.closure = ""
            tags -= {"closure-zip-invisible", "closure-zip-lapped", "closure-buttons", "closure-hooks"}
    text_seam = f"{spec.design_notes} {spec.fabric_requirements}".lower()
    seam_choice = choices.seam_finish or next((v for k, v in (
        ("french seam", "french"), ("flat-fell", "flat_fell"), ("plain seam", "plain"),
        ("stretch seam", "stretch")) if k in text_seam), "")
    if seam_choice:
        tags -= {"plain-seam", "french-seam", "flat-fell", "stretch-seam"}
        tags.add({"plain": "plain-seam", "french": "french-seam", "flat_fell": "flat-fell",
                  "stretch": "stretch-seam"}[seam_choice])
    # A knitting choice and a woven-only seam are incompatible, even if both were explicitly saved.
    if construction == "knit" and seam_choice in {"french", "flat_fell", "plain"}:
        raise ValueError("A knit fabric needs a compatible stretch seam; change the confirmed seam finish.")
    garment.features = sorted(tags)
    corpus = f"{spec.fit} {spec.silhouette} {spec.design_notes} {spec.idea}".lower()
    values = {
        "bodice": "princess" if "princess-seams" in tags else "darted" if "darts" in tags else "unfitted",
        "neckline_finish": "collar" if "collar" in tags else "binding" if "neckline-binding" in tags else "facing",
        "closure_type": "invisible_zip" if "closure-zip-invisible" in tags else "lapped_zip" if "closure-zip-lapped" in tags
                        else "buttons" if "closure-buttons" in tags else "hooks" if "closure-hooks" in tags else "none",
        "closure_position": garment.closure_position or "none",
        "fabric_construction": construction,
        "fabric_weight": garment.fabric_weight,
        "seam_finish": "stretch" if "stretch-seam" in tags else "french" if "french-seam" in tags
                       else "flat_fell" if "flat-fell" in tags else "plain",
    }
    explicit = {
        "bodice": any(w in corpus for w in ("dart", "princess", "unfitted", "no darts")),
        "neckline_finish": any(w in f"{spec.neckline} {spec.design_notes}".lower() for w in ("facing", "binding", "collar")),
        "closure_type": any(w in " ".join(spec.closures).lower() for w in ("invisible", "lapped", "exposed", "button", "hook", "none", "no closure")),
        "closure_position": any(w in " ".join(spec.closures).lower() for w in ("front", "back", "side", "none", "no closure")),
        "fabric_construction": inferred_knit or "woven" in fabric_text,
        "fabric_weight": any(w in fabric_text for w in ("lightweight", "light weight", "medium weight", "heavy", "thick")),
        "seam_finish": any(w in corpus for w in ("french seam", "flat-fell", "plain seam", "stretch seam")),
    }
    garment.decisions = []
    for key, label in LABELS.items():
        if key == "bodice" and not body or key == "neckline_finish" and not garment.neckline:
            continue
        source = "specified" if getattr(choices, key) or explicit[key] else "proposed"
        if key in {"closure_type", "closure_position"} and not garment.closure and not choices.closure_position and not explicit[key]:
            source = "unknown"
        elif key == "closure_position" and photo and photo.closure_position and not explicit[key] and not choices.closure_position:
            source = "observed"
        garment.decisions.append(ConstructionDecision(
            key=key, label=label, value=values[key], source=source, needs_confirmation=source != "specified"))
    return garment
