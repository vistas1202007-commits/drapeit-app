"""MOCK idea understanding.

This is NOT artificial intelligence. It looks for known words in the idea
(like "anarkali", "wine", "embroidered") and fills in the design spec. It lets
us build and test the whole workflow for free. In Phase 2 a real language
model (the Anthropic API) will replace it behind the same interface.
"""

from __future__ import annotations

import re
import time

from app.providers.base import ProviderInfo, UsageMeter
from app.schemas.design_spec import DesignSpec
from app.providers.mock.sketch import COLOUR_HEX
from app.schemas.outputs import ColourSwatch, ConstructionStep, DesignConceptOutput, DesignDetail, DesignPlan

# garment keyword -> (category, default silhouette, default length)
GARMENTS: dict[str, tuple[str, str, str]] = {
    "anarkali": ("Anarkali", "Fitted bodice with a flared, floor-sweeping skirt", "Floor length"),
    "lehenga": ("Lehenga", "Flared skirt with fitted blouse", "Floor length"),
    "saree blouse": ("Saree blouse", "Fitted, cropped", "Cropped"),
    "blouse": ("Blouse", "Fitted", "Hip length"),
    "kurti": ("Kurti", "Straight", "Knee length"),
    "kurta": ("Kurta", "Straight", "Knee length"),
    "salwar": ("Salwar suit", "Straight tunic with relaxed trousers", "Knee length"),
    "sherwani": ("Sherwani", "Structured, straight", "Knee length"),
    "gown": ("Gown", "Fitted bodice with full skirt", "Floor length"),
    "maxi": ("Maxi dress", "Relaxed A-line", "Floor length"),
    "dress": ("Dress", "A-line", "Knee length"),
    "skirt": ("Skirt", "A-line", "Midi length"),
    "shirt": ("Shirt", "Regular fit", "Hip length"),
    "top": ("Top", "Relaxed", "Hip length"),
    "jacket": ("Jacket", "Tailored", "Hip length"),
    "blazer": ("Blazer", "Tailored", "Hip length"),
    "jumpsuit": ("Jumpsuit", "Straight", "Ankle length"),
    "trousers": ("Trousers", "Straight", "Ankle length"),
    "pants": ("Trousers", "Straight", "Ankle length"),
}

COLOURS = [
    "wine", "maroon", "burgundy", "red", "crimson", "pink", "blush", "peach", "coral", "orange",
    "mustard", "yellow", "gold", "ivory", "cream", "white", "beige", "olive", "green", "emerald",
    "mint", "teal", "turquoise", "blue", "navy", "royal blue", "sky blue", "lavender", "purple",
    "plum", "grey", "silver", "black", "brown", "rust",
]

NECKLINES = {
    "v-neck": "V-neck", "v neck": "V-neck", "round neck": "Round neck", "boat neck": "Boat neck",
    "sweetheart": "Sweetheart", "high neck": "High neck", "mandarin": "Mandarin collar",
    "collar": "Shirt collar", "square neck": "Square neck", "halter": "Halter", "off-shoulder": "Off-shoulder",
    "off shoulder": "Off-shoulder", "keyhole": "Keyhole", "u-neck": "U-neck", "scoop": "Scoop neck",
}

SLEEVES = {
    "sleeveless": "Sleeveless", "cap sleeve": "Cap sleeves", "short sleeve": "Short sleeves",
    "elbow": "Elbow-length sleeves", "three-quarter": "Three-quarter sleeves", "3/4": "Three-quarter sleeves",
    "full sleeve": "Full-length sleeves", "long sleeve": "Full-length sleeves", "puff": "Puff sleeves",
    "bell sleeve": "Bell sleeves", "bishop": "Bishop sleeves", "flutter": "Flutter sleeves",
}

