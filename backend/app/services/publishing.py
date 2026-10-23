"""What a design may show when it is published as a post.

This is an ALLOW-list: only the things below are ever copied into a post.

* pictures: the design's own sketches (Design Studio) and generated pictures,
  only the ones the author ticks. Uploaded reference photos are never offered,
  because they may show a client.
* colours: names and hex codes.
* fabrics: names, plus the texture and swatch colour used to draw them.
* suggested caption and tags: built only from garment, colours, occasion, neckline,
  sleeves and embellishments.

Never copied: measurements, budget, design notes, notes for the tailor, the project
title and the idea text (both may contain a client's name), cost estimates, and any
other generator output.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.providers.mock.sketch import COLOUR_HEX
from app.schemas.api import Asset
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import DesignConceptOutput, FabricOutput
from app.schemas.social import FabricChoice, PaletteColour, PostContentChoice, PostTags, PublishImageOption
from app.storage.repository import Repository

PUBLISHABLE_KINDS = ("sketch", "generated")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_IMAGES = 10


class PublishError(Exception):
    """The chosen content cannot be published. The message is safe to show."""


@dataclass
class PostContent:
    palette: list[PaletteColour]
    fabrics: list[FabricChoice]
    images: list[Asset]


def _image_label(asset: Asset) -> str:
    if asset.kind == "sketch":
        return "Studio sketch"
    what = {"sketch": "Sketch", "visual_preview": "Visual preview"}.get(asset.generator_id or "", "Generated picture")
    return f"{what} (v{asset.version_number})" if asset.version_number else what


def publishable_images(repo: Repository, project_id: str) -> list[Asset]:
    return [a for a in repo.list_assets(project_id) if a.kind in PUBLISHABLE_KINDS]


def _palette(repo: Repository, project_id: str, spec: DesignSpec) -> list[PaletteColour]:
    concept = repo.latest_output(project_id, "design")
    if concept:
        try:
            plan = DesignConceptOutput.model_validate(concept).plan
        except ValueError:
            plan = None
        if plan and plan.colour_story:
            colours = [PaletteColour(name=c.name[:40], hex=c.hex) for c in plan.colour_story if HEX.match(c.hex)]
            if colours:
                return colours[:8]
    return [PaletteColour(name=c[:40], hex=COLOUR_HEX[c.lower()]) for c in spec.colour_palette
            if c.lower() in COLOUR_HEX][:8]


def _fabrics(repo: Repository, project_id: str, spec: DesignSpec, palette: list[PaletteColour]) -> list[FabricChoice]:
    recommendations = {}
    saved = repo.latest_output(project_id, "fabric")
    if saved:
        try:
            recommendations = {r.name.lower(): r for r in FabricOutput.model_validate(saved).recommendations}
        except ValueError:
            recommendations = {}
    swatch = palette[0].hex if palette else "#cccccc"
    out = []
    for name in spec.preferred_fabrics[:4]:
        rec = recommendations.get(name.lower())
        colour = rec.swatch_colour if rec and HEX.match(rec.swatch_colour) else swatch
        out.append(FabricChoice(name=name[:80], texture=rec.texture if rec else "plain", swatch=colour))
    return out


def suggested_caption(spec: DesignSpec) -> str:
    colours = " and ".join(c.lower() for c in spec.colour_palette[:2])
    garment = spec.garment_category.lower() or "design"
    first = f"{colours} {garment}".strip().capitalize() if colours else garment.capitalize()
    if spec.occasion:
        first += f" for {spec.occasion.lower()}"
    details = [d for d in (spec.neckline, spec.sleeve_style.lower() if spec.sleeve_style else "",
                           ", ".join(e.lower() for e in spec.embellishments)) if d]
    return (first + "." + (f" {', '.join(details)}." if details else ""))[:2200]


def publish_options(repo: Repository, project_id: str) -> tuple[list[PublishImageOption], list[PaletteColour],
                                                                 list[FabricChoice], str, PostTags]:
    spec = repo.current_version(project_id).spec
    images = [PublishImageOption(asset_id=a.id, kind=a.kind, label=_image_label(a))  # type: ignore[arg-type]
              for a in publishable_images(repo, project_id)]
    palette = _palette(repo, project_id, spec)
    fabrics = _fabrics(repo, project_id, spec, palette)
    tags = PostTags(garment=spec.garment_category[:60], occasion=spec.occasion[:60],
                    fabric=(spec.preferred_fabrics[0] if spec.preferred_fabrics else "")[:60])
    return images, palette, fabrics, suggested_caption(spec), tags


SVG_NS = "http://www.w3.org/2000/svg"
# Labels that are safe (and honest) to keep in a published mock picture.
KEEP_TEXT = ("MOCK", "FRONT VIEW")


def clean_svg_for_post(data: bytes) -> bytes:
    """Remove words from a mock SVG picture before it is published.

    The free mock sketches print the design's name inside the picture (it may contain a
    client's name), so a published copy keeps only the "MOCK …" label and drawing marks.
    These SVGs are made by our own code; anything unexpected is refused, not published.
    """
    import xml.etree.ElementTree as ET

    text = data.decode("utf-8", errors="strict")
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        raise PublishError("One of the chosen pictures cannot be published.")
    ET.register_namespace("", SVG_NS)
    root = ET.fromstring(text)
    for parent in root.iter():
        for child in list(parent):
            tag = child.tag.rsplit("}", 1)[-1]
            words = "".join(child.itertext())
            if tag in ("title", "desc", "metadata") or (tag == "text" and not words.startswith(KEEP_TEXT)):
                parent.remove(child)
    if "aria-label" in root.attrib:
        root.set("aria-label", "Mock sketch")
    return ET.tostring(root, encoding="utf-8")


def build_content(repo: Repository, project_id: str, choice: PostContentChoice) -> PostContent:
    """Exactly what the author ticked, checked against the design."""
    spec = repo.current_version(project_id).spec
    allowed = {a.id: a for a in publishable_images(repo, project_id)}
    chosen: list[Asset] = []
    for asset_id in dict.fromkeys(choice.image_asset_ids):
        asset = allowed.get(asset_id)
        if asset is None:
            raise PublishError("One of the chosen pictures cannot be published (only this design's sketches and "
                               "generated pictures can).")
        chosen.append(asset)
    if len(chosen) > MAX_IMAGES:
        raise PublishError(f"A post can have at most {MAX_IMAGES} pictures.")
    palette = _palette(repo, project_id, spec) if choice.show_palette else []
    fabrics = _fabrics(repo, project_id, spec, palette or _palette(repo, project_id, spec)) if choice.show_fabric else []
    return PostContent(palette=palette, fabrics=fabrics, images=chosen)
