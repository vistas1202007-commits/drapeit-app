"""Builds the tailor specification sheet.

This is ordinary code, not AI: it gathers the design spec, the measurements,
the designer's own notes and the saved fabric / materials / design-plan outputs
into one document. It never invents measurements or cutting dimensions.
Anything missing is listed as missing, and estimates are labelled as estimates.
"""

from __future__ import annotations

from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    DesignPlan,
    FabricOutput,
    MaterialsOutput,
    SheetReference,
    TailorSheetOutput,
    TailorSheetSection,
)
from app.services.fabric_handling import handling_for

# Measurements a tailor usually needs, by garment family.
UPPER = ["Bust / chest", "Waist", "Shoulder width", "Armhole", "Sleeve length", "Neck depth (front)",
         "Neck depth (back)"]
LOWER = ["Waist", "Hip", "Inseam", "Outseam / full length", "Thigh", "Ankle opening"]
FULL = ["Bust / chest", "Waist", "Hip", "Shoulder width", "Armhole", "Sleeve length", "Full length",
        "Neck depth (front)", "Neck depth (back)"]

MEASURED = "Measured"
ESTIMATE = "Estimate – verify before cutting"
MISSING = "Missing – measure the wearer"

VIEW_ORDER = {"front": 0, "back": 1, "side": 2, "detail": 3}


def required_measurements(spec: DesignSpec) -> list[str]:
    cat = spec.garment_category.lower()
    if cat in {"trousers", "pants"}:
        return LOWER
    if cat == "skirt":
        return ["Waist", "Hip", "Skirt length"]
    if cat in {"blouse", "saree blouse", "shirt", "top", "jacket", "blazer"}:
        required = UPPER + ["Garment length"]
    elif cat == "lehenga":
        required = UPPER + ["Hip", "Skirt length"]
    else:
        required = list(FULL)
    sleeves = spec.sleeve_style.lower()
    if "sleeveless" in sleeves:
        required = [r for r in required if r != "Sleeve length"]
    elif "full" in sleeves or "long" in sleeves:
        required.append("Wrist (sleeve opening)")
    return required


def _matches(required: str, given: str) -> bool:
    a, b = required.lower(), given.lower()
    return any(part.strip() and part.strip() in b for part in a.replace("(", "/").replace(")", "").split("/"))


def _user_lines(text: str) -> list[str]:
    return [line.strip(" -•\t") for line in text.splitlines() if line.strip(" -•\t")]


def _construction(spec: DesignSpec, plan: DesignPlan | None) -> list[str]:
    notes = [f"Designer: {line}" for line in _user_lines(spec.tailor.construction)]
    if plan and plan.construction_overview:
        notes += [f"{s.step}" + (f" ({s.note})" if s.note else "") for s in plan.construction_overview]
    else:
        notes.append(
            "General order (adapt to your own method): prepare pattern → cut → stay-stitch neckline → "
            "darts / princess seams → shoulder seams → neckline finish → sleeves → side seams → closures → hem."
        )
    if spec.embellishments:
        notes.insert(0, "Finish embroidery or embellishment on the cut panels before assembling the garment.")
    fit = spec.fit.lower()
    if "fitted" in fit or "slim" in fit or "tailored" in fit:
        notes.append("Fitted garment: tack it together for a trial fitting before final stitching.")
    neckline = spec.neckline.lower()
    if neckline:
        notes.append(f"Neckline ({spec.neckline}): stay-stitch it right after cutting so it keeps its shape.")
    if any(k in neckline for k in ("v-neck", "v neck", "sweetheart", "keyhole")):
        notes.append("Reinforce the point of the neckline before clipping into it.")
    sleeves = spec.sleeve_style.lower()
    if "puff" in sleeves or "bishop" in sleeves:
        notes.append(f"Sleeves ({spec.sleeve_style}): gather the sleeve head evenly before setting it in.")
    elif sleeves and "sleeveless" not in sleeves:
        notes.append(f"Sleeves ({spec.sleeve_style}): check sleeve length on the wearer with the arm slightly bent.")
    for closure in spec.closures:
        if "zip" in closure.lower():
            notes.append(f"Closure ({closure}): insert the zip before closing the seam it sits in.")
            break
    if any(k in spec.garment_category.lower() for k in ("anarkali", "lehenga", "gown")):
        notes.append("Gather or pleat the skirt evenly; check the flare hangs level before hemming.")
        notes.append("Attach the lining separately and join at the waist seam and neckline.")
    notes.append("Press every seam before crossing it with another seam.")
    return notes


