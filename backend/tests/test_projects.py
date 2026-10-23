PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_create_list_search_and_delete(client):
    a = client.post("/api/projects", json={"title": "Linen shirt", "garment_category": "Shirt"}).json()
    client.post("/api/projects", json={"title": "Festive lehenga", "garment_category": "Lehenga"})
    assert len(client.get("/api/projects").json()) == 2
    found = client.get("/api/projects", params={"search": "linen"}).json()
    assert [p["id"] for p in found] == [a["id"]]
    assert len(client.get("/api/projects", params={"garment_category": "Lehenga"}).json()) == 1
    assert client.delete(f"/api/projects/{a['id']}").status_code == 204
    assert client.get(f"/api/projects/{a['id']}").status_code == 404


def test_create_validates_title(client):
    assert client.post("/api/projects", json={"title": ""}).status_code == 422


def test_versions_are_preserved_and_restorable(client, project):
    pid = project["id"]
    detail = client.get(f"/api/projects/{pid}").json()
    spec = detail["current_spec"]
    spec["neckline"] = "V-neck"
    v2 = client.post(f"/api/projects/{pid}/versions", json={"spec": spec, "note": "neckline"}).json()
    assert v2["version_number"] == 2
    restored = client.post(f"/api/projects/{pid}/versions/1/restore").json()
    assert restored["version_number"] == 3
    assert restored["spec"]["neckline"] == ""
    versions = client.get(f"/api/projects/{pid}").json()["versions"]
    assert [v["version_number"] for v in versions] == [3, 2, 1]


def test_messages_canvas_and_duplicate(client, project):
    pid = project["id"]
    client.post(f"/api/projects/{pid}/messages", json={"content": "A wine anarkali"})
    client.put(f"/api/projects/{pid}/canvas", json={"data": {"layers": [{"id": "a", "shapes": []}]}})
    assert client.get(f"/api/projects/{pid}/canvas").json()["data"]["layers"][0]["id"] == "a"
    copy = client.post(f"/api/projects/{pid}/duplicate").json()
    assert copy["title"] == "Wine anarkali (copy)"
    detail = client.get(f"/api/projects/{copy['id']}").json()
    assert detail["messages"][0]["content"] == "A wine anarkali"
    assert client.get(f"/api/projects/{copy['id']}/canvas").json()["data"]["layers"][0]["id"] == "a"


def test_upload_accepts_real_images_only(client, project):
    pid = project["id"]
    ok = client.post(f"/api/projects/{pid}/assets", files={"file": ("ref.png", PNG, "image/png")})
    assert ok.status_code == 201
    asset = ok.json()
    assert asset["mime_type"] == "image/png"
    assert client.get(f"/api/assets/{asset['id']}").content == PNG

    fake = client.post(f"/api/projects/{pid}/assets", files={"file": ("evil.png", b"<script>", "image/png")})
    assert fake.status_code == 400

    # Just over the 1 MB limit: read and refused with a clear message.
    over = client.post(
        f"/api/projects/{pid}/assets", files={"file": ("big.png", PNG + b"\x00" * (1024 * 1024), "image/png")}
    )
    assert over.status_code == 400
    assert "too large" in over.json()["detail"] and "1 MB" in over.json()["detail"]
    # Far too big: refused at the door, before the file is read.
    huge = client.post(
        f"/api/projects/{pid}/assets", files={"file": ("huge.png", PNG + b"\x00" * (3 * 1024 * 1024), "image/png")}
    )
    assert huge.status_code == 413
    assert huge.json()["detail"] == "The file is too large. The limit is 1 MB."


def test_saving_sketch_sets_thumbnail(client, project):
    pid = project["id"]
    asset = client.post(
        f"/api/projects/{pid}/assets", data={"kind": "sketch"}, files={"file": ("s.png", PNG, "image/png")}
    ).json()
    assert client.get(f"/api/projects/{pid}").json()["project"]["thumbnail_asset_id"] == asset["id"]


def test_export(client, project):
    res = client.get(f"/api/projects/{project['id']}/export")
    assert res.status_code == 200
    assert res.json()["format"] == "ai-fashion-notebook/project@2"
