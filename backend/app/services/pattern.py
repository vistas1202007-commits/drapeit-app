"""Pattern assistance: which pieces a pattern needs, how drafting works, and a cutting layout.

Ordinary code, not AI, and CONCEPTUAL ONLY. It names measurements and explains
relationships (for example "bust ÷ 4 plus ease"), but it never gives a cutting
dimension, an ease amount or a seam allowance. A pattern maker must draft,
test and adjust the real pattern.
"""

from __future__ import annotations

from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import CuttingLayout, DraftingStep, PatternOutput, PatternPiece
from app.services.fabric_handling import handling_for
from app.services.tailor_sheet import ESTIMATE, MEASURED, MISSING, _matches, required_measurements

DISCLAIMER = (
    "Conceptual guidance, not a production-ready pattern. It explains which pieces and measurements a pattern "
    "needs and how drafting works. A skilled pattern maker must draft, test in cheap fabric (a toile) and adjust "
    "it before any real fabric is cut."
)
NAP_FABRICS = ("velvet", "corduroy")

P = PatternPiece


def _family(spec: DesignSpec) -> str:
    cat = spec.garment_category.lower()
    for family, keys in (
        ("anarkali", ("anarkali",)), ("lehenga", ("lehenga",)), ("blouse", ("blouse",)),
        ("kurta", ("kurta", "kurti", "salwar")), ("trousers", ("trouser", "pant")), ("skirt", ("skirt",)),
        ("shirt", ("shirt",)), ("jacket", ("jacket", "blazer", "sherwani")),
    ):
        if any(k in cat for k in keys):
            return family
    return "dress"


