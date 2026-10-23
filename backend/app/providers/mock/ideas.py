"""MOCK design ideas: variations, moodboard and embroidery / print concepts.

Hand-written tables and simple rules, NOT AI. They let the whole Phase 4
workflow run for free; the Anthropic API replaces them when ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import time

from app.providers.base import ProviderInfo, UsageMeter
from app.providers.mock.fabric import CATALOGUE, FORMAL_WORDS
from app.providers.mock.sketch import COLOUR_HEX
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import (
    ColourSwatch,
    DesignVariation,
    EmbroideryConcept,
    EmbroideryOutput,
    MoodboardOutput,
    MoodTexture,
    VariationsOutput,
)

NECKLINE_WHY = {
    "Sweetheart": "Softens the bodice and suits festive, feminine looks.",
    "Boat neck": "Wide and elegant; leaves room for a heavy necklace-free look.",
    "High neck": "Regal and modest; frames embroidery at the collar.",
    "U-neck": "Deep and simple; pairs well with statement jewellery.",
    "V-neck": "Lengthens the neck and flatters most body types.",
    "Round neck": "Classic and easy to stitch for beginners.",
    "Square neck": "Structured and modern; shows off a yoke border.",
}
SLEEVE_WHY = {
    "Three-quarter sleeves": "Comfortable and lets bangles show.",
    "Bell sleeves": "Adds flow and movement for a dramatic look.",
    "Cap sleeves": "Light and cool for warm weather.",
    "Puff sleeves": "Playful volume at the shoulder.",
    "Full-length sleeves": "Elegant and warmer for winter events.",
    "Sleeveless": "Cool and minimal; lets the neckline lead.",
}
SILHOUETTES = {
    "anarkali": ["Angrakha-style overlap with a flared skirt", "Jacket-style anarkali with an open front"],
    "kurta": ["A-line kurta with side slits", "Straight kurta with a front yoke"],
    "kurti": ["A-line kurti with side slits", "Short straight kurti with a yoke"],
    "lehenga": ["Mermaid lehenga fitted to the knee", "Panelled A-line lehenga with cancan"],
    "gown": ["Empire-waist gown with a soft flare", "Layered ball gown"],
    "dress": ["Wrap dress with a tie waist", "Fit-and-flare dress"],
    "blouse": ["Peplum blouse", "Crop blouse with a back tie"],
}
PALETTES = [
    ("Jewel tones", ["Emerald", "Gold"]),
    ("Soft pastels", ["Blush", "Ivory", "Silver"]),
    ("Classic ivory and gold", ["Ivory", "Gold"]),
    ("Deep night", ["Navy", "Silver"]),
    ("Sunset", ["Coral", "Mustard"]),
]
MOOD_WORDS = {
    "wedding": ["regal", "celebratory"], "festive": ["joyful", "festive"], "party": ["glamorous"],
    "office": ["polished", "understated"], "casual": ["easy", "relaxed"], "winter": ["warm", "rich"],
    "summer": ["airy", "fresh"], "zari": ["heritage", "gilded"], "embroidery": ["crafted"],
    "mirror": ["playful", "folk"], "gota": ["traditional"], "pastel": ["soft"],
}
MOTIFS = {
    "zari": ["Paisley (keri) borders", "Jaal trellis in metallic thread"],
    "zardozi": ["Raised zardozi florals"], "gota": ["Gota patti leaf vines"],
    "mirror": ["Mirror-work medallions"], "embroider": ["Mughal floral buti"], "print": ["Block-printed buti"],
}

COSTLY_TECHNIQUES = ("zardozi", "zari")


def _hex(name: str) -> str:
    return COLOUR_HEX.get(name.lower(), "#9a8f84")


def _words(spec: DesignSpec) -> str:
    return " ".join([spec.garment_category, spec.occasion, spec.climate, spec.idea, *spec.embellishments]).lower()


def _formal(spec: DesignSpec) -> bool:
    return any(w in _words(spec) for w in FORMAL_WORDS)


class MockIdeasProvider:
    info = ProviderInfo(
        name="mock-ideas-rules",
        is_mock=True,
        note="Variations, moodboard and embroidery ideas from small built-in tables.",
    )

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms

    def _wait(self) -> None:
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)

    # ----- design variations -----

    def variations(self, spec: DesignSpec, meter: UsageMeter | None = None) -> VariationsOutput:
        self._wait()
        occasion = spec.occasion.lower() or "the occasion"
        out: list[DesignVariation] = []
        current_neck = spec.neckline.lower()
        for name in [n for n in NECKLINE_WHY if n.lower() != current_neck][:2]:
            out.append(DesignVariation(kind="neckline", name=f"{name} instead", neckline=name,
                                       description=f"Keep everything else; change the neckline to a {name.lower()}.",
                                       why=NECKLINE_WHY[name]))
        current_sleeve = spec.sleeve_style.lower()
        for name in [s for s in SLEEVE_WHY if s.lower() != current_sleeve][:2]:
            out.append(DesignVariation(kind="sleeves", name=name, sleeve_style=name,
                                       description=f"Swap the sleeves for {name.lower()}.", why=SLEEVE_WHY[name]))
        key = next((k for k in SILHOUETTES if k in spec.garment_category.lower()), "")
        for shape in (SILHOUETTES[key] if key else ["A-line with a fitted waist"])[:1]:
            out.append(DesignVariation(kind="silhouette", name=shape, silhouette=shape,
                                       description=f"A different shape for the same garment: {shape.lower()}.",
                                       why=f"Gives a new outline while keeping it right for {occasion}."))
        if spec.embellishments:
            out.append(DesignVariation(kind="embellishment", name="Lighter work: borders only",
                                       embellishments=[f"{spec.embellishments[0]} border on hem and sleeves"],
                                       description="Move the work to the borders and keep the body plain.",
                                       why="Lighter to wear, quicker to make and usually cheaper."))
        else:
            out.append(DesignVariation(kind="embellishment", name="Add yoke thread work",
                                       embellishments=["Thread work on the yoke"],
                                       description="Add a band of thread embroidery around the neckline.",
                                       why="Adds detail near the face without much extra weight."))
        current = {c.lower() for c in spec.colour_palette}
        for label, colours in [p for p in PALETTES if not current & {c.lower() for c in p[1]}][:2]:
            out.append(DesignVariation(kind="colour", name=label, colour_palette=colours,
                                       colour_hex=[_hex(c) for c in colours],
                                       description=f"Same design in {' and '.join(c.lower() for c in colours)}.",
                                       why=f"A different mood for {occasion} with the same cut."))
        base = ", ".join(v for v in (spec.garment_category, spec.neckline, spec.sleeve_style) if v) or "this design"
        return VariationsOutput(
            base_summary=f"Variations on: {base}.",
            variations=out,
            notes=["MOCK ideas from a small built-in table. Press “Try this” to save one as a new design version; "
                   "you can always restore the earlier version."],
        )

    # ----- moodboard -----

    def moodboard(self, spec: DesignSpec, meter: UsageMeter | None = None) -> MoodboardOutput:
        self._wait()
        words = _words(spec)
        mood = [w for key, ws in MOOD_WORDS.items() if key in words for w in ws]
        mood = list(dict.fromkeys(mood or ["elegant", "timeless"]))[:6]
        roles = ["Main", "Accent", "Highlight", "Neutral"]
        colours = list(dict.fromkeys(spec.colour_palette))[:3]
        if len(colours) < 3:
            colours += [c for c in ("Ivory", "Gold") if c not in colours][: 3 - len(colours)]
        palette = [ColourSwatch(name=c, hex=_hex(c), role=roles[i]) for i, c in enumerate(colours)]
        fabric_words = " ".join(spec.preferred_fabrics).lower()
        chosen = [f for f in CATALOGUE if f.name.split()[0].lower() in fabric_words]
        chosen += [f for f in CATALOGUE if f not in chosen and (f.formality == 3) == _formal(spec)]
        textures = [MoodTexture(name=f.name, texture=f.texture, colour=palette[0].hex,  # type: ignore[arg-type]
                                note=", ".join(f.properties[:2]))
                    for f in chosen[:3]]
        motifs = [m for key, ms in MOTIFS.items() if key in words for m in ms][:4] or ["Clean lines and tonal stitching"]
        references = (["Mughal miniature borders", "Palace arches and jharokhas", "Heirloom jewellery"]
                      if _formal(spec) else ["Indigo block prints", "Courtyard summer light", "Handloom textures"])
        garment = spec.title or spec.garment_category or "Design"
        return MoodboardOutput(
            title=f"{garment} moodboard",
            story=f"A {' and '.join(mood[:2])} look in {', '.join(c.lower() for c in colours)}, built around "
                  f"{(spec.occasion or 'the occasion').lower()}.",
            mood_words=mood, palette=palette, textures=textures, motifs=motifs, references=references,
            notes=["MOCK moodboard from built-in tables. Pictures from this project are added automatically."],
        )

    # ----- embroidery and print -----

    def embroidery(self, spec: DesignSpec, meter: UsageMeter | None = None) -> EmbroideryOutput:
        self._wait()
        words = _words(spec)
        formal = _formal(spec)
        main = spec.colour_palette[0] if spec.colour_palette else "Ivory"
        metal = "Silver" if "silver" in words else "Gold"
        tone = [ColourSwatch(name=main, hex=_hex(main), role="Base"), ColourSwatch(name=metal, hex=_hex(metal), role="Thread")]
        sleeveless = "sleeveless" in spec.sleeve_style.lower()
        concepts: list[EmbroideryConcept] = []
        if formal or any(k in words for k in COSTLY_TECHNIQUES):
            concepts.append(EmbroideryConcept(
                name="Zardozi neckline and yoke", kind="embroidery", technique="Zardozi with dabka and sequins",
                motif="Paisley (keri) and small florals", placements=["neckline", "yoke"],
                placement_note="Dense near the neckline, fading out towards the bust line.", scale="bold",
                colours=tone, materials=["Dabka and nakshi wire", "Sequins", "Adda (frame)", "Organza backing"],
                difficulty="advanced", effort_note="Slow, skilled hand work; usually done by a karigar."))
        concepts.append(EmbroideryConcept(
            name="Gota patti borders", kind="embroidery", technique="Gota patti (applied ribbon work)",
            motif="Leaf vine border", placements=["hem"] if sleeveless else ["hem", "cuffs"],
            placement_note="A border along the hem" + ("" if sleeveless else " and sleeve ends") + "; add it to the dupatta edge if there is one.",
            scale="medium", colours=tone, materials=["Gota ribbon", "Matching thread", "Fine needle"],
            difficulty="intermediate", effort_note="Moderate; repetitive but easy to learn."))
        concepts.append(EmbroideryConcept(
            name="Aari thread jaal", kind="embroidery", technique="Aari (hook) embroidery",
            motif="All-over trellis (jaal) with small buti", placements=["bodice", "back"],
            placement_note="Fine trellis over the bodice front and back; keep side seams clear for fitting.",
            scale="fine", colours=[tone[0], ColourSwatch(name="Tonal", hex=tone[0].hex, role="Thread")],
            materials=["Aari hook", "Embroidery frame", "Rayon or silk thread"],
            difficulty="intermediate", effort_note="Quick with an aari hook once the trellis is marked."))
        concepts.append(EmbroideryConcept(
            name="Foil-print buti" if formal else "Hand block-print buti", kind="print",
            technique="Foil print" if formal else "Hand block print",
            motif="Small scattered buti", placements=["all_over"],
            placement_note="Scattered evenly; leave a plain band where borders will be stitched.", scale="fine",
            colours=tone, materials=["Print blocks or screens", "Fabric paint or foil", "Test scrap"],
            difficulty="beginner", effort_note="Fast; print the fabric before cutting the pattern."))
        if not sleeveless and ("mirror" in words or not formal):
            concepts.append(EmbroideryConcept(
                name="Mirror-work sleeve bands", kind="surface", technique="Shisha (mirror) work",
                motif="Round mirrors with thread surrounds", placements=["sleeves"],
                placement_note="A band above the sleeve hem.", scale="medium", colours=tone,
                materials=["Small mirrors", "Cotton embroidery thread"], difficulty="intermediate",
                effort_note="Moderate; each mirror is held by a thread frame."))
        return EmbroideryOutput(
            concepts=concepts,
            notes=["MOCK concepts from built-in rules. Do embroidery on cut panels before stitching them together.",
                   "Placements are ideas; mark them on the actual pattern pieces with your tailor."],
        )
