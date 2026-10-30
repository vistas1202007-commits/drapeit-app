import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test("confirmation and checklist persist at " + viewport.width + "px", async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?case=video");
    await expect(page.getByText("Personalized stitching video guide", { exact: true })).toBeVisible();
    const review = page.getByRole("region", { name: "Confirm construction details" });
    await expect(review).toBeVisible();
    await review.getByRole("button", { name: "Confirm construction choices" }).click();
    await expect(page.getByText("Choose an option for each construction detail.")).toBeVisible();
    await review.getByLabel("Closure position").selectOption("none");
    await review.getByLabel("Fabric construction").selectOption("woven");
    await review.getByLabel("Fabric weight").selectOption("medium");
    await review.getByLabel("Seam finish").selectOption("plain");
    await review.getByRole("button", { name: "Confirm construction choices" }).click();
    await expect(page.getByText("Choices saved. Update the guide to use the new design version.")).toBeVisible();
    const spec = await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-saved-spec") || "{}"));
    expect(spec.construction).toMatchObject({ closure_position: "none", fabric_construction: "woven", seam_finish: "plain" });
    await page.getByRole("checkbox").first().check();
    await page.reload();
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: "e2e/.results/offline/stitching-" + viewport.width + ".png", fullPage: true });
  });
}
test("legacy storyboard and saved guides still render", async ({ page }) => {
  await page.goto("/?case=legacy");
  await expect(page.getByText("Storyboard and script (no video generated)")).toBeVisible();
  await expect(page.getByText("Full narration script")).toBeVisible();
  await page.goto("/?case=oldguide");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Confirm construction details" })).toHaveCount(0);
});
test("candidates are labelled and reviewed hosted clips use a native player", async ({ page }) => {
  const bytes = await readFile("e2e/offline/playback-fixture.webm");
  await page.route("https://media.invalid/fixture.webm", async (route) => {
    const range = route.request().headers()["range"]?.match(/^bytes=([0-9]+)-([0-9]*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({
      status: range ? 206 : 200, contentType: "video/webm", body: bytes.subarray(start, end + 1),
      headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": "bytes " + start + "-" + end + "/" + bytes.length } : {}) },
    });
  });
  await page.goto("/?case=mediaguide");
  await expect(page.getByText(/Unverified search result/)).toBeVisible();
  await page.getByRole("button", { name: /Step 2/ }).click();
  await expect(page.locator("video")).toHaveAttribute("src", "https://media.invalid/fixture.webm");
  await expect(page.getByText(/Reviewed by Fixture reviewer/)).toBeVisible();
  const player = page.locator("video");
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBe(10);
  await player.evaluate((v) => { (v as HTMLVideoElement).currentTime = 5; });
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBe(10);
  await player.evaluate(async (v) => { (v as HTMLVideoElement).muted = true; (v as HTMLVideoElement).currentTime = 29.8; await (v as HTMLVideoElement).play(); });
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true);
  expect(await player.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(30);
});