EMBELLISHMENTS = {
    "embroider": "Embroidery", "zari": "Zari work", "zardozi": "Zardozi", "sequin": "Sequins",
    "mirror": "Mirror work", "bead": "Beadwork", "lace": "Lace trim", "gota": "Gota patti",
    "thread work": "Thread work", "stone": "Stone work", "applique": "Appliqué", "print": "Print",
}

OCCASIONS = {
    "wedding": "Wedding", "reception": "Reception", "festive": "Festive", "festival": "Festive",
    "diwali": "Festive", "party": "Party", "office": "Office / work",
    "casual": "Casual / everyday", "daily": "Casual / everyday", "everyday": "Casual / everyday",
    "college": "Casual / everyday", "engagement": "Engagement", "sangeet": "Sangeet",
}

FITS = {"loose": "Loose", "relaxed": "Relaxed", "fitted": "Fitted", "slim": "Slim", "oversized": "Oversized"}
CLIMATES = {"summer": "Hot / summer", "hot": "Hot / summer", "winter": "Cold / winter", "monsoon": "Humid / monsoon"}
FABRICS = [
    "cotton", "linen", "silk", "georgette", "chiffon", "crepe", "velvet", "satin", "organza",
    "net", "rayon", "chanderi", "banarasi", "denim", "wool", "khadi",
]


def _has(text: str, word: str) -> bool:
    """True if `word` appears as a whole word (plurals like "sequins" also count)."""
    return re.search(rf"\b{re.escape(word)}(?:s|es|ed|ery|y)?\b", text) is not None


def _find(text: str, table: dict[str, str]) -> list[str]:
    seen: list[str] = []
    for key, value in table.items():
        if _has(text, key) and value not in seen:
            seen.append(value)
    return seen


class MockIdeaProvider:
    info = ProviderInfo(
        name="mock-keywords",
        is_mock=True,
        note="Keyword matching only. Not a real AI model.",
    )

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms

    def analyse_idea(self, idea: str, current: DesignSpec, meter: UsageMeter | None = None) -> DesignConceptOutput:
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        text = " " + re.sub(r"\s+", " ", idea.lower()) + " "
        spec = current.model_copy(deep=True)
        spec.idea = idea.strip()
        detected: list[str] = []
        assumptions: list[str] = []

        for key, (category, silhouette, length) in GARMENTS.items():
            if _has(text, key):
                spec.garment_category = category
                detected.append(f"Garment: {category}")
                if not spec.silhouette:
                    spec.silhouette = silhouette
                    assumptions.append(f"Silhouette assumed as typical for a {category.lower()}: {silhouette}.")
                if not spec.garment_length:
                    spec.garment_length = length
                    assumptions.append(f"Length assumed as {length.lower()}.")
                break

        colours = [c for c in COLOURS if _has(text, c)]
        # "royal blue" also matches "blue"; keep the more specific name only.
        colours = [c for c in colours if not any(c != o and c in o for o in colours)]
        if colours:
            spec.colour_palette = [c.title() for c in colours]
            detected.append("Colours: " + ", ".join(spec.colour_palette))

        for table, attr, label in (
            (NECKLINES, "neckline", "Neckline"),
            (SLEEVES, "sleeve_style", "Sleeves"),
            (OCCASIONS, "occasion", "Occasion"),
            (FITS, "fit", "Fit"),
            (CLIMATES, "climate", "Climate"),
        ):
            found = _find(text, table)
            if found:
                setattr(spec, attr, found[0])
                detected.append(f"{label}: {found[0]}")

        embellishments = _find(text, EMBELLISHMENTS)
        if embellishments:
            spec.embellishments = embellishments
            detected.append("Embellishments: " + ", ".join(embellishments))

        fabrics = [f.title() for f in FABRICS if _has(text, f)]
        if fabrics:
            spec.preferred_fabrics = fabrics
            detected.append("Fabrics mentioned: " + ", ".join(fabrics))

        if not spec.title:
            parts = [spec.colour_palette[0] if spec.colour_palette else "", spec.garment_category or "Garment design"]
            spec.title = " ".join(p for p in parts if p).strip()

        questions: list[str] = []
        if not spec.garment_category:
            questions.append("What type of garment is this (for example kurta, anarkali, dress, shirt)?")
        if not spec.occasion:
            questions.append("What occasion is it for?")
        if not spec.neckline:
            questions.append("What neckline would you like?")
        if not spec.sleeve_style:
            questions.append("What sleeve style would you like?")
        if not spec.colour_palette:
            questions.append("Which colours should it use?")
        if not spec.measurements:
            questions.append("Can you add the wearer's measurements? Without them the tailor sheet stays conceptual.")
        if spec.budget.amount is None:
            questions.append("What is the budget for fabric and materials?")

        spec.unresolved_questions = questions
        spec.assumptions = assumptions

        summary = (
            f"A {spec.garment_category.lower() or 'garment'}"
            + (f" in {', '.join(c.lower() for c in spec.colour_palette)}" if spec.colour_palette else "")
            + (f" for {spec.occasion.lower()}" if spec.occasion else "")
            + (f", with {', '.join(e.lower() for e in spec.embellishments)}" if spec.embellishments else "")
            + "."
        )
        spec.visual_description = _visual_description(spec)
        return DesignConceptOutput(
            summary=summary,
            proposed_spec=spec,
            detected=detected,
            unresolved_questions=questions,
            assumptions=assumptions,
            plan=_mock_plan(spec, summary),
        )


