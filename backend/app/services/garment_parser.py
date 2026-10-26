"""Reads a design spec (and, if there is one, what a reference photo showed) as garment components.

The result says what a tailor needs to know before sewing: the kind of garment, the bodice,
neckline and how it is finished, the sleeves, the skirt, the closure and where it sits, the
length, and the fabric with its weight. It also lists "feature tags" (darts, gathers,
set-in-sleeve...). The step builder uses the tags to pick technique modules.

This is ordinary code with word lists, so it costs nothing and gives the same answer every
time. Anything it had to guess is written down in `assumptions`; the spec always wins over the
photo, and the photo only fills in what the spec leaves empty.
"""

from __future__ import annotations

import re

from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import FabricWeight, GarmentComponents, PhotoHints

# (family, words that name it). The first family with a matching word wins, so the more
# specific ones (anarkali, lehenga, saree) come before the general ones (dress, top).
FAMILIES: list[tuple[str, tuple[str, ...]]] = [
    ("anarkali", ("anarkali",)),
    ("lehenga", ("lehenga", "lehnga", "ghagra", "chaniya", "choli")),
    ("saree", ("saree", "sari")),
    ("blouse", ("blouse",)),
    ("kurta", ("kurta", "kurti", "kameez", "kaftan", "tunic", "salwar suit", "suit set", "sherwani")),
    ("jumpsuit", ("jumpsuit", "romper", "playsuit", "dungaree")),
    ("jacket", ("jacket", "blazer", "coat", "waistcoat", "nehru jacket", "shrug")),
    ("dupatta", ("dupatta", "stole", "scarf", "shawl")),
    ("trousers", ("trouser", "pant", "palazzo", "salwar", "churidar", "pyjama", "jeans", "shorts")),
    ("skirt", ("skirt",)),
    ("dress", ("dress", "gown", "frock", "maxi", "midi")),
    ("top", ("top", "shirt", "tee", "crop")),
]

FABRIC_CLASSES: list[tuple[str, tuple[str, ...]]] = [
    ("chiffon", ("chiffon",)),
    ("georgette", ("georgette", "crepe", "crape")),
    ("velvet", ("velvet", "velour", "velveteen")),
    ("denim", ("denim", "jeans")),
    ("khadi", ("khadi", "khaadi")),
    ("linen", ("linen", "flax")),
    ("silk", ("silk", "satin", "dupion", "dupioni", "tussar", "tussor", "banarasi", "brocade")),
    ("cotton", ("cotton", "mulmul", "muslin", "poplin", "voile", "cambric", "lawn", "chambray")),
]
# How heavy each class usually is. Words in the spec ("lightweight", "heavy") override this.
CLASS_WEIGHT: dict[str, FabricWeight] = {
    "chiffon": "light", "georgette": "light", "silk": "medium", "cotton": "medium", "linen": "medium",
    "khadi": "medium", "denim": "heavy", "velvet": "heavy",
}
SHEER_WORDS = ("chiffon", "georgette", "organza", "net", "tulle", "voile", "sheer", "mulmul", "muslin")
LIGHT_WORDS = ("lightweight", "light weight", "light-weight", "thin", "airy", "sheer", "organza", "net", "tulle", "voile")
HEAVY_WORDS = ("heavy", "thick", "heavyweight", "brocade", "canvas", "upholstery")
DELICATE_CLASSES = {"silk", "chiffon", "georgette", "velvet"}

# Free-text words that switch a technique on (matched against whole words).
FEATURE_WORDS: dict[str, tuple[str, ...]] = {
    "darts": ("dart", "darts"),
    "princess-seams": ("princess", "princess-cut"),
    "pleats": ("pleat", "pleats", "pleated", "accordion"),
    "gathers": ("gather", "gathers", "gathered", "ruffle", "ruffles", "frill", "frills", "shirred", "tiered", "tier"),
    "kali-panels": ("kali", "kalis", "kalidar", "panelled", "paneled"),
    "yoke": ("yoke",),
    "placket": ("placket",),
    "slit": ("slit", "slits", "vent"),
    "cuffs": ("cuff", "cuffs"),
    "lined": ("lining", "lined"),
}
CIRCULAR_WORDS = ("circular", "umbrella", "ghera", "gher", "full-circle")
FLARE_WORDS = ("flare", "flared", "a-line", "aline", "flowy", "swing")

HEM_WORDS = {
    "hem-rolled": ("rolled hem", "narrow hem", "baby hem"),
    "hem-blind": ("blind hem", "invisible hem", "hand-stitched hem", "handstitched hem"),
    "hem-machine": ("double fold hem", "double-fold hem", "machine hem", "topstitched hem"),
}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9-]+", text.lower()))


def _has(text: str, words: tuple[str, ...]) -> bool:
    found = _words(text)
    return any(w in found for w in words)


