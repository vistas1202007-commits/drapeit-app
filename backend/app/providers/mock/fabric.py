"""MOCK fabric recommendations and tools/materials checklist.

These use a hand-written table of common fabrics and simple scoring rules.
They are NOT AI and do not know real prices, so `approximate_cost` is always
left empty. `cost_level` only says whether a fabric is usually cheaper or
costlier than the others in the table.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.providers.base import ProviderInfo, UsageMeter
from app.providers.mock.sketch import COLOUR_HEX
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    ChecklistItem,
    FabricOutput,
    FabricRecommendation,
    MaterialsOutput,
    Suggestion,
)
from app.services.fabric_handling import handling_for


@dataclass(frozen=True)
class FabricFacts:
    name: str
    colour: str
    texture: str
    drape: str
    breathability: str
    comfort: str
    maintenance: str  # easy | moderate | delicate
    weight: str  # light | medium | heavy
    cost_level: str  # low | medium | high, compared with the rest of this table
    properties: list[str]
    advantages: list[str]
    limitations: list[str]
    care: str
    good_for: set[str] = field(default_factory=set)  # occasion / garment keywords
    climates: set[str] = field(default_factory=set)
    formality: int = 1  # 1 casual, 2 smart, 3 festive / formal
    lining_needed: bool = False


CATALOGUE: list[FabricFacts] = [
    FabricFacts("Cotton (cambric / poplin)", "#efe9dd", "plain", "low", "high", "high", "easy", "light", "low",
                ["Natural fibre", "Crisp hand-feel"], ["Comfortable in heat", "Easy to stitch for beginners"],
                ["Creases easily", "Little natural drape"], "Machine wash cold, iron while damp.",
                {"kurta", "kurti", "shirt", "casual", "office", "salwar", "top", "dress", "everyday"}, {"hot", "humid"}, 1),
    FabricFacts("Mul cotton (muslin)", "#f3eee4", "plain", "medium", "high", "high", "easy", "light", "low",
                ["Natural fibre", "Very soft, light weave"], ["Feather-light in summer", "Soft next to the skin"],
                ["Slightly sheer", "Wrinkles"], "Gentle machine wash, dry in shade.",
                {"kurti", "kurta", "dress", "maxi", "casual", "everyday", "lining"}, {"hot", "humid"}, 1),
    FabricFacts("Linen", "#d9cfbc", "slub", "medium", "high", "high", "moderate", "medium", "medium",
                ["Natural fibre", "Textured slub surface"], ["Very breathable", "Gets softer with washing"],
                ["Wrinkles heavily", "Can fray at seams"], "Gentle wash, finish seams to stop fraying.",
                {"shirt", "kurta", "trousers", "dress", "casual", "office", "jacket"}, {"hot"}, 2),
    FabricFacts("Rayon (viscose)", "#e6d4c8", "plain", "high", "medium", "high", "moderate", "light", "low",
                ["Semi-synthetic", "Soft and fluid"], ["Drapes well", "Affordable"],
                ["Can shrink", "Weak when wet"], "Hand wash cold, do not wring.",
                {"kurti", "kurta", "dress", "top", "casual", "anarkali", "maxi"}, {"hot", "humid"}, 1),
    FabricFacts("Modal", "#e9e0d6", "knit", "high", "high", "high", "easy", "light", "medium",
                ["Semi-synthetic", "Silky soft"], ["Very comfortable all day", "Resists shrinking better than rayon"],
                ["Clings to the body", "Can pill over time"], "Machine wash cold, dry flat.",
                {"kurti", "top", "dress", "casual", "everyday", "maxi"}, {"hot", "humid"}, 1),
    FabricFacts("Cotton silk", "#dcc79b", "plain", "medium", "high", "high", "moderate", "light", "medium",
                ["Silk-cotton blend", "Soft sheen"], ["Festive look that stays breathable", "Easier to handle than pure silk"],
                ["Creases", "Colours may bleed at first wash"], "Dry clean or gentle hand wash separately.",
                {"kurta", "salwar", "anarkali", "festive", "blouse", "office"}, {"hot", "humid"}, 2),
    FabricFacts("Georgette", "#c97a8a", "crepe", "high", "medium", "medium", "moderate", "light", "medium",
                ["Light, slightly grainy", "Semi-sheer"], ["Flowing drape for flared skirts", "Holds embroidery"],
                ["Slippery to cut", "Usually needs lining"], "Dry clean or gentle hand wash.",
                {"anarkali", "gown", "lehenga", "festive", "party", "wedding", "saree"}, {"hot", "humid"}, 3, True),
    FabricFacts("Chiffon", "#e8b7bf", "sheer", "high", "high", "medium", "delicate", "light", "medium",
                ["Very light", "Sheer"], ["Soft, floaty layers", "Good for dupattas and overlays"],
                ["Very slippery", "Needs lining", "Snags easily"], "Dry clean recommended.",
                {"gown", "anarkali", "party", "dupatta", "maxi"}, {"hot"}, 2, True),
    FabricFacts("Crepe", "#8c5a6a", "crepe", "high", "medium", "medium", "easy", "medium", "medium",
                ["Pebbled surface", "Medium weight"], ["Resists creasing", "Elegant drape"],
                ["Can stretch on bias", "Edges may curl"], "Dry clean or cold hand wash.",
                {"dress", "gown", "kurta", "office", "party", "jumpsuit", "trousers"}, set(), 2),
    FabricFacts("Silk (art or pure)", "#8a2240", "satin", "medium", "medium", "medium", "delicate", "medium", "high",
                ["Natural lustre", "Smooth"], ["Rich festive look", "Takes dye beautifully"],
                ["Pure silk is costly", "Water can mark it"], "Dry clean only.",
                {"wedding", "festive", "lehenga", "anarkali", "sherwani", "saree", "blouse"}, {"cold"}, 3),
    FabricFacts("Tussar silk", "#c9a46b", "slub", "medium", "high", "medium", "delicate", "medium", "high",
                ["Wild silk", "Natural gold tone and slub"], ["Earthy, handloom character", "Breathable for a silk"],
                ["Irregular texture", "Costly"], "Dry clean only.",
                {"kurta", "saree", "festive", "jacket", "sherwani", "office"}, {"hot"}, 2),
    FabricFacts("Banarasi brocade", "#9a2c3c", "satin", "low", "low", "low", "delicate", "heavy", "high",
                ["Woven metallic motifs", "Stiff"], ["Pattern is woven in: no embroidery needed", "Very festive"],
                ["Frays a lot", "Heavy and warm", "Hard for beginners"], "Dry clean only, store wrapped in muslin.",
                {"lehenga", "blouse", "sherwani", "jacket", "wedding", "festive"}, {"cold"}, 3, True),
    FabricFacts("Chanderi", "#e3cf9f", "sheer", "medium", "high", "high", "delicate", "light", "medium",
                ["Silk-cotton blend", "Light sheen"], ["Breathable yet festive", "Traditional handloom look"],
                ["Semi-sheer, often lined", "Delicate"], "Dry clean or very gentle hand wash.",
                {"kurta", "anarkali", "festive", "salwar", "blouse"}, {"hot"}, 3, True),
    FabricFacts("Velvet", "#4a1426", "pile", "medium", "low", "medium", "delicate", "heavy", "high",
                ["Dense pile", "Heavy"], ["Luxurious winter look", "Rich colour depth"],
                ["Hot to wear", "Hard to stitch: pile shifts", "Marks easily under the iron"],
                "Dry clean only, steam instead of ironing.",
                {"wedding", "lehenga", "blouse", "sherwani", "jacket", "party", "anarkali"}, {"cold"}, 3),
    FabricFacts("Organza", "#f1e3d3", "sheer", "low", "high", "low", "delicate", "light", "medium",
                ["Crisp", "Sheer", "Holds shape"], ["Adds volume", "Good for overlays and sleeves"],
                ["Scratchy next to skin", "Frays"], "Dry clean only.",
                {"lehenga", "gown", "blouse", "festive", "wedding", "sleeve"}, set(), 3, True),
    FabricFacts("Soft net", "#ead7dc", "sheer", "medium", "high", "low", "delicate", "light", "low",
                ["Open mesh", "Sheer"], ["Light volume for skirts and dupattas", "Takes sequins and stones"],
                ["Must be lined", "Snags on jewellery"], "Dry clean or very gentle hand wash.",
                {"lehenga", "gown", "dupatta", "party", "wedding"}, set(), 3, True),
    FabricFacts("Satin", "#a3394f", "satin", "high", "low", "low", "moderate", "medium", "low",
                ["Glossy face", "Smooth"], ["Evening shine", "Smooth lining choice"],
                ["Shows every pin mark", "Slippery"], "Dry clean or cool hand wash.",
                {"gown", "party", "blouse", "lining", "dress"}, set(), 2),
    FabricFacts("Cotton jersey (knit)", "#cfd4d8", "knit", "high", "high", "high", "easy", "light", "low",
                ["Stretch knit"], ["Comfortable and stretchy", "No closures needed"],
                ["Needs stretch stitch or overlock", "Can lose shape"], "Machine wash cold, dry flat.",
                {"top", "dress", "casual", "everyday"}, {"hot"}, 1),
    FabricFacts("Wool suiting", "#4b4f57", "twill", "medium", "medium", "medium", "moderate", "heavy", "high",
                ["Natural fibre", "Structured"], ["Warm", "Tailors and presses beautifully"],
                ["Costly", "Moths"], "Dry clean, steam press.",
                {"blazer", "jacket", "trousers", "sherwani", "office"}, {"cold"}, 2),
]

FORMAL_WORDS = {"wedding", "reception", "festive", "engagement", "sangeet", "party", "diwali", "eid"}
EASY_CARE_WORDS = {"everyday", "daily", "office", "casual", "work", "college", "travel", "kids"}
LONG_WEAR_WORDS = {"wedding", "office", "everyday", "daily", "travel", "all-day"}
LOW_BUDGET_WORDS = ("low", "tight", "cheap", "economical", "affordable", "budget", "kam", "sasta")
HIGH_BUDGET_WORDS = ("premium", "luxury", "no limit", "high", "flexible")
HEAVY_WORK = ("zari", "zardozi", "stone", "sequin", "bead", "mirror", "dabka")


def _keywords(spec: DesignSpec) -> set[str]:
    text = " ".join([spec.garment_category, spec.occasion, spec.silhouette, spec.idea]).lower()
    return {w.strip(",./()") for w in text.replace("/", " ").split()}


def _climate_key(spec: DesignSpec) -> str:
    c = spec.climate.lower()
    if "hot" in c or "summer" in c:
        return "hot"
    if "cold" in c or "winter" in c:
        return "cold"
    if "humid" in c or "monsoon" in c:
        return "humid"
    return ""


def _budget_preference(spec: DesignSpec) -> str:
    note = spec.budget.note.lower()
    if any(w in note for w in LOW_BUDGET_WORDS):
        return "low"
    if any(w in note for w in HIGH_BUDGET_WORDS):
        return "high"
    return ""


def _climate_fit(fabric: FabricFacts, climate: str) -> str:
    if not climate:
        return "Climate not set: add it to the spec for breathability advice."
    if climate == "hot":
        return {
            "high": "Breathable: comfortable in hot weather.",
            "medium": "Wearable in heat, though not the coolest choice.",
            "low": "Traps heat: better for cool evenings than hot days.",
        }[fabric.breathability]
    if climate == "cold":
        if fabric.weight == "heavy" or "cold" in fabric.climates:
            return "Warm and suited to cold weather."
        if fabric.weight == "light":
            return "Light: plan a jacket, shawl or warmer lining for cold weather."
        return "Fine for mild cold, especially with a lining."
    if fabric.breathability == "high" and fabric.maintenance != "delicate":
        return "Handles humid weather well."
    return "May feel sticky or show marks in humid weather."


def _occasion_fit(fabric: FabricFacts, wanted: int, occasion: str) -> str:
    what = occasion.lower() or "this design"
    if fabric.formality == wanted:
        return f"Right level of dressiness for {what}."
    if fabric.formality > wanted:
        return f"Dressier than {what} usually needs."
    return f"May look too casual for {what}."


def _budget_note(fabric: FabricFacts, preference: str) -> str:
    note = {
        "low": "Usually one of the lower-cost options here.",
        "medium": "Usually mid-range among these options.",
        "high": "Usually among the costlier options here; a blend or art version costs less.",
    }[fabric.cost_level]
    if preference == "low" and fabric.cost_level == "high":
        return "Your budget note asks to keep costs down. " + note
    return note


class MockFabricProvider:
    info = ProviderInfo(
        name="mock-fabric-rules",
        is_mock=True,
        note="Scores a built-in table of 19 fabrics with simple rules. No real prices.",
    )

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms

    def recommend_fabrics(self, spec: DesignSpec, meter: UsageMeter | None = None) -> FabricOutput:
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        words = _keywords(spec)
        climate = _climate_key(spec)
        budget_pref = _budget_preference(spec)
        wanted_formality = 3 if words & FORMAL_WORDS else (2 if "office" in words else 1)
        flared = any(k in words for k in ("flared", "flare", "anarkali", "lehenga", "gown"))
        easy_care = bool(words & EASY_CARE_WORDS)
        long_wear = bool(words & LONG_WEAR_WORDS)
        main_colour = next(
            (COLOUR_HEX[c.lower()] for c in spec.colour_palette if c.lower() in COLOUR_HEX), None
        )

        scored: list[tuple[int, FabricFacts, str]] = []
        for fabric in CATALOGUE:
            score, reasons = 40, []
            matches = words & fabric.good_for
            if matches:
                score += 12 * min(len(matches), 3)
                reasons.append("commonly used for " + ", ".join(sorted(matches)))
            score -= 10 * abs(fabric.formality - wanted_formality)
            if climate and climate in fabric.climates:
                score += 10
                reasons.append(f"suits {spec.climate.lower()} weather")
            elif climate == "hot" and fabric.breathability == "low":
                score -= 15
            elif climate == "cold" and fabric.weight == "light" and fabric.breathability == "high":
                score -= 5
            if flared and fabric.drape == "high":
                score += 10
                reasons.append("high drape helps a flared skirt fall well")
            if any(f.lower().split()[0] in fabric.name.lower() for f in spec.preferred_fabrics if f.strip()):
                score += 20
                reasons.append("you mentioned this fabric")
            if spec.embellishments and fabric.formality == 3:
                score += 5
                reasons.append("holds embellishment well")
            if spec.skill_level == "beginner" and fabric.texture in ("sheer", "pile", "satin"):
                score -= 8
            if budget_pref == "low":
                score += {"low": 6, "medium": 0, "high": -12}[fabric.cost_level]
            elif budget_pref == "high" and fabric.cost_level == "high":
                score += 4
            if easy_care:
                score += {"easy": 6, "moderate": 0, "delicate": -6}[fabric.maintenance]
                if fabric.maintenance == "easy":
                    reasons.append("easy to look after")
            if long_wear and fabric.comfort != "medium":
                score += 5 if fabric.comfort == "high" else -5
                if fabric.comfort == "high":
                    reasons.append("comfortable for long wear")
            scored.append((max(0, min(100, score)), fabric, "; ".join(reasons)))

        scored.sort(key=lambda t: t[0], reverse=True)
        top = scored[:6]
        recs = [
            FabricRecommendation(
                name=f.name,
                swatch_colour=main_colour or f.colour,
                texture=f.texture,  # type: ignore[arg-type]
                suitability=(why.capitalize() + ".") if why else "General-purpose option.",
                properties=f.properties,
                advantages=f.advantages,
                limitations=f.limitations,
                care=f.care,
                drape=f.drape,  # type: ignore[arg-type]
                breathability=f.breathability,  # type: ignore[arg-type]
                approximate_cost=None,
                score=s,
                comfort=f.comfort,  # type: ignore[arg-type]
                maintenance=f.maintenance,  # type: ignore[arg-type]
                weight=f.weight,  # type: ignore[arg-type]
                cost_level=f.cost_level,  # type: ignore[arg-type]
                climate_fit=_climate_fit(f, climate),
                occasion_fit=_occasion_fit(f, wanted_formality, spec.occasion),
                budget_note=_budget_note(f, budget_pref),
                lining_needed=f.lining_needed,
            )
            for s, f, why in top
        ]

        lining_options = self._lining(top[:3], climate, flared, wanted_formality)
        return FabricOutput(
            recommendations=recs,
            lining=[o.name for o in lining_options],
            lining_options=lining_options,
            embellishment_options=self._embellishment(spec, top[:3], wanted_formality),
            complementary_materials=self._complementary(spec, wanted_formality),
            considerations=self._considerations(spec, climate, budget_pref),
        )

    @staticmethod
    def _lining(top: list[tuple[int, FabricFacts, str]], climate: str, flared: bool, formality: int) -> list[Suggestion]:
        options = [Suggestion(name="Mul cotton or cotton voile",
                              reason="Breathable next to the skin; the safest choice for heat and humidity.")]
        if flared or any(f.lining_needed for _, f, _ in top):
            options.append(Suggestion(name="Shantoon or butter crepe",
                                      reason="Smooth with a little weight, so sheer or flared panels hang well."))
        if climate == "cold":
            options.append(Suggestion(name="Satin lining",
                                      reason="Slides easily over warm layers worn underneath."))
        if formality == 3 and flared:
            options.append(Suggestion(name="Can-can or soft net layer (optional)",
                                      reason="Only if you want extra skirt volume."))
        return options

    @staticmethod
    def _embellishment(spec: DesignSpec, top: list[tuple[int, FabricFacts, str]], formality: int) -> list[Suggestion]:
        names = " ".join(f.name.lower() for _, f, _ in top)
        work = " ".join(spec.embellishments).lower()
        options: list[Suggestion] = []
        if spec.embellishments:
            options.append(Suggestion(name="Back embroidered areas with interfacing or organza",
                                      reason="Stops the fabric puckering under dense work."))
            if any(w in work for w in HEAVY_WORK) and any(k in names for k in ("chiffon", "georgette", "net")):
                options.append(Suggestion(name="Keep heavy work on lined or doubled panels",
                                          reason="Sheer fabric alone cannot carry heavy zari, stones or sequins."))
        elif formality == 3:
            options += [
                Suggestion(name="Gota patti or zari border on the hem",
                           reason="A festive finish without all-over work."),
                Suggestion(name="Light thread or sequin work on the yoke",
                           reason="Draws the eye to the neckline and keeps the garment light."),
            ]
        else:
            options.append(Suggestion(name="Contrast piping or tassels",
                                      reason="A simple detail that suits everyday wear."))
        if "velvet" in names:
            options.append(Suggestion(name="Zardozi or dabka work",
                                      reason="Raised metal work shows up well on velvet pile."))
        return options

    @staticmethod
    def _complementary(spec: DesignSpec, formality: int) -> list[str]:
        complementary = []
        if spec.embellishments:
            complementary += ["Embroidery threads matched to the palette", "Interfacing behind embroidered areas"]
        complementary += ["Matching thread (polyester all-purpose)", "Fusible interfacing for neckline facings"]
        if formality == 3:
            complementary.append("Contrast piping or lace trim for edges")
        return complementary

    @staticmethod
    def _considerations(spec: DesignSpec, climate: str, budget_pref: str) -> list[str]:
        considerations = [
            "Fabric choices come from a built-in table, not live market data.",
            "Prices are not shown because no reliable price source is connected. Add your own prices in Cost Estimate.",
            "'Relative cost' only compares these fabrics with each other; it is not a price.",
        ]
        if not climate:
            considerations.append("Add the climate to the spec for better breathability advice.")
        if spec.budget.amount is None and not budget_pref:
            considerations.append("Add a budget, or a note such as 'keep it economical', to weigh fabric cost.")
        if spec.skill_level == "beginner":
            considerations.append("Sheer, pile and satin fabrics are scored lower because they are harder to sew.")
        return considerations


class MockMaterialsProvider:
    info = ProviderInfo(
        name="mock-materials-rules",
        is_mock=True,
        note="Builds a checklist from simple rules about the design spec.",
    )

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms

    def tools_and_materials(self, spec: DesignSpec, meter: UsageMeter | None = None) -> MaterialsOutput:
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        main_fabric = spec.preferred_fabrics[0] if spec.preferred_fabrics else ""
        items = [
            ChecklistItem(item="Measuring tape", category="tool", reason="Take and check body measurements."),
            ChecklistItem(item="Fabric scissors", category="tool", reason="Clean cuts on the main fabric."),
            ChecklistItem(item="Tailor's chalk or fabric marker", category="tool", reason="Mark pattern lines."),
            ChecklistItem(item="Pins and pin cushion", category="tool", reason="Hold pieces together before sewing."),
            ChecklistItem(item="Sewing machine", category="tool", reason="Main seams."),
            ChecklistItem(item="Iron and pressing cloth", category="tool", reason="Press seams as you sew."),
            ChecklistItem(item="Seam ripper", category="tool", reason="Undo mistakes without damaging fabric."),
            ChecklistItem(item="Pattern paper", category="material", reason="Draft and keep the pattern."),
            ChecklistItem(
                item=f"Main fabric: {main_fabric}" if main_fabric else "Main fabric (not chosen yet)",
                category="material",
                reason="Length depends on measurements, fabric width and pattern layout: ask your tailor.",
                linked_to=f"Fabric: {main_fabric}" if main_fabric else "Fabric Studio",
            ),
            ChecklistItem(item="Matching thread", category="material", reason="Construction seams.",
                          linked_to=f"Colour: {spec.colour_palette[0]}" if spec.colour_palette else ""),
        ]
        words = " ".join([spec.garment_category, spec.silhouette, spec.idea, *spec.closures]).lower()
        garment = spec.garment_category or "Garment"
        if any(k in words for k in ("anarkali", "lehenga", "gown", "flare", "blouse")):
            items.append(ChecklistItem(item="Lining fabric", category="material",
                                       reason="Flared or fitted festive pieces are usually lined.",
                                       linked_to=f"Garment: {garment}"))
        closures = [c.lower() for c in spec.closures]
        if not closures:
            if any(k in words for k in ("blouse", "anarkali", "gown", "dress", "lehenga")):
                closures = ["zip"]
            elif any(k in words for k in ("shirt", "kurta", "jacket", "sherwani")):
                closures = ["buttons"]
        for closure in closures:
            link = f"Closure: {closure}"
            if "zip" in closure:
                items.append(ChecklistItem(item="Invisible zip + zipper foot", category="notion",
                                           reason="Side or back opening.", linked_to=link,
                                           quantity_hint="1 zip, as long as the opening (measure it)"))
            if "button" in closure:
                items.append(ChecklistItem(item="Buttons and buttonhole thread", category="notion",
                                           reason="Front or placket opening.", linked_to=link,
                                           quantity_hint="Count the buttons on the sketch"))
            if "hook" in closure:
                items.append(ChecklistItem(item="Hooks and eyes", category="notion", reason="Neat closures at edges.",
                                           linked_to=link))
            if "tie" in closure or "dori" in closure:
                items.append(ChecklistItem(item="Dori / tie cords with tassels", category="notion",
                                           reason="Tie-up closure.", linked_to=link))
        items.append(ChecklistItem(item="Fusible interfacing", category="material",
                                   reason="Stabilise neckline and facings.",
                                   linked_to=f"Neckline: {spec.neckline}" if spec.neckline else ""))
        neckline = spec.neckline.lower()
        if any(k in neckline for k in ("v-neck", "v neck", "sweetheart", "deep", "keyhole", "u-neck")):
            items.append(ChecklistItem(item="Stay tape", category="notion",
                                       reason="Stops a shaped or deep neckline from stretching out.",
                                       linked_to=f"Neckline: {spec.neckline}"))
        sleeves = spec.sleeve_style.lower()
        if "full" in sleeves or "long" in sleeves or "bishop" in sleeves:
            items.append(ChecklistItem(item="Sleeve board", category="tool", optional=True,
                                       reason="Press long sleeve seams without creasing the other side.",
                                       linked_to=f"Sleeves: {spec.sleeve_style}"))
        if "puff" in sleeves or "bishop" in sleeves:
            items.append(ChecklistItem(item="Elastic or cuff interfacing", category="notion",
                                       reason="Gathers the sleeve at the hem or cuff.",
                                       linked_to=f"Sleeves: {spec.sleeve_style}"))
        for handling in handling_for(spec):
            for name, category, reason in handling.supplies:
                items.append(ChecklistItem(item=name, category=category, reason=reason,  # type: ignore[arg-type]
                                           linked_to=f"Fabric: {handling.label.lower()}"))
        for emb in spec.embellishments:
            e = emb.lower()
            link = f"Embellishment: {emb}"
            if "embroider" in e or "zari" in e or "zardozi" in e or "thread" in e:
                items += [
                    ChecklistItem(item="Embroidery hoop", category="tool", reason=f"Keeps fabric tight for {e}.",
                                  linked_to=link),
                    ChecklistItem(item="Embroidery / zari threads", category="embellishment",
                                  reason="Choose shades from the colour palette.", linked_to=link),
                ]
            elif "sequin" in e or "bead" in e or "stone" in e or "mirror" in e:
                items.append(ChecklistItem(item=f"{emb} and beading needles", category="embellishment",
                                           reason="Hand-applied embellishment.", linked_to=link))
            else:
                items.append(ChecklistItem(item=emb, category="embellishment", reason="Requested embellishment.",
                                           linked_to=link))
        if any(k in words for k in ("lehenga", "anarkali", "gown")):
            items.append(ChecklistItem(item="Can-can / net for volume", category="material",
                                       reason="Only if extra flare is wanted.", optional=True,
                                       linked_to=f"Silhouette: {spec.silhouette or garment}"))
        # Remove duplicates while keeping order.
        unique: dict[str, ChecklistItem] = {}
        for it in items:
            unique.setdefault(it.item, it)
        notes = ["Fabric lengths are not calculated: they depend on measurements, fabric width and pattern layout. "
                 "Ask your tailor, then price everything in Cost Estimate."]
        if not main_fabric:
            notes.append("Save a fabric in Fabric Studio to get fabric-specific needles and tools.")
        return MaterialsOutput(items=list(unique.values()), notes=notes)