def _pieces(spec: DesignSpec, family: str) -> list[PatternPiece]:
    lengthwise = "Lengthwise grain (parallel to the selvedge)"
    if family == "anarkali":
        pieces = [
            P(name="Bodice front", cut="Cut 1 on the fold", fabric="main", grain=lengthwise),
            P(name="Bodice back", cut="Cut 1 on the fold", fabric="main", grain=lengthwise),
            P(name="Sleeve", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise),
            P(name="Kali panels (skirt)", cut="Cut as many as the design's kali count", fabric="main",
              grain="Centre of each kali on the lengthwise grain", size="large",
              notes="The number of kalis sets the flare; decide it with the tailor."),
            P(name="Neck facing (front and back)", cut="Cut 1 each", fabric="main", grain=lengthwise, size="small"),
            P(name="Bodice lining (front and back)", cut="Cut 1 each on the fold", fabric="lining", grain=lengthwise),
            P(name="Kali lining", cut="Same count as the kalis", fabric="lining", grain=lengthwise, size="large"),
        ]
    elif family == "lehenga":
        pieces = [
            P(name="Skirt panels / kalis", cut="Cut as many as the design needs", fabric="main", grain=lengthwise,
              size="large", notes="Blouse and dupatta need their own patterns."),
            P(name="Waistband", cut="Cut 1 (or 2 if joined at the side)", fabric="main", grain=lengthwise, size="small"),
            P(name="Opening placket", cut="Cut 2", fabric="main", grain=lengthwise, size="small"),
            P(name="Skirt lining panels", cut="Same count as the panels", fabric="lining", grain=lengthwise, size="large"),
        ]
    elif family == "blouse":
        pieces = [
            P(name="Front", cut="Cut 1 on the fold (or 2 for a front opening)", fabric="main", grain=lengthwise,
              notes="Usually shaped with darts or princess seams."),
            P(name="Back", cut="Cut 2 for a back opening, else 1 on the fold", fabric="main", grain=lengthwise),
            P(name="Sleeve", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise, size="small"),
            P(name="Neck facing", cut="Cut 1 front, 1 back", fabric="main", grain=lengthwise, size="small"),
            P(name="Lining (front and back)", cut="As the main pieces", fabric="lining", grain=lengthwise),
        ]
    elif family == "kurta":
        pieces = [
            P(name="Front", cut="Cut 1 on the fold", fabric="main", grain=lengthwise, size="large"),
            P(name="Back", cut="Cut 1 on the fold", fabric="main", grain=lengthwise, size="large"),
            P(name="Sleeve", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise),
            P(name="Neck facing", cut="Cut 1 front, 1 back", fabric="main", grain=lengthwise, size="small"),
            P(name="Side-slit facings", cut="Cut 4", fabric="main", grain=lengthwise, size="small"),
        ]
    elif family == "trousers":
        pieces = [
            P(name="Front leg", cut="Cut 2 (a pair)", fabric="main", grain="Crease line on the lengthwise grain", size="large"),
            P(name="Back leg", cut="Cut 2 (a pair)", fabric="main", grain="Crease line on the lengthwise grain", size="large"),
            P(name="Waistband", cut="Cut 1", fabric="main", grain=lengthwise, size="small"),
            P(name="Pocket bags", cut="Cut 4 (optional)", fabric="lining", grain=lengthwise, size="small"),
        ]
    elif family == "skirt":
        pieces = [
            P(name="Front panel", cut="Cut 1 on the fold", fabric="main", grain=lengthwise, size="large"),
            P(name="Back panel", cut="Cut 2 if the zip is at the back, else 1 on the fold", fabric="main",
              grain=lengthwise, size="large"),
            P(name="Waistband", cut="Cut 1", fabric="main", grain=lengthwise, size="small"),
        ]
    elif family == "shirt":
        pieces = [
            P(name="Front", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise),
            P(name="Back", cut="Cut 1 on the fold", fabric="main", grain=lengthwise, size="large"),
            P(name="Yoke", cut="Cut 2", fabric="main", grain="Crosswise or lengthwise, as designed", size="small"),
            P(name="Sleeve", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise),
            P(name="Cuff", cut="Cut 4", fabric="main", grain=lengthwise, size="small"),
            P(name="Collar and collar stand", cut="Cut 2 each", fabric="main", grain=lengthwise, size="small"),
        ]
    elif family == "jacket":
        pieces = [
            P(name="Front", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise, size="large"),
            P(name="Back", cut="Cut 2 (centre back seam)", fabric="main", grain=lengthwise),
            P(name="Upper and under sleeve", cut="Cut 2 of each", fabric="main", grain=lengthwise),
            P(name="Collar", cut="Cut 2", fabric="main", grain=lengthwise, size="small"),
            P(name="Front facing", cut="Cut 2", fabric="main", grain=lengthwise),
            P(name="Lining (front, back, sleeves)", cut="As the main pieces", fabric="lining", grain=lengthwise, size="large"),
        ]
    else:
        pieces = [
            P(name="Bodice front", cut="Cut 1 on the fold", fabric="main", grain=lengthwise),
            P(name="Bodice back", cut="Cut 2 for a back zip, else 1 on the fold", fabric="main", grain=lengthwise),
            P(name="Sleeve", cut="Cut 2 (a pair)", fabric="main", grain=lengthwise),
            P(name="Skirt front and back", cut="Cut 1 each (or as panels)", fabric="main", grain=lengthwise, size="large"),
            P(name="Neck facing", cut="Cut 1 front, 1 back", fabric="main", grain=lengthwise, size="small"),
        ]
    if "sleeveless" in spec.sleeve_style.lower():
        pieces = [p for p in pieces if "sleeve" not in p.name.lower()]
        pieces.append(P(name="Armhole facing or bias binding", cut="Cut 2 pairs", fabric="main",
                        grain="Bias (diagonal) for binding", size="small"))
    if any("zip" in c.lower() for c in spec.closures):
        pieces.append(P(name="Zip facing / underlap", cut="Cut 1", fabric="main", grain=lengthwise, size="small"))
    pieces.append(P(name="Interfacing for facings, collar and waistband", cut="Match each facing", fabric="interfacing",
                    grain="As the piece it backs", size="small"))
    return pieces


