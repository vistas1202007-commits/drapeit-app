"""Builds the text prompts sent to image models.

The prompt is built only from the saved design spec, so every sketch and
preview of the same design version describes the same garment. The prompt is
stored with the output, so the user can always see exactly what was asked.
"""

from __future__ import annotations

from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import SketchStyle

STYLE_DIRECTIONS: dict[str, str] = {
    "pencil": (
        "a graphite pencil fashion sketch on off-white sketchbook paper, light construction lines, "
        "soft shading, monochrome grey, loose confident strokes"
    ),
    "ink": (
        "a clean black ink fashion illustration on white paper, fine-liner outlines with varied line weight, "
        "minimal hatching for folds, no colour"
    ),
    "technical_flat": (
        "a technical fashion flat drawing: the garment laid flat with no body or model, front view and back "
        "view side by side, crisp even black outlines on white, stitch lines shown as dashed lines, "
        "symmetrical, no shading, no colour, like a tech pack"
    ),
    "charcoal": (
        "an expressive charcoal fashion illustration on textured paper, bold smudged strokes, deep blacks and "
        "soft greys, dramatic but readable garment shape"
    ),
    "coloured": (
        "a coloured fashion illustration with markers and coloured pencil, accurate garment colours, "
        "clean outlines, soft shadows, on a plain off-white background"
    ),
    "watercolour": (
        "a loose watercolour fashion concept illustration, transparent washes of the garment colours, "
        "fine ink outlines, white paper showing through, elegant and airy"
    ),
}

RULES = (
    "Show the complete garment from neckline to hem, centred, on a plain background. "
    "Do not add any text, letters, logos, watermarks or brand names. "
    "Keep the design details exactly as described; do not add extra embellishment."
)


def describe_garment(spec: DesignSpec) -> str:
    """One paragraph describing the garment, from the spec fields."""
    if spec.visual_description.strip():
        base = spec.visual_description.strip()
    else:
        base = spec.garment_category or "garment"
    extras = [
        ("Garment", spec.garment_category),
        ("Silhouette", spec.silhouette),
        ("Fit", spec.fit),
        ("Length", spec.garment_length),
        ("Neckline", spec.neckline),
        ("Sleeves", spec.sleeve_style),
        ("Colours", ", ".join(spec.colour_palette)),
        ("Embellishment", ", ".join(spec.embellishments)),
        ("Closures", ", ".join(spec.closures)),
        ("Fabric look", ", ".join(spec.preferred_fabrics)),
    ]
    facts = "; ".join(f"{k}: {v}" for k, v in extras if v)
    return f"{base}\nKey details - {facts}." if facts else base


def sketch_prompt(spec: DesignSpec, style: SketchStyle) -> str:
    figure = (
        "" if style == "technical_flat"
        else "Worn by a simple elongated fashion croquis figure in a relaxed front-facing pose; the face is a "
        "minimal suggestion so the attention stays on the clothes. "
    )
    return (
        f"Create {STYLE_DIRECTIONS[style]}.\n\n"
        f"The design:\n{describe_garment(spec)}\n\n"
        f"{figure}{RULES}"
    )


def preview_prompt(spec: DesignSpec) -> str:
    occasion = f" styled for {spec.occasion.lower()}" if spec.occasion else ""
    return (
        "Create a realistic studio product photograph of this finished garment on a dress form (mannequin)"
        f"{occasion}, full length, front view, soft even lighting, warm off-white seamless backdrop, "
        "true-to-life fabric texture and colours.\n\n"
        f"The design:\n{describe_garment(spec)}\n\n"
        f"{RULES} No human model, no face."
    )
