"""Phase 3 tests: fabric intelligence, design-linked checklists, the tailor sheet
and its PDF, and the cost estimate. No paid API is called."""

import base64
import re
from types import SimpleNamespace

import pytest

from app.providers.anthropic_provider import AnthropicClient, AnthropicFabricProvider, FabricAnswer
from app.providers.base import UsageMeter
from app.providers.mock.fabric import MockFabricProvider, MockMaterialsProvider
from app.schemas.design_spec import Budget, DesignSpec, Measurement, TailorNotes, TailorReference
from app.schemas.outputs import FabricOutput, FabricRecommendation, MaterialsOutput, Suggestion
from app.services import tailor_pdf
from app.services.tailor_pdf import build_tailor_pdf
from app.services.tailor_sheet import build_tailor_sheet

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# A number followed by a unit, e.g. "12 cm" or "1.5in": the app must never write these itself.
DIMENSION = re.compile(r"\d+(\.\d+)?\s*(cm|in|inch|mm|m)\b", re.IGNORECASE)


def wedding_spec(**kw):
    base = dict(
        title="Wine anarkali", garment_category="Anarkali", occasion="Winter wedding", climate="Cold winter",
        silhouette="Fitted bodice, flared skirt", fit="Fitted", neckline="V-neck", sleeve_style="Full-length sleeves",
        colour_palette=["Wine", "Gold"], embellishments=["Zari work"], closures=["Side zip"],
    )
    base.update(kw)
    return DesignSpec(**base)


def set_spec(client, pid, **changes):
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec.update(changes)
    res = client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    assert res.status_code == 201, res.text
    return res.json()


def generate(client, pid, generator_id, options=None):
    return client.post(f"/api/projects/{pid}/generate/{generator_id}", json={"options": options or {}}).json()


# ---------- fabric intelligence ----------


def test_fabric_mock_weighs_climate_occasion_and_shows_new_factors():
    out = MockFabricProvider().recommend_fabrics(wedding_spec())
    top = out.recommendations[0]
    assert top.climate_fit and top.occasion_fit and top.budget_note
    assert {r.maintenance for r in out.recommendations} <= {"easy", "moderate", "delicate"}
    assert all(r.approximate_cost is None for r in out.recommendations)
    # The swatch is drawn in the design's own main colour (wine).
    assert all(r.swatch_colour == "#6d1a36" for r in out.recommendations)
    assert out.lining_options and all(o.reason for o in out.lining_options)
    assert out.lining == [o.name for o in out.lining_options]
    assert out.embellishment_options

    summer = MockFabricProvider().recommend_fabrics(
        DesignSpec(garment_category="Kurti", occasion="Everyday office", climate="Hot summer")
    )
    best = summer.recommendations[0]
    assert best.breathability == "high" and best.maintenance == "easy"
    assert "Breathable" in best.climate_fit
    assert all(r.breathability != "low" for r in summer.recommendations[:3])


def test_fabric_budget_note_prefers_lower_cost_without_prices():
    cheap = MockFabricProvider().recommend_fabrics(
        wedding_spec(budget=Budget(note="keep it economical"))
    )
    rich = MockFabricProvider().recommend_fabrics(wedding_spec(budget=Budget(note="premium")))
    score = lambda out, name: next(r.score for r in out.recommendations if r.name.startswith(name))  # noqa: E731
    # Budget is one factor among many: costly fabrics drop, but a wedding still gets festive fabrics.
    assert score(cheap, "Silk") < score(rich, "Silk")
    assert any(r.cost_level == "low" for r in cheap.recommendations[:4])
    silk = next(r for r in cheap.recommendations if r.name.startswith("Silk"))
    assert silk.budget_note.startswith("Your budget note asks to keep costs down")
    for rec in cheap.recommendations:
        assert not re.search(r"\d", rec.budget_note)  # never a price or number


def test_fabric_outputs_saved_before_phase3_still_load():
    old = {
        "recommendations": [{
            "name": "Silk", "swatch_colour": "#8a2240", "texture": "satin", "suitability": "ok", "properties": [],
            "advantages": [], "limitations": [], "care": "Dry clean", "drape": "medium", "breathability": "medium",
            "approximate_cost": None, "score": 80,
        }],
        "lining": ["Cotton voile"], "complementary_materials": [], "considerations": [],
    }
    out = FabricOutput.model_validate(old)
    assert out.recommendations[0].comfort == "medium" and out.lining_options == []


