"""MOCK sketch generator.

This does NOT use AI. It draws a simple garment outline as an SVG picture from
the design spec (garment type, length, neckline, sleeves, colours) in one of
six visual styles. It is a placeholder so the sketch workflow can be built and
tested for free. A real image-generation provider replaces it in Phase 2.
"""

from __future__ import annotations

import html
import time

from app.providers.base import GeneratedImage, ImageRequest, ProviderInfo, UsageMeter
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import SketchStyle

COLOUR_HEX = {
    "wine": "#6d1a36", "maroon": "#6b1e2b", "burgundy": "#7a1f35", "red": "#b3262e", "crimson": "#a3192f",
    "pink": "#e58fa8", "blush": "#efc3c6", "peach": "#f3b89a", "coral": "#ee7d65", "orange": "#e2802f",
    "mustard": "#c9971c", "yellow": "#e9c84a", "gold": "#c7a24a", "ivory": "#f4eedd", "cream": "#efe5cc",
    "white": "#fbfbf8", "beige": "#d8c6a6", "olive": "#6f7340", "green": "#3f7d4e", "emerald": "#1f6b4f",
    "mint": "#a8d8bf", "teal": "#1f6f73", "turquoise": "#3aa7a3", "blue": "#3567a8", "navy": "#1f2d52",
    "royal blue": "#2a4fa3", "sky blue": "#8fbbe0", "lavender": "#b9a7d6", "purple": "#5d3a86",
    "plum": "#5a2a4a", "grey": "#8a8a88", "silver": "#bfc1c2", "black": "#1b1b1b", "brown": "#6b4630",
    "rust": "#a24d2a",
}

LENGTH_HEM_Y = [
    ("crop", 248), ("hip", 300), ("knee", 420), ("midi", 470), ("calf", 480), ("ankle", 525), ("floor", 535),
]
SLEEVE_LENGTH = [
    ("sleeveless", 0), ("cap", 22), ("short", 60), ("elbow", 115), ("three", 160), ("3/4", 160),
    ("full", 205), ("long", 205), ("bishop", 205), ("bell", 190), ("puff", 50), ("flutter", 45),
]


def _hem_y(spec: DesignSpec) -> int:
    text = spec.garment_length.lower()
    for key, y in LENGTH_HEM_Y:
        if key in text:
            return y
    return 420


def _hem_half_width(spec: DesignSpec, hem_y: int) -> float:
    text = f"{spec.silhouette} {spec.garment_category}".lower()
    if any(k in text for k in ("flare", "full", "anarkali", "lehenga", "gown", "circle")):
        spread = 0.62
    elif any(k in text for k in ("a-line", "a line", "maxi", "skirt")):
        spread = 0.38
    else:
        spread = 0.12
    return 64 + (hem_y - 220) * spread


def _sleeve_length(spec: DesignSpec) -> int:
    text = spec.sleeve_style.lower()
    for key, length in SLEEVE_LENGTH:
        if key in text:
            return length
    return 60


def _neckline(spec: DesignSpec) -> tuple[str, float, float]:
    """Return (path from left neck point to right neck point, left x, right x)."""
    text = spec.neckline.lower()
    if text.startswith("v"):
        return "L200,150 L225,82", 175, 225
    if "boat" in text or "off" in text:
        return "Q200,100 245,84", 155, 245
    if "sweetheart" in text:
        return "Q182,140 200,122 Q218,140 225,82", 175, 225
    if "high" in text or "mandarin" in text or "collar" in text:
        return "Q200,96 220,82", 180, 220
    if "square" in text:
        return "L178,125 L222,125 L222,82", 178, 222
    if "halter" in text:
        return "L200,140 L215,70", 185, 215
    return "Q200,128 225,82", 175, 225


def _sleeve_path(side: int, length: int, spec: DesignSpec) -> str:
    """Draw one sleeve. side = -1 for the left of the picture, +1 for the right."""
    if length == 0:
        return ""
    sx, sy = 200 + side * 70, 92  # shoulder point
    ax, ay = 200 + side * 62, 150  # bottom of the armhole
    widen = 1.8 if any(k in spec.sleeve_style.lower() for k in ("bell", "puff", "flutter", "bishop")) else 1.0
    ox, oy = sx + side * (18 + length * 0.22), sy + length
    ix, iy = ax + side * (4 + length * 0.12), ay + length * 0.85
    mx, my = (ox + ix) / 2, (oy + iy) / 2
    ox2, oy2 = mx + (ox - mx) * widen, my + (oy - my) * widen
    ix2, iy2 = mx + (ix - mx) * widen, my + (iy - my) * widen
    return f"M{sx},{sy} L{ox2:.1f},{oy2:.1f} L{ix2:.1f},{iy2:.1f} L{ax},{ay} Z"


def _is_trousers(spec: DesignSpec) -> bool:
    return spec.garment_category.lower() in {"trousers", "pants"}