def _phrase(text: str, phrases: tuple[str, ...]) -> bool:
    low = text.lower()
    return any(p in low for p in phrases)


def _family(spec: DesignSpec, photo: PhotoHints | None) -> str:
    for source in (spec.garment_category, spec.title, photo.garment_type if photo else ""):
        low = source.lower()
        for family, words in FAMILIES:
            if any(w in low for w in words):
                return family
    return "dress" if spec.garment_category.strip() else "other"


def _fabric(spec: DesignSpec) -> tuple[str, str, FabricWeight, bool, list[str]]:
    """The main fabric, its class, its weight, whether it is sheer, and notes on what was guessed."""
    notes: list[str] = []
    name = spec.preferred_fabrics[0].strip() if spec.preferred_fabrics else ""
    low = f"{name} {spec.fabric_requirements}".lower()
    fabric_class = next((c for c, words in FABRIC_CLASSES if any(w in _words(name or low) for w in words)), "")
    if not fabric_class and not name:
        fabric_class = next((c for c, words in FABRIC_CLASSES if any(w in _words(low) for w in words)), "")
    weight: FabricWeight = CLASS_WEIGHT.get(fabric_class, "medium")
    if _phrase(low, LIGHT_WORDS) or _has(low, LIGHT_WORDS):
        weight = "light"
    elif _phrase(low, HEAVY_WORDS):
        weight = "heavy"
    sheer = _has(low, SHEER_WORDS)
    if not name:
        notes.append("No fabric chosen yet, so a medium-weight woven fabric was assumed.")
    elif not fabric_class:
        notes.append(f"“{name}” is not one of the fabrics in the library, so general {weight}-weight advice is used.")
    return name, fabric_class or "other", weight, sheer, notes


def _closure(spec: DesignSpec, family: str, photo: PhotoHints | None) -> tuple[str, str, str, list[str]]:
    """The closure text, its position, the technique tag (or '') and notes."""
    text = ", ".join(spec.closures).strip()
    low = text.lower()
    position = next((p for p in ("back", "side", "front", "centre", "center") if p in _words(low)), "")
    if position == "center":
        position = "centre"
    if not position and photo and photo.closure_position:
        position = photo.closure_position.strip().lower()
    notes: list[str] = []
    if not text:
        return "", position, "", ["The spec has no closure, so no closure step was added."]
    if "zip" in low:
        lapped = _has(low, ("lapped", "exposed", "fly", "metal", "centred"))
        if not position:
            position = "side" if family in ("skirt", "lehenga", "trousers") else "back"
            notes.append(f"The zip position was not given, so a {position} zip was assumed.")
        return text, position, "closure-zip-lapped" if lapped else "closure-zip-invisible", notes
    if _has(low, ("button", "buttons", "buttonhole")):
        return text, position or "front", "closure-buttons", notes
    if _has(low, ("hook", "hooks", "eye", "eyes", "dori", "tie", "ties", "drawstring", "nada", "string")):
        return text, position or "front", "closure-hooks", notes
    return text, position, "", notes


def _neckline(spec: DesignSpec, family: str, fabric_class: str, weight: FabricWeight, sheer: bool,
              photo: PhotoHints | None) -> tuple[str, str, list[str], list[str]]:
    """The neckline, how it is finished, the tags that finish needs, and notes on guesses."""
    text = spec.neckline.strip() or (photo.neckline.strip() if photo else "")
    if family in ("skirt", "trousers", "dupatta"):
        return "", "", [], []
    if not text:
        return "", "", [], ["The spec has no neckline, so no neckline finish was added."]
    low = f"{text} {spec.design_notes}".lower()
    tags = ["neckline", "stay-stitch"]
    notes: list[str] = []
    if _has(low, ("collar", "mandarin", "nehru", "band", "stand", "shirt")):
        return text, "Collar with a stand", [*tags, "collar", "interfacing"], notes
    if "binding" in low or "piping" in low:
        return text, "Bias binding", [*tags, "neckline-binding"], notes
    if "facing" in low:
        return text, "Facing", [*tags, "neckline-facing", "interfacing"], notes
    if sheer or weight == "light" or family in ("kurta", "anarkali") or "keyhole" in low:
        notes.append("Bias binding was chosen for the neckline because the fabric is light or the garment is a kurta style.")
        return text, "Bias binding", [*tags, "neckline-binding"], notes
    notes.append("A facing was chosen for the neckline, the usual finish for this fabric weight.")
    return text, "Facing", [*tags, "neckline-facing", "interfacing"], notes


