import { expect, test, type Page } from "@playwright/test";
import { loadState, makePng, note, openProject, saveState, signedIn, snapshot } from "../support/qa";

test.describe.configure({ mode: "serial" });

const LOADED = { timeout: 60_000 };

async function openProjectPage(page: Page, sub = "") {
  await openProject(page, loadState().project, sub);
  await page.getByRole("main").getByRole("heading", { level: 1 }).first().waitFor(LOADED);
}

function generator(page: Page, name: string) {
  return page.getByRole("tabpanel").getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

test("create a design from the dashboard", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("textbox", { name: "Design name" }).fill("QA bridal lehenga");
  await page.getByRole("combobox", { name: /Garment type/ }).selectOption({ index: 1 });
  await page.getByRole("textbox", { name: /Your idea/ }).fill(
    "A wine velvet lehenga with gold zari work, full sleeves blouse and a V-neck for a winter wedding",
  );
  await page.getByRole("button", { name: "Create and open notebook" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  saveState({ project: page.url().match(/projects\/([0-9a-f-]{36})/)![1] });
  await expect(page.getByRole("heading", { name: "QA bridal lehenga", level: 1 })).toBeVisible(LOADED);
  await context.close();
});

test("notebook: complete package, every extra generator, spec edit and history", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page);

  // Reference picture
  const upload = page.waitForResponse((r) => r.url().includes("/assets") && r.request().method() === "POST");
  await page.getByRole("heading", { name: "References" }).locator("..").locator('input[type="file"]')
    .or(page.locator('input[type="file"]').first())
    .first()
    .setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: makePng(120) });
  expect((await upload).status()).toBeLessThan(300);

  // Complete package
  await page.getByRole("button", { name: "Generate complete design package" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Run selected" }).click();
  await dialog.getByRole("button", { name: "Close" }).click({ timeout: 120_000 });
  await expect(page.getByRole("region", { name: "Design concept" }).getByText(/MOCK/).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("region", { name: "Sketches" }).locator("img").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("region", { name: "Tailor sheet" }).getByText(/Generate the tailor sheet|Write your idea/)).toHaveCount(0);
  await snapshot(page, "notebook-after-package");

  // The other generators, one by one
  for (const name of ["Design Variations", "Moodboard", "Embroidery & Print Concepts", "Pattern Assistance", "Tutorial", "Instructional Video"]) {
    const done = page.waitForResponse((r) => r.url().includes("/generate/") && r.request().method() === "POST", { timeout: 60_000 });
    await generator(page, name).getByRole("button", { name: "Generate" }).click();
    const res = await done;
    if (res.status() >= 300) note({ kind: "bug", who: "a", url: page.url(), detail: `Generator ${name} answered ${res.status()}` });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.getByText("This page couldn’t load").count()) {
      note({ kind: "bug", who: "a", url: page.url(), detail: `Notebook crashed after generating ${name}` });
      await openProjectPage(page);
    }
  }
  await page.waitForTimeout(1500);
  for (const region of ["Design variations", "Moodboard", "Embroidery & print", "Pattern assistance", "Tutorials", "Instructional video"]) {
    const empty = page.getByRole("region", { name: region }).getByText(/^(Try alternative|Collect the mood|Get embroidery|Conceptual help|Find real tutorial|Plan a how-to)/);
    if (await empty.count()) note({ kind: "bug", who: "a", url: page.url(), detail: `${region}: still empty after Generate` });
  }
  await snapshot(page, "notebook-after-all");

  // Edit the spec: the sketch should be marked out of date
  await page.getByRole("tab", { name: "Design spec" }).click();
  await snapshot(page, "spec-tab");
  const neckline = page.getByRole("tabpanel").getByRole("textbox", { name: /Neckline/ }).first();
  await neckline.fill("Sweetheart neck");
  await page.getByRole("tabpanel").getByRole("button", { name: /Save/ }).first().click();
  await expect(page.getByText(/Out of date/i).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByRole("tabpanel").getByText(/v2|Version 2/).first()).toBeVisible();
  await context.close();
});

test("pressing two generators quickly does not crash the notebook", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Design name" }).fill("QA race check");
  await page.getByRole("button", { name: "Create and open notebook" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  await page.getByRole("main").getByRole("heading", { level: 1 }).first().waitFor(LOADED);
  // Pattern starts (saved as "running" first); Tools and Materials finishes and reloads the project meanwhile.
  await generator(page, "Pattern Assistance").getByRole("button", { name: "Generate" }).click();
  await generator(page, "Tools and Materials").getByRole("button", { name: "Generate" }).click();
  await generator(page, "Embroidery & Print Concepts").getByRole("button", { name: "Generate" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);
  expect(crashes, "page errors").toEqual([]);
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click().catch(() => {});
  await page.getByRole("dialog").getByRole("button", { name: /Delete/ }).click().catch(() => {});
  await context.close();
});

test("a job that is still running is shown as Generating…, not drawn as a result (BUG-01)", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
  const id = loadState().project;
  // Hand the page the exact state that used to crash it: a Pattern job saved as "running" with no output yet.
  await page.route(new RegExp(`/api/projects/${id}$`), async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const template = json.jobs[0];
    json.jobs.unshift({ ...template, id: "00000000-0000-4000-8000-000000000001", generator_id: "pattern", status: "running",
      output: null, error: null, created_at: new Date().toISOString(), finished_at: null });
    await route.fulfill({ response, json });
  });
  await openProjectPage(page);
  await page.waitForTimeout(1500);
  expect(crashes, "page errors").toEqual([]);
  await expect(page.getByRole("region", { name: "Pattern assistance" }).getByText("Generating…")).toBeVisible();
  await context.close();
});