def build_svg(spec: DesignSpec, style: SketchStyle, banner: str = "MOCK SKETCH · PLACEHOLDER, NOT AI-GENERATED") -> str:
    palette = [COLOUR_HEX.get(c.lower(), "#9a8f84") for c in spec.colour_palette] or ["#b9aea2"]
    main, accent = palette[0], palette[1] if len(palette) > 1 else "#c7a24a"

    stroke, width, fill, fill_opacity, flt = "#2a2522", 2.0, "none", 1.0, ""
    if style == "pencil":
        stroke, width, flt = "#5b5550", 1.3, "url(#rough)"
    elif style == "ink":
        stroke, width = "#111111", 2.6
    elif style == "technical_flat":
        stroke, width, fill = "#222222", 1.5, "#ffffff"
    elif style == "charcoal":
        stroke, width, fill, fill_opacity, flt = "#262322", 4.0, "#5a5652", 0.18, "url(#smudge)"
    elif style == "coloured":
        stroke, width, fill = "#2a2522", 1.8, main
    elif style == "watercolour":
        stroke, width, fill, fill_opacity = "#6b625b", 1.0, main, 0.55

    parts: list[str] = []
    hem_y = _hem_y(spec)
    if _is_trousers(spec):
        body = (
            f"M150,200 L250,200 L262,{hem_y} L212,{hem_y} L200,270 L188,{hem_y} L138,{hem_y} Z"
        )
        parts.append(_shape(body, stroke, width, fill, fill_opacity, flt, style))
        parts.append(f'<line x1="150" y1="216" x2="250" y2="216" stroke="{stroke}" stroke-width="{width * 0.7}"/>')
    else:
        neck_path, nl, nr = _neckline(spec)
        hw = _hem_half_width(spec, hem_y)
        body = (
            f"M{nl},82 L130,92 L138,150 L148,220 L{200 - hw:.1f},{hem_y} "
            f"Q200,{hem_y + 10} {200 + hw:.1f},{hem_y} L252,220 L262,150 L270,92 L{nr},82 "
            f"M{nl},82 {neck_path}"
        )
        sleeve_len = _sleeve_length(spec)
        sleeve_fill = fill if fill != "none" else "none"
        for side in (-1, 1):
            path = _sleeve_path(side, sleeve_len, spec)
            if path:
                parts.append(_shape(path, stroke, width, sleeve_fill, fill_opacity, flt, style))
        parts.append(_shape(body, stroke, width, fill, fill_opacity, flt, style))
        if hem_y > 260:
            parts.append(
                f'<path d="M148,220 Q200,228 252,220" fill="none" stroke="{stroke}" '
                f'stroke-width="{width * 0.6}" stroke-dasharray="5 4"/>'
            )
        if spec.embellishments:
            parts.append(_embellishment_band(hw, hem_y, accent, style))

    if style == "technical_flat":
        parts.append('<line x1="200" y1="96" x2="200" y2="520" stroke="#888" stroke-width="0.8" stroke-dasharray="8 4 2 4"/>')
        parts.append('<text x="20" y="40" font-family="Helvetica, Arial" font-size="13" fill="#333">FRONT VIEW — FLAT</text>')

    caption = html.escape(spec.title or spec.garment_category or "Garment concept")
    defs = (
        '<defs>'
        '<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>'
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter>'
        '<filter id="smudge"><feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="3" result="n"/>'
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="5"/><feGaussianBlur stdDeviation="0.6"/></filter>'
        '<filter id="wash"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="n"/>'
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="14"/><feGaussianBlur stdDeviation="2.2"/></filter>'
        '</defs>'
    )
    background = "#fffdf9" if style != "watercolour" else "#fbf7ef"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600" role="img" '
        f'aria-label="Mock sketch of {caption}">'
        f"{defs}"
        f'<rect width="400" height="600" fill="{background}"/>'
        + "".join(parts)
        + f'<text x="200" y="566" text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="#2a2522">{caption}</text>'
        '<rect x="0" y="578" width="400" height="22" fill="#7a1f35"/>'
        '<text x="200" y="593" text-anchor="middle" font-family="Helvetica, Arial" font-size="11" '
        f'fill="#ffffff" letter-spacing="1">{html.escape(banner)}</text>'
        "</svg>"
    )


def _shape(d: str, stroke: str, width: float, fill: str, fill_opacity: float, flt: str, style: str) -> str:
    out = ""
    if style == "watercolour" and fill != "none":
        out += f'<path d="{d}" fill="{fill}" fill-opacity="{fill_opacity}" filter="url(#wash)"/>'
        fill = "none"
    filter_attr = f' filter="{flt}"' if flt else ""
    out += (
        f'<path d="{d}" fill="{fill}" fill-opacity="{fill_opacity}" stroke="{stroke}" '
        f'stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"{filter_attr}/>'
    )
    return out


def _embellishment_band(hw: float, hem_y: int, accent: str, style: str) -> str:
    colour = "#444" if style in ("pencil", "ink", "technical_flat", "charcoal") else accent
    dots = []
    left, right = 200 - hw + 10, 200 + hw - 10
    steps = max(4, int((right - left) / 14))
    for i in range(steps + 1):
        x = left + (right - left) * i / steps
        dots.append(f'<circle cx="{x:.1f}" cy="{hem_y - 14}" r="3" fill="none" stroke="{colour}" stroke-width="1.2"/>')
    dots.append(
        f'<path d="M{left:.1f},{hem_y - 24} L{right:.1f},{hem_y - 24}" stroke="{colour}" stroke-width="1" '
        'stroke-dasharray="2 3"/>'
    )
    return "".join(dots)


class MockImageProvider:
    info = ProviderInfo(
        name="mock-svg",
        is_mock=True,
        note="Draws a simple placeholder outline from the spec. Not a real image model.",
    )

    def __init__(self, latency_ms: int = 0) -> None:
        self.latency_ms = latency_ms

    def generate_image(self, request: ImageRequest, meter: UsageMeter | None = None) -> GeneratedImage:
        if self.latency_ms:
            time.sleep(self.latency_ms / 1000)
        spec = request.spec
        name = spec.title or spec.garment_category or "untitled design"
        if request.purpose == "preview":
            svg = build_svg(spec, "coloured", banner="MOCK PREVIEW · PLACEHOLDER, NOT AI-GENERATED")
            caption = f"Mock coloured preview placeholder for: {name}"
        else:
            style = request.style or "pencil"
            svg = build_svg(spec, style)
            caption = f"Mock {style.replace('_', ' ')} placeholder for: {name}"
        return GeneratedImage(mime_type="image/svg+xml", svg=svg, caption=caption)