def _sleeves(spec: DesignSpec, family: str, photo: PhotoHints | None) -> tuple[str, list[str], list[str]]:
    text = spec.sleeve_style.strip() or (photo.sleeves.strip() if photo else "")
    if family in ("skirt", "trousers", "dupatta"):
        return "", [], []
    if not text:
        return "", [], ["The spec has no sleeve style, so no sleeve steps were added."]
    low = text.lower()
    if _has(low, ("sleeveless", "strapless", "halter", "tank", "spaghetti")) or low.startswith("no sleeve"):
        return text, ["sleeveless", "armhole-finish"], []
    tags = ["sleeves"]
    notes: list[str] = []
    if _has(low, ("raglan", "dolman", "kimono", "batwing", "cape")):
        tags.append("sleeve-flat")
    else:
        tags.append("sleeve-set-in")
    if _has(low, ("puff", "puffed", "bishop", "balloon", "bell", "flutter", "gathered", "juliet")):
        tags.append("gathers")
        notes.append("Sleeve fullness is gathered, so the gathers technique is included.")
    if _has(low, ("cuff", "cuffs", "cuffed")):
        tags.append("cuffs")
    return text, tags, notes


def _skirt(spec: DesignSpec, family: str, text: str) -> tuple[str, list[str], list[str]]:
    """The skirt part, and the tags it needs. Dresses and gowns join it to the bodice."""
    if family not in ("dress", "lehenga", "skirt", "anarkali", "jumpsuit"):
        return "", [], []
    low = f"{spec.silhouette} {spec.garment_category} {spec.garment_length} {text}".lower()
    tags = ["skirt"]
    notes: list[str] = []
    shape = "Straight skirt"
    if _has(low, CIRCULAR_WORDS) or "full circle" in low:
        shape = "Circular, very full skirt"
        tags += ["flared-skirt", "circular-skirt"]
    elif _has(low, FLARE_WORDS) or family in ("lehenga", "anarkali"):
        shape = "Flared skirt"
        tags.append("flared-skirt")
    elif _has(low, ("mermaid", "fishtail", "trumpet")):
        shape = "Mermaid skirt (fitted, flaring low)"
        tags.append("flared-skirt")
    if _has(low, FEATURE_WORDS["pleats"]):
        shape += ", pleated"
    if _has(low, FEATURE_WORDS["gathers"]) or (family == "lehenga" and "pleats" not in tags and not _has(low, FEATURE_WORDS["pleats"])):
        shape += ", gathered"
    if _has(low, FEATURE_WORDS["kali-panels"]):
        shape = "Panelled (kali) skirt"
        tags.append("kali-panels")
    if shape == "Straight skirt" and family in ("dress", "skirt") and not text:
        notes.append("The silhouette does not say how full the skirt is, so a plain straight skirt was assumed.")
    return shape, tags, notes


def _hem(spec: DesignSpec, family: str, fabric_class: str, weight: FabricWeight, sheer: bool, lined: bool,
         flared: bool) -> tuple[str, list[str]]:
    text = f"{spec.design_notes} {spec.fabric_requirements} {spec.idea}".lower()
    for tag, phrases in HEM_WORDS.items():
        if any(p in text for p in phrases):
            return tag, [tag] + (["hem-curved"] if flared else [])
    if sheer or fabric_class in ("chiffon", "georgette") or family == "dupatta":
        tag = "hem-rolled"
    elif lined or fabric_class in ("silk", "velvet") or family in ("skirt", "trousers", "jacket", "lehenga", "anarkali") or weight == "heavy":
        tag = "hem-blind"
    else:
        tag = "hem-machine"
    return tag, [tag] + (["hem-curved"] if flared and tag != "hem-rolled" else [])


