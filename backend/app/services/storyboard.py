"""Instructional video fallback: a storyboard and narration script.

No video generation provider is connected (they are expensive and their prices
change often), so "Generate Instructional Video" writes a scene-by-scene plan
you can film yourself or hand to an editor, plus any real tutorial videos
already found for this design. Ordinary code, not AI.
"""

from __future__ import annotations

from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import StitchingGuideOutput
from app.schemas.outputs import (
    DesignPlan,
    MaterialsOutput,
    StoryboardScene,
    TutorialOutput,
    VideoOutput,
)
from app.services.fabric_handling import handling_for
from app.services.tailor_sheet import required_measurements

PROVIDER_NOTE = (
    "No video generation provider is set up, so this is a storyboard and narration script you can film yourself "
    "or give to a video editor. Real tutorial videos for this design are listed below when tutorial search is connected."
)
SHOTS = ["Close-up of hands at the machine", "Overhead shot of the work table", "Medium shot at the ironing board"]


def build_storyboard(
    spec: DesignSpec,
    materials: MaterialsOutput | None = None,
    plan: DesignPlan | None = None,
    tutorial: TutorialOutput | None = None,
    guide: StitchingGuideOutput | None = None,
) -> VideoOutput:
    if guide is None:
        from app.services.garment_parser import parse_garment
        from app.services.stitching_guide import build_guide, load_knowledge
        from app.providers.base import UsageMeter
        guide = build_guide(spec, parse_garment(spec), load_knowledge(None), None, UsageMeter())
    garment = spec.garment_category or "garment"
    name = spec.title or garment
    details = ", ".join(v.lower() for v in (spec.neckline, spec.sleeve_style, spec.garment_length) if v)
    scenes: list[StoryboardScene] = []

    def add(title: str, shot: str, action: str, narration: str, on_screen: str = "", seconds: int = 20) -> None:
        scenes.append(StoryboardScene(number=len(scenes) + 1, title=title, shot=shot, action=action,
                                      narration=narration, on_screen_text=on_screen, seconds=seconds))

    add("Introduction", "Wide shot of the sketch or reference picture, then the maker at the table",
        "Show the design reference and the fabric.",
        f"Today we are making {name}: a {garment.lower()}" + (f" with {details}" if details else "") + ".",
        on_screen=name, seconds=10)
    if materials:
        needed = [i.item for i in materials.items if i.category != "tool" and not i.optional][:6]
        add("What you need", "Top-down shot of materials laid out in a row", "Point to each item as it is named.",
            "You will need " + ", ".join(needed) + ".", on_screen="Materials checklist", seconds=15)
    measurements = required_measurements(spec)
    add("Measurements", "Medium shot of measuring the wearer (or a dress form)",
        "Measure and write down each value.",
        "Take these measurements first: " + ", ".join(measurements[:8]) + ". Write each one down before cutting.",
        on_screen="Measure before you cut", seconds=20)
    cutting_tips = [tip for h in handling_for(spec) for tip in h.cutting][:2]
    add("Cutting", "Overhead shot of the fabric with pattern pieces placed",
        "Lay out the pieces along the grain and cut.",
        "Lay the pattern pieces along the grain and cut carefully. " + " ".join(cutting_tips),
        on_screen="Grainline parallel to the selvedge", seconds=25)
    if spec.embellishments:
        add("Embellishment", "Close-up of the embroidery frame",
            "Work the embellishment on the cut panels.",
            f"Finish the {', '.join(e.lower() for e in spec.embellishments)} on the cut panels before joining them.",
            seconds=25)
    for i, step in enumerate(guide.steps):
        add(f"Step {i + 1}: {step.title}", SHOTS[i % len(SHOTS)], step.title,
            " ".join(step.instructions), on_screen=step.target_piece, seconds=25)
    add("Finishing and reveal", "Slow pan of the finished garment on a dress form or the wearer",
        "Final press, trial fitting and reveal.",
        f"Give it a final press and a fitting. And here is the finished {garment.lower()}.", on_screen=name, seconds=12)

    script = "\n".join(f"Scene {s.number} – {s.title}: {s.narration}" for s in scenes)
    videos = tutorial.videos[:4] if tutorial and tutorial.connected else []
    notes = [f"About {sum(s.seconds for s in scenes) // 60} minutes of finished video if each scene is filmed as planned."]
    if not videos:
        notes.append("Run Generate Tutorial (with tutorial search connected) to add real videos that show these steps.")
    return VideoOutput(stitching_guide=guide, mode="storyboard", provider_note=PROVIDER_NOTE, title=f"How to make {name}", scenes=scenes,
                       script=script, tutorial_videos=videos, notes=notes)