test("a crash shows the app's own error page with Try again (BUG-06)", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  const id = loadState().project;
  // A finished Pattern result with its fields missing makes the page throw while drawing.
  const broken = new RegExp(`/api/projects/${id}$`);
  await page.route(broken, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.jobs.unshift({ ...json.jobs[0], id: "00000000-0000-4000-8000-000000000002", generator_id: "pattern",
      status: "succeeded", output: { broken: true }, error: null, created_at: new Date().toISOString() });
    await route.fulfill({ response, json });
  });
  await page.goto(`/projects/${id}`);
  await expect(page.getByRole("heading", { name: "Something went wrong", level: 1 })).toBeVisible(LOADED);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  await page.unroute(broken);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toHaveText(/QA bridal lehenga|Something went wrong/, LOADED);
  await page.goto(`/projects/${id}`);
  await expect(page.getByRole("heading", { name: "QA bridal lehenga", level: 1 })).toBeVisible(LOADED);
  await context.close();
});

test("design studio: draw, save, download", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page, "/studio");
  const canvas = page.locator("canvas").last();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 60 + i * 15, box.y + 60 + i * 10);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Save drawing" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole("button", { name: "Save as project sketch" }).click();
  await expect(page.getByText(/saved|added/i).first()).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("fabric studio: recommend and save a fabric", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page, "/fabric");
  await page.getByRole("button", { name: /^(Recommend fabrics|Regenerate)$/ }).click();
  const save = page.getByRole("button", { name: "Save to design" }).first();
  await expect(save).toBeVisible({ timeout: 60_000 });
  const before = await page.getByRole("button", { name: "Saved to design" }).count();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved to design" })).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(page.getByText("No favourites yet.", { exact: false })).toHaveCount(0);
  await context.close();
});

test("tailor workspace: measurements, details, sheet and PDF", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page, "/tailor");
  await expect(page.getByRole("heading", { name: "Measurements", exact: true })).toBeVisible(LOADED);
  const add = page.getByRole("button", { name: "+ Bust / chest" });
  if (await add.isVisible()) await add.click();
  const value = page.getByRole("textbox", { name: "Bust / chest value in cm" });
  await value.fill("abc");
  if ((await value.inputValue()) === "abc") {
    note({ kind: "check", who: "a", url: page.url(), detail: "Measurement box accepts letters ('abc'); see what Save does" });
  }
  await value.fill("86");
  await page.getByRole("checkbox", { name: "Measured" }).first().check();
  await page.getByRole("textbox", { name: "Construction notes" }).fill("Keep the back plain");
  await page.getByRole("button", { name: /Save tailor details/ }).click();
  await expect(page.getByRole("button", { name: /Save tailor details as v\d+/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Generate tailor sheet|Update/ }).first().click();
  const pdf = page.getByRole("button", { name: /Download PDF/ }).or(page.getByRole("link", { name: /Download PDF/ })).first();
  await expect(pdf).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await pdf.click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await context.close();
});

test("cost estimate: lines, calculate, total", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page, "/cost");
  await page.getByRole("textbox", { name: /city \/ region/ }).fill("Jaipur");
  await page.getByRole("button", { name: "+ Material line" }).click();
  await page.getByRole("button", { name: "+ Labour line" }).click();
  await page.getByRole("textbox", { name: "Item", exact: true }).last().fill("Velvet");
  // The other boxes in the row are labelled with the item's name once it is typed.
  await page.getByRole("combobox", { name: "Kind of Velvet" }).last().selectOption("fabric");
  await page.getByRole("textbox", { name: "Quantity of Velvet" }).last().fill("3");
  await page.getByRole("textbox", { name: "Unit for Velvet" }).last().fill("m");
  await page.getByRole("textbox", { name: "Price per unit of Velvet" }).last().fill("850");
  await page.getByRole("textbox", { name: "Task", exact: true }).last().fill("Stitching");
  await page.getByRole("textbox", { name: "Amount for Stitching" }).last().fill("2500");
  await page.getByRole("button", { name: "Calculate estimate" }).click();
  // 3 x 850 = 2550, +10% buffer = 2805, + 2500 labour = 5305
  await expect(page.getByText(/5,305|5305/).first()).toBeVisible({ timeout: 30_000 });
  await snapshot(page, "cost-result");
  await context.close();
});

test("rename, duplicate, export and delete a design", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await openProjectPage(page);
  const download = page.waitForEvent("download", { timeout: 90_000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  if (Date.now() - t0 > 8000) note({ kind: "slow", who: "a", url: page.url(), detail: `Export JSON took ${Date.now() - t0} ms` });

  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.waitForURL((u) => !u.pathname.includes(loadState().project), { timeout: 30_000 });
  await page.getByRole("main").getByRole("heading", { level: 1 }).first().waitFor(LOADED);
  const copyId = page.url().match(/projects\/([0-9a-f-]{36})/)![1];
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Delete/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL((u) => !u.pathname.includes(copyId), { timeout: 30_000 });

  await page.goto("/designs");
  await expect(page.getByText("QA bridal lehenga").first()).toBeVisible(LOADED);
  await context.close();
});