def parse_garment(spec: DesignSpec, photo: PhotoHints | None = None) -> GarmentComponents:
    """Take a design spec (and optional photo hints) apart into garment components."""
    family = _family(spec, photo)
    corpus = " ".join([spec.silhouette, spec.fit, spec.design_notes, spec.idea, spec.visual_description,
                       spec.garment_length, *spec.embellishments, *(photo.features if photo else [])])
    fabric, fabric_class, weight, sheer, assumptions = _fabric(spec)
    tags: list[str] = ["base"]
    if sheer:
        tags.append("sheer")
    if fabric_class in DELICATE_CLASSES:
        tags.append("delicate")
    if weight == "heavy":
        tags.append("heavy-fabric")
    tags.append(f"fabric-{fabric_class}")
    # Seam type follows the fabric: sheer fabrics fray and show seams; hard-wearing ones need strong seams.
    if sheer or fabric_class in ("chiffon", "georgette"):
        tags.append("french-seam")
    elif fabric_class in ("denim", "linen", "khadi") and family in ("top", "trousers", "jacket", "kurta", "jumpsuit", "dress"):
        tags.append("flat-fell")

    lined = _has(corpus, FEATURE_WORDS["lined"]) or bool(photo and "lining" in " ".join(photo.features).lower())
    if lined:
        tags.append("lined")

    has_body = family not in ("skirt", "trousers", "dupatta")
    bodice = ""
    if has_body:
        fit = f"{spec.fit} {spec.silhouette}".lower()
        loose = _has(fit, ("loose", "relaxed", "oversized", "boxy", "straight", "flowy", "easy", "baggy"))
        fitted = _has(fit, ("fitted", "slim", "tailored", "bodycon", "corset", "snug", "structured", "close"))
        if family in ("blouse", "saree", "lehenga") or fitted or (family in ("dress", "anarkali", "jumpsuit") and not loose):
            bodice = "Fitted bodice with darts"
            tags += ["fitted-bodice", "darts"]
            if _has(corpus, FEATURE_WORDS["princess-seams"]):
                bodice = "Princess-seamed bodice"
                tags += ["princess-seams"]
                tags.remove("darts")
            if not (fitted or family in ("blouse", "saree", "lehenga")):
                assumptions.append("The fit was not given, so a shaped bodice with darts was assumed.")
        else:
            bodice = "Loose, unfitted body (no bust darts)"
        if _has(corpus, FEATURE_WORDS["darts"]) and "darts" not in tags and "princess-seams" not in tags:
            tags += ["darts"]
        tags.append("shoulder-seams")
        tags.append("side-seams")
    if _has(corpus, FEATURE_WORDS["yoke"]):
        tags.append("yoke")
    if _has(corpus, FEATURE_WORDS["placket"]):
        tags.append("placket")

    neckline, finish, neck_tags, neck_notes = _neckline(spec, family, fabric_class, weight, sheer, photo)
    sleeves, sleeve_tags, sleeve_notes = _sleeves(spec, family, photo)
    skirt, skirt_tags, skirt_notes = _skirt(spec, family, corpus)
    closure, position, closure_tag, closure_notes = _closure(spec, family, photo)
    assumptions += neck_notes + sleeve_notes + skirt_notes + closure_notes
    tags += neck_tags + sleeve_tags + skirt_tags + ([closure_tag] if closure_tag else [])

    if "skirt" in tags:
        pleats, gathers = _has(corpus, FEATURE_WORDS["pleats"]), _has(corpus, FEATURE_WORDS["gathers"])
        if pleats:
            tags.append("pleats")
        if gathers or (family == "lehenga" and not pleats):
            tags.append("gathers")
        # A dress, gown or anarkali joins its skirt to the bodice; a lehenga skirt and a plain skirt have a waistband.
        if family in ("skirt", "lehenga"):
            tags.append("waistband")
        elif "kali-panels" not in tags:
            tags.append("bodice-to-skirt")
    elif _has(corpus, FEATURE_WORDS["pleats"]):
        tags.append("pleats")
    if family == "trousers":
        tags += ["waistband", "side-seams", "inseam"]
        if "gathers" in tags:
            tags.remove("gathers")
    if family == "jumpsuit":
        tags += ["waistband", "inseam"]
    if family == "jacket":
        tags += ["interfacing"] if "collar" in tags else ["collar", "interfacing"]
    if family == "dupatta":
        tags.append("dupatta")
    if _has(corpus, FEATURE_WORDS["slit"]):
        tags.append("slit")
    if "gathers" in sleeve_tags and "gathers" not in tags:
        tags.append("gathers")
    if _has(corpus, FEATURE_WORDS["cuffs"]) and "sleeves" in tags and "cuffs" not in tags:
        tags.append("cuffs")
    if family == "saree":
        assumptions.append("A saree itself is not stitched, so this guide covers the blouse (and petticoat edge) only.")

    flared = "flared-skirt" in tags
    hem_tag, hem_tags = _hem(spec, family, fabric_class, weight, sheer, lined, flared)
    tags += hem_tags

    photo_notes: list[str] = list(photo.notes) if photo else []
    if photo:
        for feature in photo.features:
            low = feature.lower()
            for tag, words in FEATURE_WORDS.items():
                if _has(low, words) and tag not in tags and tag != "lined":
                    tags.append(tag)
                    photo_notes.append(f"The photo shows {feature.strip()}, so the {tag.replace('-', ' ')} technique was added.")
    garment_type = spec.garment_category.strip() or (photo.garment_type.strip() if photo else "") or "Garment"
    length = spec.garment_length.strip() or (photo.length.strip() if photo else "")

    unique: list[str] = list(dict.fromkeys(tags))
    return GarmentComponents(
        garment_type=garment_type, family=family, bodice=bodice, neckline=neckline, neckline_finish=finish,
        sleeves=sleeves, skirt=skirt, closure=closure, closure_position=position, length=length, fabric=fabric,
        fabric_class=fabric_class, fabric_weight=weight, lined=lined, features=unique,
        source="spec+photo" if photo else "spec", assumptions=list(dict.fromkeys(assumptions)),
        photo_notes=list(dict.fromkeys(photo_notes)),
    )
