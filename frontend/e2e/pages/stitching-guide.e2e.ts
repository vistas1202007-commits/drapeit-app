import { expect, test, type Page } from "@playwright/test";
import { API, accessToken, signedIn, snapshot } from "../support/qa";

// The Stitching Guide in the notebook, on a desktop and a phone screen: generate it, tick steps (saved per
// design version), open a step's video at the right moment, and see the Stale badge after the spec changes.
// With E2E_EXPECT_VIDEOS=1 the backend must have tutorial search connected, and the darts video must start
// at its "Sewing bust darts" chapter (the local test stack's fake search does that).

const LOADED = { timeout: 60_000 };
const SPEC = {
  title: "QA stitching anarkali", garment_category: "Anarkali", neckline: "V-neck", sleeve_style: "Full-length sleeves",
  closures: ["Side zip"], preferred_fabrics: ["Georgette"], silhouette: "Flared, fitted bodice",
};

async function call(page: Page, method: string, path: string, data?: unknown) {
  const token = await accessToken(page);
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function changeSpec(page: Page, projectId: string, changes: Record<string, unknown>) {
  const detail = await call(page, "GET", `/api/projects/${projectId}`);
  await call(page, "POST", `/api/projects/${projectId}/versions`, { spec: { ...detail.current_spec, ...changes } });
}

test("stitching guide: generate, tick, play a step video, go stale", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const context = await signedIn(browser, "a", info.project.use); // phone size in the mobile project
  const page = await context.newPage();
  await page.goto("/");
  const project = await call(page, "POST", "/api/projects", { title: SPEC.title });
  await changeSpec(page, project.id, SPEC);

  await page.goto(`/projects/${project.id}`);
  await page.getByRole("main").getByRole("heading", { level: 1 }).first().waitFor(LOADED);
  const row = page.getByRole("tabpanel").getByRole("listitem").filter({ has: page.getByText("Stitching Guide", { exact: true }) });
  await expect(row.getByRole("combobox", { name: "Video language" })).toBeVisible();
  const generated = page.waitForResponse((r) => r.url().includes("/generate/stitching_guide"), { timeout: 120_000 });
  await row.getByRole("button", { name: "Generate" }).click();
  expect((await generated).status()).toBe(200);

  const guide = page.getByRole("region", { name: "Stitching guide" });
  const counter = guide.getByText(/^\d+ of \d+ steps done$/);
  await expect(counter).toHaveText(/^0 of \d+ steps done$/, LOADED);
  const total = Number((await counter.textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThanOrEqual(15);
  await expect(guide.getByText("Anarkali", { exact: true }).first()).toBeVisible();
  await expect(guide.getByText("V-neck, finished with bias binding")).toBeVisible();
  for (const phase of ["Prep & cutting", "Shaping", "Main seams", "Openings & finishes", "Side seams", "Hem", "Pressing"]) {
    await expect(guide.getByRole("heading", { name: new RegExp(`^${phase} \\(`) })).toBeVisible();
  }
  await expect(guide.getByText(/Machine settings for Georgette/)).toBeVisible();
  await expect(guide.getByText(/^For your Georgette in this part$/)).toHaveCount(6); // one box under each phase that has advice

  // The first step is open; tick it, and the tick survives a reload.
  await expect(page.locator("#step-prepare-fabric").getByText(/^From the technique module/)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().includes("/stitching-progress") && r.request().method() === "PUT");
  await guide.getByRole("checkbox", { name: /^Step 1 done/ }).check();
  expect((await saved).status()).toBe(200);
  await expect(counter).toHaveText(`1 of ${total} steps done`);
  await page.reload();
  await expect(page.getByRole("region", { name: "Stitching guide" }).getByRole("checkbox", { name: /^Step 1 done/ })).toBeChecked(LOADED);
  await expect(guide.getByRole("button", { name: /^Next: step 2/ })).toBeVisible();

  // A step's video: starts at the chapter that shows the technique, and the channel is named.
  const darts = page.locator("#step-darts");
  await darts.getByRole("button", { name: /Sew the darts/ }).click();
  await expect(darts.getByText(/^From the technique module “Sew the darts”/)).toBeVisible();
  if (process.env.E2E_EXPECT_VIDEOS === "1") {
    await expect(darts.getByText(/^Channel:/)).toContainText("Sew School");
    await expect(darts.getByText(/Video chapter “Sewing bust darts” · 3:10–6:40/)).toBeVisible();
    await darts.getByRole("button", { name: /^Play from 3:10/ }).click();
    const frame = darts.locator('iframe[src^="https://www.youtube-nocookie.com/embed/"]');
    await expect(frame).toBeVisible();
    const src = new URL((await frame.getAttribute("src"))!);
    expect([src.searchParams.get("start"), src.searchParams.get("end")]).toEqual(["190", "400"]);
    const sideSeams = page.locator("#step-side-seams");
    await sideSeams.getByRole("button", { name: /Close the side seams/ }).click();
    await expect(sideSeams.getByText("No video found for this step.")).toBeVisible();
    await expect(sideSeams.getByRole("link", { name: /on YouTube/ })).toHaveAttribute("href", /youtube\.com\/results\?search_query=/);
  } else {
    await expect(darts.getByText(/Video search is not connected|No video found|^Channel:/).first()).toBeVisible();
  }

  // Phone-friendly: nothing scrolls sideways, and the tick boxes are big enough to tap.
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(info.project.name === "mobile" ? 390 : 1280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const tickArea = await guide.locator("label:has(input[type=checkbox])").first().boundingBox();
  expect(tickArea!.width).toBeGreaterThanOrEqual(40);
  expect(tickArea!.height).toBeGreaterThanOrEqual(40);
  await snapshot(page, `stitching-guide-${info.project.name}`);

  // Change the design: the guide is marked Stale, and version 1's ticks are kept.
  await changeSpec(page, project.id, { neckline: "Boat neck" });
  await page.reload();
  await expect(guide.getByText("Stale", { exact: true })).toBeVisible(LOADED);
  await expect(guide.getByText(/Your ticks for version \d+ stay saved/)).toBeVisible();
  await expect(guide.getByRole("checkbox", { name: /^Step 1 done/ })).toBeChecked();

  await call(page, "DELETE", `/api/projects/${project.id}`);
  await context.close();
});
