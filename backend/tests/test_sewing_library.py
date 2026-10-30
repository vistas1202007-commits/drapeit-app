"""The sewing library itself: enough modules, sound data, original text, and every fabric covered."""

import re

from app.knowledge import all_fabric_rules, all_modules, check_library
from app.schemas.stitching import PHASES
from app.services.garment_parser import CLASS_WEIGHT, FABRIC_CLASSES

# Every tag the garment parser can produce that a module may be triggered by.
PARSER_TAGS = {
    "base", "sheer", "delicate", "heavy-fabric", "french-seam", "flat-fell", "plain-seam", "lined", "fitted-bodice",
    "darts", "princess-seams", "shoulder-seams", "side-seams", "yoke", "placket", "neckline", "stay-stitch", "collar",
    "interfacing", "neckline-binding", "neckline-facing", "sleeves", "sleeveless", "armhole-finish", "sleeve-set-in",
    "sleeve-flat", "gathers", "cuffs", "skirt", "flared-skirt", "circular-skirt", "kali-panels", "pleats", "waistband",
    "bodice-to-skirt", "inseam", "slit", "dupatta", "closure-zip-invisible", "closure-zip-lapped", "closure-buttons",
    "closure-hooks", "hem-rolled", "hem-blind", "hem-machine", "hem-curved", "stretch-seam",
}
FABRICS_REQUESTED = {"silk", "chiffon", "georgette", "cotton", "linen", "denim", "velvet", "khadi", "knit"}
TECHNIQUES_REQUESTED = [
    "stay-stitching", "interfacing", "darts", "pleats", "gathers", "shoulder-seams", "side-seams", "bodice-to-skirt",
    "facing", "bias-binding", "invisible-zip", "lapped-zip", "set-in-sleeve", "cuffs", "waistband", "rolled-hem",
    "blind-hem", "machine-hem", "french-seam", "flat-fell-seam", "pressing",
]


def test_about_forty_modules_and_no_data_problems():
    modules = all_modules()
    assert 40 <= len(modules) <= 48
    assert check_library(modules, all_fabric_rules()) == []


def test_every_technique_the_brief_asked_for_is_there():
    slugs = " ".join(m.slug for m in all_modules())
    for wanted in TECHNIQUES_REQUESTED:
        assert wanted in slugs, wanted


def test_every_phase_has_modules_and_every_trigger_is_something_the_parser_can_say():
    modules = all_modules()
    assert {m.phase for m in modules} == set(PHASES)
    for m in modules:
        assert set(m.triggers) <= PARSER_TAGS, (m.slug, set(m.triggers) - PARSER_TAGS)


def test_the_eight_fabrics_have_full_rules_and_the_parser_knows_them():
    rules = {r.fabric: r for r in all_fabric_rules()}
    assert set(rules) == FABRICS_REQUESTED
    assert FABRICS_REQUESTED <= {c for c, _ in FABRIC_CLASSES}
    assert FABRICS_REQUESTED <= set(CLASS_WEIGHT)
    for r in rules.values():
        assert r.needle and r.thread and r.stitch_length and r.pressing and r.seam_types and r.notes
        assert set(r.by_phase) <= set(PHASES)
        assert {"prep", "main_seams", "hem", "pressing"} <= set(r.by_phase), r.fabric


def test_fabric_notes_name_real_fabrics_and_steps_are_not_empty():
    for m in all_modules():
        assert set(m.fabric_notes) <= FABRICS_REQUESTED, m.slug
        assert len(m.steps) >= 3 and all(s.strip().endswith((".", ")")) for s in m.steps), m.slug


def test_the_text_is_original_plain_writing_without_brand_or_ai_words():
    banned = re.compile(r"anthropic|chatgpt|openai|gemini|simplicity|butterick|vogue|mccall|burda|©", re.IGNORECASE)
    for m in all_modules():
        blob = " ".join([m.title, m.summary, *m.steps, *m.tips, *m.fabric_notes.values(), m.video_query])
        assert not banned.search(blob), m.slug
    for r in all_fabric_rules():
        blob = " ".join([r.title, r.needle, r.thread, r.pressing, *r.notes, *[t for ts in r.by_phase.values() for t in ts]])
        assert not banned.search(blob), r.fabric
