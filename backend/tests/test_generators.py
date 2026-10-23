from app.providers.mock.idea import MockIdeaProvider
from app.providers.mock.sketch import build_svg
from app.schemas.design_spec import DesignSpec
from app.schemas.outputs import SKETCH_STYLES


def test_mock_idea_understanding():
    out = MockIdeaProvider().analyse_idea(
        "An embroidered wine colour anarkali with full sleeves and a V-neck for a wedding", DesignSpec()
    )
    spec = out.proposed_spec
    assert spec.garment_category == "Anarkali"
    assert spec.colour_palette == ["Wine"]
    assert spec.embellishments == ["Embroidery"]
    assert spec.sleeve_style == "Full-length sleeves"
    assert spec.neckline == "V-neck"
    assert spec.occasion == "Wedding"
    # "embroidered" must not be read as the colour "red"
    assert "Red" not in spec.colour_palette
    assert any("measurements" in q for q in out.unresolved_questions)


def test_every_sketch_style_renders_and_is_labelled_mock():
    spec = DesignSpec(garment_category="Anarkali", garment_length="Floor length", colour_palette=["Wine"],
                      embellishments=["Embroidery"])
    for style in SKETCH_STYLES:
        svg = build_svg(spec, style)
        assert svg.startswith("<svg") and "MOCK SKETCH" in svg


def test_list_generators_marks_planned_ones_unavailable(client, planned_generator):
    gens = {g["id"]: g for g in client.get("/api/generators").json()}
    assert gens["design"]["available"] and gens["design"]["is_mock"]
    assert gens["tutorial"]["available"]
    assert not gens["future"]["available"]
    assert gens["future"]["unavailable_reason"] == "Planned for Phase 5"


def test_design_generator_needs_an_idea(client, project):
    job = client.post(f"/api/projects/{project['id']}/generate/design", json={"options": {}}).json()
    assert job["status"] == "failed"
    assert "idea" in job["error"].lower()


def test_design_apply_then_sketch_and_stale_tracking(client, project):
    pid = project["id"]
    job = client.post(
        f"/api/projects/{pid}/generate/design", json={"options": {"idea": "wine anarkali with embroidery"}}
    ).json()
    assert job["status"] == "succeeded" and job["is_mock"]
    applied = client.post(f"/api/projects/{pid}/jobs/{job['id']}/apply").json()
    assert applied["version_number"] == 2

    sketch = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "ink"}}).json()
    assert sketch["status"] == "succeeded"
    assert sketch["output"]["svg"].startswith("<svg")
    assert sketch["version_number"] == 2

    # Changing only the budget must NOT make the sketch stale, but changing the neckline must.
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["budget"]["amount"] = 5000
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    jobs = {j["id"]: j for j in client.get(f"/api/projects/{pid}").json()["jobs"]}
    assert jobs[sketch["id"]]["stale"] is False

    spec["neckline"] = "Boat neck"
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    jobs = {j["id"]: j for j in client.get(f"/api/projects/{pid}").json()["jobs"]}
    assert jobs[sketch["id"]]["stale"] is True
    assert jobs[sketch["id"]]["stale_fields"] == ["neckline"]


def test_unavailable_generator_is_refused(client, project, planned_generator):
    res = client.post(f"/api/projects/{project['id']}/generate/future", json={"options": {}})
    assert res.status_code == 409


def test_retry_failed_job(client, project):
    pid = project["id"]
    failed = client.post(f"/api/projects/{pid}/generate/sketch", json={"options": {"style": "ink"}}).json()
    assert failed["status"] == "failed"
    spec = client.get(f"/api/projects/{pid}").json()["current_spec"]
    spec["garment_category"] = "Kurta"
    client.post(f"/api/projects/{pid}/versions", json={"spec": spec})
    retried = client.post(f"/api/projects/{pid}/jobs/{failed['id']}/retry").json()
    assert retried["status"] == "succeeded"
    assert retried["output"]["style"] == "ink"


def test_complete_package(client, project, planned_generator):
    pid = project["id"]
    client.post(f"/api/projects/{pid}/messages", json={"content": "x"})
    res = client.post(
        f"/api/projects/{pid}/package",
        json={
            "generator_ids": ["design", "sketch", "fabric", "materials", "tailor_sheet", "future"],
            "options": {"design": {"idea": "a wine anarkali for a wedding with zari work"},
                        "sketch": {"style": "watercolour"}},
        },
    ).json()
    status = {s["generator_id"]: s["status"] for s in res["steps"]}
    assert status == {"future": "skipped", "design": "succeeded", "sketch": "succeeded",
                      "fabric": "succeeded", "materials": "succeeded", "tailor_sheet": "succeeded"}
    detail = client.get(f"/api/projects/{pid}").json()
    sheet = next(j for j in detail["jobs"] if j["generator_id"] == "tailor_sheet")["output"]
    assert "Bust / chest" in sheet["missing_measurements"]
    fabric = next(j for j in detail["jobs"] if j["generator_id"] == "fabric")["output"]
    assert all(r["approximate_cost"] is None for r in fabric["recommendations"])


def test_rate_limit(db):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from tests.conftest import USER_A, make_settings, make_token

    app = create_app(make_settings(generation_rate_limit_per_minute=2), db=db)
    c = TestClient(app, headers={"Authorization": f"Bearer {make_token(USER_A)}"})
    pid = c.post("/api/projects", json={"title": "t"}).json()["id"]
    codes = [c.post(f"/api/projects/{pid}/generate/materials", json={}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
