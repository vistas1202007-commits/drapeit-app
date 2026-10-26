"""Stitching Guide, part 1: reading a design spec (and a photo's hints) as garment components."""

from app.schemas.design_spec import DesignSpec
from app.schemas.stitching import PhotoHints
from app.services.garment_parser import parse_garment


def spec(**kw) -> DesignSpec:
    return DesignSpec(**kw)


def test_anarkali_in_georgette_is_taken_apart_correctly():
    g = parse_garment(spec(garment_category="Anarkali", neckline="V-neck", sleeve_style="Full-length sleeves",
                           closures=["Side zip"], preferred_fabrics=["Georgette"], silhouette="Flared, fitted bodice"))
    assert (g.family, g.fabric_class, g.fabric_weight) == ("anarkali", "georgette", "light")
    assert g.bodice == "Fitted bodice with darts"
    assert g.neckline == "V-neck" and g.neckline_finish == "Bias binding"
    assert g.skirt == "Flared skirt"
    assert (g.closure, g.closure_position) == ("Side zip", "side")
    for tag in ("darts", "sheer", "french-seam", "closure-zip-invisible", "bodice-to-skirt", "hem-rolled", "sleeve-set-in"):
        assert tag in g.features
    assert "hem-blind" not in g.features


def test_lehenga_has_a_waistband_not_a_bodice_to_skirt_seam():
    g = parse_garment(spec(garment_category="Lehenga choli", neckline="Round", sleeve_style="Elbow length",
                           closures=["Back hooks"], preferred_fabrics=["Raw silk"], silhouette="Pleated, flared"))
    assert g.family == "lehenga"
    assert {"waistband", "pleats", "closure-hooks", "hem-blind", "hem-curved", "fitted-bodice"} <= set(g.features)
    assert "bodice-to-skirt" not in g.features
    assert g.neckline_finish == "Facing"


def test_linen_shirt_gets_a_collar_cuffs_buttons_and_flat_fell_seams():
    g = parse_garment(spec(garment_category="Shirt", neckline="Collar", sleeve_style="Full sleeve with cuffs",
                           closures=["Buttons"], preferred_fabrics=["Linen"]))
    assert g.family == "top" and g.fabric_class == "linen"
    assert {"collar", "interfacing", "cuffs", "closure-buttons", "flat-fell", "hem-machine"} <= set(g.features)
    assert "darts" not in g.features and "skirt" not in g.features


def test_skirt_and_dupatta_have_no_neckline_or_sleeves():
    skirt = parse_garment(spec(garment_category="Skirt", neckline="Round", sleeve_style="Short", closures=["Side zip"],
                               preferred_fabrics=["Cotton"]))
    assert skirt.neckline == "" and skirt.sleeves == "" and skirt.bodice == ""
    assert {"waistband", "skirt", "closure-zip-invisible"} <= set(skirt.features)
    assert "shoulder-seams" not in skirt.features
    dupatta = parse_garment(spec(garment_category="Dupatta", preferred_fabrics=["Chiffon"]))
    assert "hem-rolled" in dupatta.features and "waistband" not in dupatta.features


def test_a_missing_choice_is_an_assumption_not_an_invention():
    g = parse_garment(spec(garment_category="Dress"))
    assert g.fabric == "" and g.fabric_weight == "medium"
    assert any("No fabric" in a for a in g.assumptions)
    assert any("no neckline" in a.lower() for a in g.assumptions)
    assert g.closure == "" and any("no closure" in a.lower() for a in g.assumptions)


def test_the_spec_wins_and_the_photo_only_fills_blanks():
    base = dict(garment_category="Dress", preferred_fabrics=["Cotton"], closures=["Back zip"])
    photo = PhotoHints(neckline="Boat neck", sleeves="Cap sleeves", features=["box pleats", "slit"],
                       notes=["Pleats start below the waist."])
    g = parse_garment(spec(neckline="V-neck", **base), photo)
    assert g.source == "spec+photo"
    assert g.neckline == "V-neck"  # the spec had one
    assert g.sleeves == "Cap sleeves"  # the spec had none
    assert {"pleats", "slit"} <= set(g.features)
    assert "Pleats start below the waist." in g.photo_notes
    assert parse_garment(spec(**base)).source == "spec"


def test_unknown_garments_still_get_the_base_steps():
    g = parse_garment(spec(garment_category="Mystery thing"))
    assert g.family == "dress" and "base" in g.features
    assert parse_garment(spec()).family == "other"


def test_explicit_hem_and_neckline_wishes_are_respected():
    g = parse_garment(spec(garment_category="Dress", neckline="Round", preferred_fabrics=["Georgette"],
                           design_notes="Use a blind hem. Neckline with facing."))
    assert "hem-blind" in g.features and "hem-rolled" not in g.features
    assert g.neckline_finish == "Facing"
