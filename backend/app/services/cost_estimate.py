"""Cost estimate: ordinary arithmetic on prices the user typed in.

The app has no price data, so it never fills in a price, a fabric length or a
labour charge. Lines without a price or quantity are listed as missing and left
out of the total. Labour is kept separate from materials, and every assumption
behind the numbers is written out.
"""

from __future__ import annotations

from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    CostEstimateOutput,
    CostInputs,
    CostLine,
    CostLineInput,
    FabricOutput,
    LabourInput,
    LabourLine,
    MaterialsOutput,
)

KIND_BY_CATEGORY = {"material": "other", "notion": "notion", "embellishment": "embellishment"}


def starter_inputs(spec: DesignSpec, materials: MaterialsOutput | None, fabric: FabricOutput | None) -> CostInputs:
    """Lines to price, taken from the design (no prices, no quantities)."""
    lines: list[CostLineInput] = []
    for name in spec.preferred_fabrics:
        lines.append(CostLineInput(item=f"Main fabric: {name}", kind="fabric", unit="m"))
    if not spec.preferred_fabrics:
        lines.append(CostLineInput(item="Main fabric", kind="fabric", unit="m"))
    if fabric and (fabric.lining_options or fabric.lining):
        name = fabric.lining_options[0].name if fabric.lining_options else fabric.lining[0]
        lines.append(CostLineInput(item=f"Lining: {name}", kind="lining", unit="m"))
    for item in materials.items if materials else []:
        if item.category == "tool" or item.optional:
            continue  # tools are usually owned; optional extras are left for the user to add
        lowered = item.item.lower()
        if lowered.startswith("main fabric") or lowered.startswith("lining") or "pattern paper" in lowered:
            continue
        kind = "lining" if "lining" in lowered else KIND_BY_CATEGORY.get(item.category, "other")
        lines.append(CostLineInput(item=item.item[:120], kind=kind))  # type: ignore[arg-type]
    labour = [LabourInput(task="Stitching (tailor's charge)")]
    if spec.embellishments:
        labour.append(LabourInput(task="Embellishment / handwork: " + ", ".join(spec.embellishments)[:90]))
    if spec.tailor.references or spec.fit:
        labour.append(LabourInput(task="Trial fitting and alterations"))
    return CostInputs(currency=spec.budget.currency or "INR", materials=lines[:60], labour=labour)


def _status(line: CostLineInput) -> str:
    if line.quantity is None and line.unit_price is None:
        return "missing_both"
    if line.unit_price is None:
        return "missing_price"
    if line.quantity is None:
        return "missing_quantity"
    return "priced"


def estimate_cost(spec: DesignSpec, inputs: CostInputs) -> CostEstimateOutput:
    currency = inputs.currency.strip() or spec.budget.currency or "INR"
    materials: list[CostLine] = []
    for line in inputs.materials:
        status = _status(line)
        total = round(line.quantity * line.unit_price, 2) if status == "priced" else None  # type: ignore[operator]
        materials.append(CostLine(**line.model_dump(), line_total=total, status=status))  # type: ignore[arg-type]
    labour = [LabourLine(**l.model_dump(), status="quoted" if l.amount is not None else "missing") for l in inputs.labour]

    materials_subtotal = round(sum(m.line_total or 0 for m in materials), 2)
    contingency = round(materials_subtotal * inputs.contingency_percent / 100, 2)
    labour_subtotal = round(sum(l.amount or 0 for l in labour), 2)
    total = round(materials_subtotal + contingency + labour_subtotal, 2)

    missing = [
        f"{m.item}: " + {"missing_price": "price", "missing_quantity": "quantity",
                         "missing_both": "quantity and price"}[m.status]
        for m in materials if m.status != "priced"
    ] + [f"{l.task}: amount" for l in labour if l.status == "missing"]

    where = f" for {inputs.region.strip()}" if inputs.region.strip() else ""
    when = f" (checked {inputs.price_date.strip()})" if inputs.price_date.strip() else ""
    assumptions = [
        f"Every price and quantity here was entered by you{where}{when}. The app has no live price data; "
        "prices change by city, shop and season.",
        "Fabric lengths are the ones you entered. Real lengths depend on measurements, fabric width and pattern "
        "layout, so confirm them with your tailor.",
        "Labour is shown separately from materials and is only what you entered as a quote.",
        "Tools you already own are not counted.",
    ]
    if not inputs.region.strip():
        assumptions.append("No region given: note where these prices come from, because they vary a lot by place.")
    if inputs.contingency_percent:
        assumptions.append(
            f"A {inputs.contingency_percent:g}% buffer is added to materials only, for wastage and small extras "
            "(your choice; change it any time)."
        )
    else:
        assumptions.append("No buffer is added for wastage or small extras.")
    if missing:
        assumptions.append(f"{len(missing)} line(s) have no price, quantity or amount and are NOT in the total.")

    budget_amount = spec.budget.amount
    budget_currency = spec.budget.currency
    status, note = "unknown", "No budget set in the design spec."
    if budget_amount is not None:
        if budget_currency.strip().upper() != currency.upper():
            note = f"The budget is in {budget_currency} but this estimate is in {currency}, so they are not compared."
        elif missing:
            status = "over" if total > budget_amount else "unknown"
            note = (f"Already over budget by {total - budget_amount:,.2f} {currency}, even before the missing lines."
                    if status == "over" else "Cannot compare with the budget until the missing lines are filled in.")
        else:
            status = "within" if total <= budget_amount else "over"
            difference = abs(budget_amount - total)
            note = (f"{difference:,.2f} {currency} under the budget." if status == "within"
                    else f"{difference:,.2f} {currency} over the budget.")

    return CostEstimateOutput(
        currency=currency,
        region=inputs.region.strip(),
        price_date=inputs.price_date.strip(),
        materials=materials,
        labour=labour,
        materials_subtotal=materials_subtotal,
        contingency_percent=inputs.contingency_percent,
        contingency_amount=contingency,
        labour_subtotal=labour_subtotal,
        total=total,
        complete=not missing,
        missing=missing,
        assumptions=assumptions,
        budget_amount=budget_amount,
        budget_currency=budget_currency,
        budget_status=status,  # type: ignore[arg-type]
        budget_note=note,
    )