def test_anthropic_fabric_answer_is_converted_and_prices_removed():
    rec = FabricRecommendation(
        name="Velvet", swatch_colour="#4a1426", texture="pile", suitability="Warm", properties=[], advantages=[],
        limitations=[], care="Dry clean", drape="medium", breathability="low", approximate_cost="₹900/m", score=90,
        comfort="medium", maintenance="delicate", weight="heavy", cost_level="high",
    )
    answer = FabricAnswer(
        recommendations=[rec], lining_options=[Suggestion(name="Satin", reason="Smooth")],
        embellishment_options=[Suggestion(name="Zardozi", reason="Shows on pile")],
        complementary_materials=["Thread"], considerations=["Heavy"],
    )
    client = AnthropicClient(api_key="sk-ant-test", model="test-opus-5-5")
    response = SimpleNamespace(parsed_output=answer, stop_reason="end_turn", model="test-opus-5-5",
                               _request_id="r", usage=SimpleNamespace(input_tokens=10, output_tokens=10))
    calls = []
    client.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
        parse=lambda **kw: calls.append(kw) or response)))
    out = AnthropicFabricProvider(client).recommend_fabrics(wedding_spec(), UsageMeter())
    assert out.recommendations[0].approximate_cost is None
    assert out.lining == ["Satin"] and out.embellishment_options[0].name == "Zardozi"
    assert calls[0]["output_format"] is FabricAnswer
    assert "must not contain any price" in calls[0]["messages"][0]["content"]


def test_new_answer_shapes_convert_to_valid_json_schemas():
    from anthropic.lib._parse._transform import transform_schema
    from pydantic import TypeAdapter

    for model in (FabricAnswer, MaterialsOutput):
        schema = transform_schema(TypeAdapter(model).json_schema())
        assert schema["type"] == "object" and schema["additionalProperties"] is False


# ---------- tools & materials tied to the design ----------


def test_materials_checklist_is_specific_to_the_design():
    spec = wedding_spec(preferred_fabrics=["Velvet"])
    out = MockMaterialsProvider().tools_and_materials(spec)
    items = {i.item: i for i in out.items}
    assert items["Walking foot"].linked_to.startswith("Fabric:")
    assert items["Invisible zip + zipper foot"].linked_to == "Closure: side zip"
    assert "Stay tape" in items  # V-neck
    assert items["Main fabric: Velvet"].quantity_hint == ""  # fabric lengths are never guessed
    for item in out.items:
        assert not DIMENSION.search(item.quantity_hint)