def _visual_description(spec: DesignSpec) -> str:
    bits = [
        spec.garment_category or "garment",
        spec.silhouette and f"silhouette: {spec.silhouette.lower()}",
        spec.garment_length and spec.garment_length.lower(),
        spec.neckline and spec.neckline.lower(),
        spec.sleeve_style and spec.sleeve_style.lower(),
        spec.colour_palette and "colours: " + ", ".join(c.lower() for c in spec.colour_palette),
        spec.embellishments and "details: " + ", ".join(e.lower() for e in spec.embellishments),
    ]
    return "; ".join(b for b in bits if b)


def _mock_plan(spec: DesignSpec, summary: str) -> DesignPlan:
    """A template plan filled from the detected keywords. Clearly a placeholder."""
    roles = ["main body", "accent", "trim", "detail"]
    colours = [
        ColourSwatch(name=c, hex=COLOUR_HEX.get(c.lower(), "#9a8f84"), role=roles[min(i, 3)])
        for i, c in enumerate(spec.colour_palette[:4])
    ]
    details = [
        DesignDetail(area=area, detail=value)
        for area, value in (
            ("Neckline", spec.neckline), ("Sleeves", spec.sleeve_style), ("Silhouette", spec.silhouette),
            ("Length", spec.garment_length), ("Surface work", ", ".join(spec.embellishments)),
        )
        if value
    ]
    steps = [
        ConstructionStep(step="Take and verify measurements", note="Nothing should be cut until these are confirmed."),
        ConstructionStep(step="Draft or adapt the base pattern"),
        ConstructionStep(step="Cut fabric and lining"),
    ]
    if spec.embellishments:
        steps.append(ConstructionStep(step="Finish embellishment on cut panels", note="Easier before panels are joined."))
    steps += [ConstructionStep(step="Assemble, fit and adjust"), ConstructionStep(step="Finish hems, closures and press")]
    hard = any(k in " ".join(spec.embellishments).lower() for k in ("zardozi", "zari", "beadwork", "stone"))
    return DesignPlan(
        concept_statement=f"MOCK PLAN (keyword template, not AI). {summary}",
        style_keywords=[k for k in (spec.occasion, spec.fit, spec.garment_category) if k],
        colour_story=colours,
        design_details=details,
        construction_overview=steps,
        fabric_direction=", ".join(spec.preferred_fabrics) or "Not chosen yet. Use Generate Fabric Recommendations.",
        difficulty="advanced" if hard else "intermediate",
        difficulty_reason="Template guess based on the embellishments mentioned.",
    )
