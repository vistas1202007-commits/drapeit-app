"""What we ask an image-reading provider about a reference photo, and the shape of its answer.

Kept apart from any one company's code so the Anthropic and Gemini readers ask exactly the same thing.
"""

from __future__ import annotations

from pydantic import BaseModel


class PhotoAnswer(BaseModel):
    garment_type: str
    bodice: str
    neckline: str
    sleeves: str
    skirt: str
    closure_position: str
    length: str
    features: list[str]
    notes: list[str]


PHOTO_PROMPT = """Look at this reference photo of a garment. Describe only what you can actually see, as a tailor would before sewing it. Use short plain words. Leave a field empty ("") or a list empty ([]) when it cannot be seen or you are not sure: never guess.

garment_type: what kind of garment it is. bodice: how the upper body is shaped (fitted, darts, princess seams, loose). neckline, sleeves, skirt (shape and fullness), closure_position (where a zip or hooks sit, if visible), length. features: techniques you can see, such as pleats, gathers, darts, lining, slit, cuffs, yoke, collar. notes: anything a tailor should know that does not fit the fields above."""