def test_materials_job_records_its_design_basis_and_goes_stale_when_fabric_changes(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", closures=["Side zip"], preferred_fabrics=["Georgette"])
    job = generate(client, pid, "materials")
    assert job["status"] == "succeeded" and job["version_number"] == 2
    assert "Fabric: Georgette" in job["output"]["based_on"]
    assert any("Microtex" in i["item"] for i in job["output"]["items"])

    set_spec(client, pid, preferred_fabrics=["Velvet"])
    jobs = {j["id"]: j for j in client.get(f"/api/projects/{pid}").json()["jobs"]}
    assert jobs[job["id"]]["stale"] and jobs[job["id"]]["stale_fields"] == ["preferred_fabrics"]


# ---------- tailor sheet ----------


def test_tailor_sheet_labels_measured_estimate_and_missing():
    spec = wedding_spec(measurements=[
        Measurement(name="Bust", value=86, verified=True),
        Measurement(name="Waist", value=70, verified=False),
    ])
    sheet = build_tailor_sheet(spec, MockMaterialsProvider().tools_and_materials(spec))
    status = {m["name"]: m["status"] for m in sheet.measurements}
    assert status["Bust"] == "Measured"
    assert status["Waist"].startswith("Estimate")
    assert status["Hip"].startswith("Missing")
    assert "Wrist (sleeve opening)" in sheet.missing_measurements  # full sleeves
    assert any("estimates" in w for w in sheet.warnings)


def test_sleeveless_does_not_ask_for_sleeve_length():
    sheet = build_tailor_sheet(wedding_spec(sleeve_style="Sleeveless"), MaterialsOutput(items=[], notes=[]))
    assert "Sleeve length" not in sheet.missing_measurements


def test_tailor_sheet_never_invents_dimensions_and_keeps_designer_notes():
    spec = wedding_spec(
        preferred_fabrics=["Velvet"],
        tailor=TailorNotes(construction="Keep the back plain", cutting="Match the zari border",
                           stitching="Hand-finish the hem",
                           references=[TailorReference(asset_id="b1", view="back"),
                                       TailorReference(asset_id="f1", view="front")]),
    )
    sheet = build_tailor_sheet(spec, MaterialsOutput(items=[], notes=[]))
    generated = [n for n in sheet.construction_notes + sheet.cutting_notes + sheet.stitching_notes
                 if not n.startswith("Designer:")]
    assert generated and not any(DIMENSION.search(n) for n in generated)
    assert "Designer: Keep the back plain" in sheet.construction_notes
    assert "Designer: Match the zari border" in sheet.cutting_notes
    assert any("nap" in n for n in sheet.cutting_notes)  # velvet advice
    assert any("walking foot" in n for n in sheet.stitching_notes)
    assert [r.view for r in sheet.references] == ["front", "back"]
    assert not any("front and a back" in w for w in sheet.warnings)


def test_tailor_sheet_uses_saved_fabric_lining_and_tailor_notes_make_it_stale(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", occasion="Wedding")
    assert generate(client, pid, "fabric")["status"] == "succeeded"
    sheet_job = generate(client, pid, "tailor_sheet")
    fabric_rows = dict(next(s for s in sheet_job["output"]["sections"] if s["heading"] == "Fabric & lining")["rows"])
    assert "suggested" in fabric_rows["Lining"]

    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["tailor"]["stitching"] = "Use silk thread"
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    jobs = {j["id"]: j for j in client.get(f"/api/projects/{pid}").json()["jobs"]}
    assert jobs[sheet_job["id"]]["stale_fields"] == ["tailor"]


# ---------- PDF export ----------


def test_tailor_sheet_pdf_download_with_reference_picture(client, project):
    pid = project["id"]
    asset = client.post(f"/api/projects/{pid}/assets", files={"file": ("front.png", PNG, "image/png")}).json()
    other = client.post("/api/projects", json={"title": "Other"}).json()
    foreign = client.post(f"/api/projects/{other['id']}/assets", files={"file": ("x.png", PNG, "image/png")}).json()
    set_spec(client, pid, garment_category="Kurta", measurements=[{"name": "Bust", "value": 90, "verified": True,
                                                                   "note": ""}],
             tailor={"construction": "", "cutting": "", "stitching": "",
                     "references": [{"asset_id": asset["id"], "view": "front", "note": "Main view"},
                                    {"asset_id": foreign["id"], "view": "back", "note": ""},
                                    {"asset_id": "deleted-asset", "view": "detail", "note": ""}]})
    job = generate(client, pid, "tailor_sheet")
    assert job["status"] == "succeeded"

    res = client.get(f"/api/projects/{pid}/jobs/{job['id']}/tailor-sheet.pdf")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF") and len(res.content) > 2000
    assert "tailor sheet v2.pdf" in res.headers["content-disposition"]

    materials = generate(client, pid, "materials")
    assert client.get(f"/api/projects/{pid}/jobs/{materials['id']}/tailor-sheet.pdf").status_code == 400
    assert client.get(f"/api/projects/{other['id']}/jobs/{job['id']}/tailor-sheet.pdf").status_code == 404


def test_pdf_falls_back_to_helvetica_for_any_text(monkeypatch):
    monkeypatch.setattr(tailor_pdf, "_font_cache", ("Helvetica", "Helvetica-Bold", False))
    spec = wedding_spec(budget=Budget(amount=5000, currency="INR"), design_notes="₹ budget → keep <simple> & neat")
    sheet = build_tailor_sheet(spec, MockMaterialsProvider().tools_and_materials(spec))
    pdf = build_tailor_pdf(sheet, version_number=3, created_on="2026-10-22", images=[])
    assert pdf.startswith(b"%PDF")


# ---------- cost estimate ----------


def test_cost_generator_is_available_and_free(client):
    gens = {g["id"]: g for g in client.get("/api/generators").json()}
    assert gens["cost"]["available"] and gens["cost"]["provider"] == "built-in"
    assert not gens["cost"]["is_mock"]


def test_cost_without_inputs_lists_what_to_price(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Anarkali", preferred_fabrics=["Georgette"], closures=["Side zip"],
             embellishments=["Zari work"])
    generate(client, pid, "fabric")
    generate(client, pid, "materials")
    job = generate(client, pid, "cost")
    assert job["status"] == "succeeded"
    out = job["output"]
    items = [m["item"] for m in out["materials"]]
    assert "Main fabric: Georgette" in items and any(i.startswith("Lining:") for i in items)
    assert "Invisible zip + zipper foot" in items
    assert not any(m["unit_price"] or m["quantity"] for m in out["materials"])  # nothing invented
    assert [l["task"] for l in out["labour"]][0].startswith("Stitching")
    assert out["total"] == 0 and not out["complete"] and out["missing"]
    assert out["currency"] == "INR"


def test_cost_estimate_keeps_labour_separate_and_states_assumptions(client, project):
    pid = project["id"]
    set_spec(client, pid, garment_category="Kurta", budget={"amount": 3000, "currency": "INR", "note": ""})
    options = {
        "currency": "INR", "region": "Jaipur", "price_date": "Oct 2026", "contingency_percent": 10,
        "materials": [
            {"item": "Cotton silk", "kind": "fabric", "quantity": 2.5, "unit": "m", "unit_price": 400,
             "price_source": "Local market"},
            {"item": "Buttons", "kind": "notion", "quantity": 8, "unit": "pcs", "unit_price": 10},
            {"item": "Piping", "kind": "other", "quantity": 3, "unit": "m"},
        ],
        "labour": [{"task": "Stitching", "amount": 800}, {"task": "Embroidery"}],
    }
    out = generate(client, pid, "cost", options)["output"]
    assert out["materials_subtotal"] == 1080  # 2.5 × 400 + 8 × 10; piping has no price
    assert out["contingency_amount"] == 108  # 10% of materials only
    assert out["labour_subtotal"] == 800
    assert out["total"] == 1988
    assert out["materials"][2]["status"] == "missing_price" and out["materials"][2]["line_total"] is None
    assert out["labour"][1]["status"] == "missing"
    assert "Piping: price" in out["missing"] and "Embroidery: amount" in out["missing"]
    text = " ".join(out["assumptions"])
    assert "Jaipur" in text and "10% buffer" in text and "NOT in the total" in text
    assert out["budget_status"] == "unknown"  # cannot say "within" while lines are missing

    options["materials"].pop()
    options["labour"].pop()
    done = generate(client, pid, "cost", options)["output"]
    assert done["complete"] and done["budget_status"] == "within" and done["total"] == 1988


def test_cost_estimate_over_budget_and_currency_mismatch(client, project):
    pid = project["id"]
    set_spec(client, pid, budget={"amount": 1000, "currency": "INR", "note": ""})
    line = {"item": "Silk", "kind": "fabric", "quantity": 3, "unit": "m", "unit_price": 900}
    over = generate(client, pid, "cost", {"currency": "INR", "materials": [line]})["output"]
    assert over["budget_status"] == "over" and "over the budget" in over["budget_note"]
    usd = generate(client, pid, "cost", {"currency": "USD", "materials": [line]})["output"]
    assert usd["budget_status"] == "unknown" and "not compared" in usd["budget_note"]


def test_cost_estimate_rejects_bad_numbers_with_a_clear_message(client, project):
    job = generate(client, project["id"], "cost", {"materials": [{"item": "Silk", "quantity": -2}]})
    assert job["status"] == "failed"
    assert job["error"].startswith("Check the cost details (materials → 0 → quantity)")


def test_providers_page_lists_cost_and_pdf_as_free_code(client):
    services = {s["service"]: s for s in client.get("/api/providers").json()["services"]}
    row = services["Cost, PDF, pattern assistance and storyboards"]
    assert row["configured"] and not row["paid"] and not row["is_mock"]


@pytest.mark.parametrize("ids", [["design", "fabric", "materials", "tailor_sheet", "cost"]])
def test_complete_package_can_include_cost(client, project, ids):
    res = client.post(f"/api/projects/{project['id']}/package",
                      json={"generator_ids": ids, "options": {"design": {"idea": "a wine anarkali for a wedding"}}})
    assert {s["generator_id"]: s["status"] for s in res.json()["steps"]} == {i: "succeeded" for i in ids}
