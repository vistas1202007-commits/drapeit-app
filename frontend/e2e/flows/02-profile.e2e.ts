import { expect, test } from "@playwright/test";
import { makePng, note, signedIn, users } from "../support/qa";

test.describe.configure({ mode: "serial" });

const XSS = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;

test("edit name, bio and picture; the bio is shown as plain text", async ({ browser }) => {
  const a = users().a;
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await page.goto("/profile/edit");
  await page.getByRole("textbox", { name: "Display name" }).fill("QA A Atelier");
  await page.getByRole("textbox", { name: /^Bio/ }).fill(`Bridal wear in Jaipur. ${XSS}`);
  await page.getByRole("combobox", { name: "I am a…" }).selectOption("Boutique");

  // Picture: the hidden file input next to "Upload a picture".
  const uploaded = page.waitForResponse((r) => r.url().includes("/api/me/avatar"));
  await page.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: makePng(128, [20, 90, 120]) });
  expect((await uploaded).status()).toBe(200);

  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForURL(new RegExp(`/u/${a.username}`)).catch(() => {});
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("heading", { name: "QA A Atelier" })).toBeVisible();
  await expect(page.getByText("Bridal wear in Jaipur.", { exact: false })).toBeVisible();
  await expect(page.getByText("Boutique", { exact: true })).toBeVisible();
  const avatar = page.getByRole("img", { name: /profile picture/ }).first();
  await expect(avatar).toBeVisible();
  await expect
    .poll(() => avatar.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0), {
      message: "profile picture loads",
      timeout: 15_000,
    })
    .toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await context.close();
});

test("a fake picture and a too-big picture are refused with a message", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await page.goto("/profile/edit");
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<html>not a picture</html>") });
  await expect(page.getByText(/not a (PNG|picture|valid)|could not|only PNG|unsupported|invalid/i).first()).toBeVisible();

  const big = Buffer.concat([makePng(64), Buffer.alloc(6 * 1024 * 1024)]);
  await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
  await expect(page.getByText(/too (big|large)|5 MB|smaller/i).first()).toBeVisible();
  await context.close();
});

test("the bio limit is enforced", async ({ browser }) => {
  const context = await signedIn(browser, "a");
  const page = await context.newPage();
  await page.goto("/profile/edit");
  const bio = page.getByRole("textbox", { name: /^Bio/ });
  await bio.fill("x".repeat(400));
  const length = (await bio.inputValue()).length;
  if (length > 300) {
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/300|too long/i).first()).toBeVisible();
  }
  await context.close();
});

test("another person sees the new profile; there is no field for links", async ({ browser }) => {
  const a = users().a;
  const context = await signedIn(browser, "c");
  const page = await context.newPage();
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("heading", { name: "QA A Atelier" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Follow|Request to follow)$/ })).toBeVisible();
  await page.goto("/profile/edit");
  if ((await page.getByRole("textbox", { name: /website|link/i }).count()) === 0) {
    note({ kind: "missing", who: "c", url: page.url(), detail: "Profile has no website / links field" });
  }
  await context.close();
});
