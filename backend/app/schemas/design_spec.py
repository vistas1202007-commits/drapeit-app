"""The shared design specification.

Every generator reads the SAME DesignSpec. When the user changes something
(for example the neckline), a new design version is saved, and we can work out
which generator outputs are now out of date.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

MeasurementUnit = Literal["cm", "in"]
SkillLevel = Literal["beginner", "intermediate", "advanced", "professional"]


class Measurement(BaseModel):
    """One body or garment measurement typed in by the user."""

    name: str = Field(min_length=1, max_length=60)
    value: float = Field(gt=0, lt=1000)
    # True means the user measured it. False means it is a guess / estimate.
    verified: bool = False
    note: str = Field(default="", max_length=200)


class Budget(BaseModel):
    amount: float | None = Field(default=None, ge=0)
    currency: str = Field(default="INR", max_length=8)
    note: str = Field(default="", max_length=200)


ReferenceView = Literal["front", "back", "side", "detail"]


class TailorReference(BaseModel):
    """A picture of the project the tailor should look at (front view, back view...)."""

    asset_id: str = Field(min_length=1, max_length=64)
    view: ReferenceView = "front"
    note: str = Field(default="", max_length=200)


class TailorNotes(BaseModel):
    """What the designer writes for the tailor in the Tailor Workspace.

    Free text written by a person. The app never calculates cutting dimensions.
    """

    construction: str = Field(default="", max_length=2000)
    cutting: str = Field(default="", max_length=2000)
    stitching: str = Field(default="", max_length=2000)
    references: list[TailorReference] = Field(default_factory=list, max_length=8)


class ConstructionChoices(BaseModel):
    """Decisions explicitly confirmed by the designer; empty means not confirmed."""

    bodice: Literal["", "darted", "princess", "unfitted"] = ""
    neckline_finish: Literal["", "facing", "binding", "collar"] = ""
    closure_type: Literal["", "none", "invisible_zip", "lapped_zip", "buttons", "hooks"] = ""
    closure_position: Literal["", "front", "back", "side", "none"] = ""
    fabric_construction: Literal["", "woven", "knit"] = ""
    fabric_weight: Literal["", "light", "medium", "heavy"] = ""
    seam_finish: Literal["", "plain", "french", "flat_fell", "stretch"] = ""


class DesignSpec(BaseModel):
    """Structured description of one garment design."""

    construction: ConstructionChoices = Field(default_factory=ConstructionChoices)
    title: str = Field(default="", max_length=120)
    idea: str = Field(default="", max_length=4000, description="The user's idea in their own words.")
    garment_category: str = Field(default="", max_length=60)
    occasion: str = Field(default="", max_length=120)
    silhouette: str = Field(default="", max_length=120)
    fit: str = Field(default="", max_length=60)
    neckline: str = Field(default="", max_length=60)
    sleeve_style: str = Field(default="", max_length=60)
    garment_length: str = Field(default="", max_length=60)
    fabric_requirements: str = Field(default="", max_length=500)
    preferred_fabrics: list[str] = Field(default_factory=list, max_length=10)
    colour_palette: list[str] = Field(default_factory=list, max_length=10)
    embellishments: list[str] = Field(default_factory=list, max_length=15)
    closures: list[str] = Field(default_factory=list, max_length=10)
    climate: str = Field(default="", max_length=60)
    measurement_unit: MeasurementUnit = "cm"
    measurements: list[Measurement] = Field(default_factory=list, max_length=40)
    budget: Budget = Field(default_factory=Budget)
    skill_level: SkillLevel = "beginner"
    design_notes: str = Field(default="", max_length=4000)
    # A short picture-description of the garment (written by Generate Design).
    # Image generators use it so every sketch and preview shows the same design.
    visual_description: str = Field(default="", max_length=1500)
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=20)
    # Phase 3: notes and front/back references for the tailor sheet.
    tailor: TailorNotes = Field(default_factory=TailorNotes)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)
    assumptions: list[str] = Field(default_factory=list, max_length=20)


    @model_validator(mode="after")
    def synchronize_closure(self):
        """Confirmed closure choices must agree with the spec used by every other tool."""
        import re
        c = self.construction
        if c.closure_position == "none" or c.closure_type == "none":
            c.closure_position, c.closure_type = "none", "none"
            self.closures = []
        elif c.closure_type or c.closure_position:
            old = ", ".join(self.closures)
            position = c.closure_position or next((p for p in ("front", "back", "side") if re.search(rf"\b{p}\b", old.lower())), "")
            kind = {"invisible_zip": "Invisible zip", "lapped_zip": "Lapped zip", "buttons": "Buttons",
                    "hooks": "Hooks and eyes"}.get(c.closure_type)
            if kind:
                self.closures = [f"{position} {kind}".strip()]
            elif position:
                self.closures = [f"{position} " + re.sub(r"\b(front|back|side|centre|center)\b", "", x, flags=re.I).strip()
                                 for x in self.closures]
        return self


# Field names, used when a generator says which parts of the spec it depends on.
SPEC_FIELDS: tuple[str, ...] = tuple(DesignSpec.model_fields.keys())


def changed_fields(old: DesignSpec, new: DesignSpec) -> set[str]:
    """Return the names of the fields that differ between two specs."""
    old_d, new_d = old.model_dump(), new.model_dump()
    return {name for name in SPEC_FIELDS if old_d[name] != new_d[name]}