def _cutting(spec: DesignSpec) -> list[str]:
    notes = [f"Designer: {line}" for line in _user_lines(spec.tailor.cutting)]
    notes += [
        "Pre-wash or steam the fabric first if it may shrink.",
        "Check the grainline on every pattern piece before cutting.",
        "Add seam allowance to every piece. Agree the amount with the tailor; this sheet does not set it.",
        "No cutting dimensions are given here: draft the pattern from the wearer's own measurements.",
    ]
    for handling in handling_for(spec):
        notes += handling.cutting
    return notes


def _stitching(spec: DesignSpec) -> list[str]:
    notes = [f"Designer: {line}" for line in _user_lines(spec.tailor.stitching)]
    handled = handling_for(spec)
    for handling in handled:
        notes += handling.stitching
    if not handled:
        notes.append("Save a fabric in Fabric Studio to add fabric-specific stitching advice here.")
    notes.append("Test stitch length and tension on a scrap of the real fabric first.")
    return notes


def build_tailor_sheet(
    spec: DesignSpec,
    materials: MaterialsOutput,
    fabric: FabricOutput | None = None,
    plan: DesignPlan | None = None,
) -> TailorSheetOutput:
    dash = "Not specified"
    unit = spec.measurement_unit
    design_rows = [
        ("Garment", spec.garment_category or dash),
        ("Occasion", spec.occasion or dash),
        ("Silhouette", spec.silhouette or dash),
        ("Fit", spec.fit or dash),
        ("Neckline", spec.neckline or dash),
        ("Sleeves", spec.sleeve_style or dash),
        ("Length", spec.garment_length or dash),
        ("Closures", ", ".join(spec.closures) or dash),
        ("Embellishments", ", ".join(spec.embellishments) or "None"),
        ("Colours", ", ".join(spec.colour_palette) or dash),
    ]
    lining = "Not chosen yet (see Fabric Studio)"
    if fabric:
        names = [o.name for o in fabric.lining_options] or fabric.lining
        if names:
            lining = f"{names[0]} (suggested; confirm with the tailor)"
    fabric_rows = [
        ("Main fabric", ", ".join(spec.preferred_fabrics) or "Not chosen yet (see Fabric Studio)"),
        ("Lining", lining),
        ("Fabric requirements", spec.fabric_requirements or dash),
        ("Climate", spec.climate or dash),
    ]
    budget = f"{spec.budget.amount:g} {spec.budget.currency}" if spec.budget.amount is not None else dash
    client_rows = [("Skill level of maker", spec.skill_level), ("Budget", budget)]

    measurements = [
        {
            "name": m.name,
            "value": f"{m.value:g} {unit}",
            "status": MEASURED if m.verified else ESTIMATE,
            "note": m.note,
        }
        for m in spec.measurements
    ]
    missing = [r for r in required_measurements(spec) if not any(_matches(r, m.name) for m in spec.measurements)]
    measurements += [{"name": name, "value": "—", "status": MISSING, "note": ""} for name in missing]

    references = sorted(
        (SheetReference(asset_id=r.asset_id, view=r.view, note=r.note) for r in spec.tailor.references),
        key=lambda r: VIEW_ORDER.get(r.view, 9),
    )

    warnings = ["This sheet is conceptual guidance, not a verified production pattern."]
    if missing:
        warnings.append(f"{len(missing)} required measurement(s) are missing, so no cutting dimensions are given.")
    estimates = sum(1 for m in spec.measurements if not m.verified)
    if estimates:
        warnings.append(f"{estimates} measurement(s) are estimates. Measure the wearer before cutting.")
    if not any(r.view == "front" for r in references) or not any(r.view == "back" for r in references):
        warnings.append("Pick a front and a back reference picture in the Tailor Workspace.")
    if spec.unresolved_questions:
        warnings.append("Open questions remain in the design spec (listed below).")

    material_rows = [
        (i.item, ("Optional – " if i.optional else "") + i.reason + (f" [{i.quantity_hint}]" if i.quantity_hint else ""))
        for i in materials.items
    ]
    sections = [
        TailorSheetSection(heading="Design", rows=design_rows),
        TailorSheetSection(heading="Fabric & lining", rows=fabric_rows),
        TailorSheetSection(heading="Client & budget", rows=client_rows),
        TailorSheetSection(heading="Materials & tools", rows=material_rows),
    ]
    if spec.design_notes:
        sections.append(TailorSheetSection(heading="Design notes", rows=[("Notes", spec.design_notes)]))
    return TailorSheetOutput(
        title=spec.title or f"{spec.garment_category or 'Garment'} specification",
        sections=sections,
        measurements=measurements,
        missing_measurements=missing,
        construction_notes=_construction(spec, plan),
        cutting_notes=_cutting(spec),
        stitching_notes=_stitching(spec),
        warnings=warnings,
        unit=unit,
        references=references,
        open_questions=list(spec.unresolved_questions),
    )