def _drafting(spec: DesignSpec, family: str, required: list[str]) -> list[DraftingStep]:
    has = lambda name: any(_matches(name, r) or _matches(r, name) for r in required)  # noqa: E731
    steps: list[DraftingStep] = []
    if family in ("trousers",):
        steps += [
            DraftingStep(step="Draw the front and back leg blocks: hip ÷ 4 plus ease at the hip line, waist ÷ 4 plus "
                              "ease at the top; take the difference out with darts or side shaping.", uses=["Hip", "Waist"]),
            DraftingStep(step="Set the leg length from the outseam, and check the inside leg against the inseam.",
                         uses=["Outseam / full length", "Inseam"]),
            DraftingStep(step="Shape the legs from the thigh down to the ankle opening.", uses=["Thigh", "Ankle opening"]),
        ]
    elif family == "skirt":
        steps.append(DraftingStep(step="Draw the panel: waist ÷ 4 plus ease at the top, hip ÷ 4 plus ease at the hip "
                                       "line, then flare out to the hem as designed; length is the skirt length.",
                                  uses=["Waist", "Hip", "Skirt length"]))
    else:
        steps += [
            DraftingStep(step="Start a bodice block: width across the bust line = bust ÷ 4 plus ease for each quarter "
                              "piece (front and back).", uses=["Bust / chest"], note="Ease depends on fit and fabric."),
            DraftingStep(step="Mark the shoulder: half the shoulder width from the centre line, with a slope set by "
                              "the tailor.", uses=["Shoulder width"]),
            DraftingStep(step="Draw the neckline to the front and back neck depths.",
                         uses=["Neck depth (front)", "Neck depth (back)"],
                         note=f"Shape: {spec.neckline}." if spec.neckline else ""),
            DraftingStep(step="Shape the armhole from the armhole measurement; check it later against the sleeve cap.",
                         uses=["Armhole"]),
            DraftingStep(step="Mark the waist: waist ÷ 4 plus ease; take the difference out with darts or princess "
                              "seams.", uses=["Waist"], note=f"Fit: {spec.fit}." if spec.fit else ""),
        ]
        if has("Sleeve length"):
            steps.append(DraftingStep(
                step="Draft the sleeve: length from the sleeve length, cap curve walked against the armhole, opening "
                     "from the wrist or sleeve-opening measurement.",
                uses=[u for u in ("Sleeve length", "Armhole", "Wrist (sleeve opening)") if has(u)],
                note=f"Style: {spec.sleeve_style}." if spec.sleeve_style else ""))
        if family in ("anarkali", "lehenga", "dress"):
            length = "Skirt length" if family == "lehenga" else "Full length"
            steps.append(DraftingStep(
                step="Plan the skirt: share the waist seam between the panels or kalis (seam length ÷ number of "
                     "panels); the width you give each panel at the hem sets the flare.",
                uses=[u for u in ("Waist", "Hip", length) if has(u)],
                note=f"Silhouette: {spec.silhouette}." if spec.silhouette else ""))
    steps += [
        DraftingStep(step="Add seam allowance to every piece. Agree the amount with your tailor; it is not set here."),
        DraftingStep(step="Mark grainlines, fold lines, notches and the piece name on every pattern piece."),
        DraftingStep(step="Make a toile (test garment) in cheap fabric, fit it on the wearer and correct the pattern "
                          "before cutting the real fabric."),
    ]
    # Only keep measurement names this garment actually needs.
    for s in steps:
        s.uses = [u for u in s.uses if has(u)]
    return steps


def build_pattern(spec: DesignSpec) -> PatternOutput:
    family = _family(spec)
    unit = spec.measurement_unit
    required = required_measurements(spec)
    rows, missing = [], []
    for name in required:
        given = next((m for m in spec.measurements if _matches(name, m.name)), None)
        if given is None:
            missing.append(name)
            rows.append({"name": name, "value": "—", "status": MISSING})
        else:
            rows.append({"name": name, "value": f"{given.value:g} {unit}", "status": MEASURED if given.verified else ESTIMATE})

    pieces = _pieces(spec, family)
    fabric_text = " ".join(spec.preferred_fabrics).lower()
    nap = any(k in fabric_text for k in NAP_FABRICS)
    large = [p.name for p in pieces if p.size == "large" and p.fabric == "main"]
    layout_steps = [
        "Pre-wash or steam the fabric first if it may shrink, then press it flat.",
        ("Place the large pieces first (" + ", ".join(large) + "), then fit medium and small pieces into the gaps."
         if large else "Place the biggest pieces first, then fit the smaller ones into the gaps."),
        "Put every piece marked 'on the fold' against the folded edge.",
        "Keep each grainline parallel to the selvedge; measure from both ends of the grainline to check.",
        "Cut lining and interfacing pieces separately, from their own fabric.",
    ]
    for handling in handling_for(spec):
        layout_steps += handling.cutting
    warnings = [DISCLAIMER, "The cutting layout diagram is NOT TO SCALE. It only shows the order and direction of the pieces."]
    if missing:
        warnings.append(f"{len(missing)} measurement(s) are missing: the pattern cannot be drafted until they are taken.")
    if any(r["status"] == ESTIMATE for r in rows):
        warnings.append("Some measurements are estimates. Measure the wearer before drafting.")
    return PatternOutput(
        disclaimer=DISCLAIMER,
        garment=spec.garment_category or "Garment",
        unit=unit,
        required_measurements=rows,
        missing_measurements=missing,
        pieces=pieces,
        drafting_steps=_drafting(spec, family, required),
        layout=CuttingLayout(
            fold=("Single layer, pile side down, every piece pointing the same way (the fabric has a nap)." if nap
                  else "Fold lengthwise, selvedge to selvedge, right sides together."),
            nap=nap,
            steps=layout_steps,
        ),
        warnings=warnings,
    )
