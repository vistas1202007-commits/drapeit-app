"""How to cut and stitch common fabrics.

Plain, well-known workshop advice used by the free materials checklist and the
tailor sheet. It never contains measurements or cutting dimensions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.design_spec import DesignSpec


@dataclass(frozen=True)
class Handling:
    label: str
    keywords: tuple[str, ...]
    cutting: list[str]
    stitching: list[str]
    # Extra checklist entries: (item, category, reason)
    supplies: list[tuple[str, str, str]] = field(default_factory=list)


HANDLING: list[Handling] = [
    Handling(
        "Sheer or slippery fabric",
        ("georgette", "chiffon", "organza", "net", "chanderi"),
        ["Cut one layer at a time, laid on tissue or pattern paper so it does not slide.",
         "Pin only inside the seam allowance; fine pins leave marks on sheer fabric."],
        ["Use a fine sharp needle (microtex) and a short, even stitch.",
         "Finish seams neatly (French seams or a narrow rolled hem) because they show through."],
        [("Microtex (fine sharp) machine needles", "tool", "Clean stitching on sheer, slippery fabric."),
         ("Tissue or pattern paper for cutting", "material", "Stops sheer fabric sliding while cutting.")],
    ),
    Handling(
        "Velvet (pile fabric)",
        ("velvet",),
        ["Velvet has a nap: cut every piece with the pattern pointing the same way.",
         "Cut pile side down, one layer at a time."],
        ["Use a walking foot so the layers do not creep.",
         "Steam from the back instead of pressing flat; never iron the pile directly."],
        [("Walking foot", "tool", "Stops velvet layers shifting under the machine."),
         ("Needle board or thick towel for pressing", "tool", "Presses seams without crushing the pile.")],
    ),
    Handling(
        "Silk, satin or brocade",
        ("silk", "satin", "brocade", "banarasi", "tussar"),
        ["Pin and mark only inside the seam allowance: holes and chalk can show.",
         "Brocade and silk fray: finish the cut edges soon after cutting."],
        ["Test needle, stitch and iron heat on a scrap first.",
         "Use a pressing cloth; water drops can mark silk."],
        [("Silk pins (fine)", "tool", "Small holes on delicate fabric."),
         ("Pressing cloth", "tool", "Protects lustre while pressing.")],
    ),
    Handling(
        "Knit or stretch fabric",
        ("jersey", "knit", "lycra", "stretch"),
        ["Do not stretch the fabric while cutting; let it rest flat first."],
        ["Use a ballpoint or stretch needle and a stretch stitch or overlock.",
         "Do not pull the fabric through the machine; let the feed dogs move it."],
        [("Ballpoint / stretch needles", "tool", "Prevents skipped stitches and holes in knits.")],
    ),
    Handling(
        "Cotton or linen",
        ("cotton", "linen", "khadi", "cambric", "poplin", "mul", "muslin"),
        ["Pre-wash or soak the fabric before cutting: natural fibres can shrink."],
        ["Finish seams (overlock or zigzag); linen frays easily.",
         "Press each seam as you go for crisp results."],
    ),
    Handling(
        "Wool suiting",
        ("wool", "tweed"),
        ["Steam the fabric before cutting so it does not shrink later."],
        ["Press with a pressing cloth and a tailor's ham for curved seams."],
        [("Tailor's ham", "tool", "Shapes curved seams on structured wool.")],
    ),
]


def fabric_words(spec: DesignSpec) -> str:
    return " ".join([*spec.preferred_fabrics, spec.fabric_requirements]).lower()


def handling_for(spec: DesignSpec) -> list[Handling]:
    """The handling advice that matches the fabrics chosen in the spec."""
    words = fabric_words(spec)
    if spec.construction.fabric_construction == "knit" or (
        spec.construction.fabric_construction != "woven" and any(k in words for k in ("jersey", "knit", "lycra", "stretch"))
    ):
        return [h for h in HANDLING if h.label == "Knit or stretch fabric"]
    return [h for h in HANDLING if any(k in words for k in h.keywords)]
