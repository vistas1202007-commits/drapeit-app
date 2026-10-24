import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { loadState, makePng, note, signedIn, snapshot, stateFile, users, USERS_FILE, watchPage } from "../support/qa";

test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

test("settings home search finds a setting", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await page.goto("/settings");
  const search = page.getByRole("searchbox").or(page.getByRole("textbox", { name: /Search/ })).first();
  await expect(search).toBeVisible(SLOW);
  await search.fill("theme");
  await expect(page.getByRole("main").getByRole("link", { name: /Theme/ }).first()).toBeVisible(SLOW);
  await search.fill("zzzz nothing");
  await expect(page.getByText(/No setting matches/).first()).toBeVisible(SLOW);
  await ctx.close();
});

test("privacy: hidden words hide a comment, who can comment = Nobody, who can message = Nobody", async ({ browser }) => {
  const { c } = users();
  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto("/settings/privacy");
  await apage.getByRole("textbox", { name: "Add hidden words" }).fill("spamword");
  await apage.getByRole("button", { name: "Add", exact: true }).click();
  await expect(apage.getByText("spamword").first()).toBeVisible(SLOW);

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto(`/p/${loadState().postPublic}`);
  const box = bpage.getByRole("region", { name: "Comments" }).getByPlaceholder("Add a comment…");
  await box.fill("this is spamword here");
  await bpage.getByRole("region", { name: "Comments" }).getByRole("button", { name: /^(Post|Send|Comment)$/ }).last().click();
  await settle(bpage);

  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await cpage.goto(`/p/${loadState().postPublic}`);
  await expect(cpage.getByRole("region", { name: "Comments" }).getByText(/Beautiful zari work/).first()).toBeVisible(SLOW);
  expect(await cpage.getByText("this is spamword here").count(), "comment with a hidden word is shown to others").toBe(0);

  // Who can comment: Nobody
  await apage.goto("/settings/privacy");
  // The first plain "Nobody" / "Everyone" radios belong to "Who can comment" (the next ones to mentions).
  const commentChoice = (name: string) => apage.locator("label", { has: apage.getByRole("radio", { name, exact: true }) }).first();
  await commentChoice("Nobody").click();
  await settle(apage);
  await bpage.goto(`/p/${loadState().postPublic}`);
  await expect(bpage.getByText("The designer has limited who can comment on this post.")).toBeVisible(SLOW);
  await commentChoice("Everyone").click();
  await settle(apage);

  // Who can message me: Nobody (c), then b cannot start a chat
  await cpage.goto("/settings/privacy");
  await cpage.locator("label", { has: cpage.getByRole("radio", { name: /^Nobody Nobody can start/ }) }).click();
  await settle(cpage);
  await bpage.goto(`/u/${c.username}`);
  const msg = bpage.getByRole("button", { name: "Message" });
  if (await msg.isVisible()) {
    await msg.click();
    await expect(bpage.getByText(/not accept|cannot|can't|does not take|turned off|Nobody/i).first()).toBeVisible(SLOW);
  }
  await cpage.locator("label", { has: cpage.getByRole("radio", { name: /^Everyone Anyone with a profile/ }) }).click();
  await settle(cpage);
  await Promise.all([actx.close(), bctx.close(), cctx.close()]);
});

test("your activity shows likes, comments and time spent", async ({ browser }) => {
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  await page.goto("/settings/activity");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
  await settle(page);
  await snapshot(page, "activity-b");
  for (const tab of ["Likes", "Comments"]) {
    const t = page.getByRole("tab", { name: new RegExp(tab) }).or(page.getByRole("button", { name: new RegExp(`^${tab}`) })).first();
    if (await t.isVisible()) await t.click();
    await settle(page);
  }
  await ctx.close();
});

test("language: Hindi changes the menu, English brings it back", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await page.goto("/settings/language");
  await page.getByText("हिन्दी (Hindi)").click();
  await expect(page.getByRole("navigation", { name: /Main|मुख्य/ }).getByText("सेटिंग्स")).toBeVisible(SLOW);
  // Record pages that stay English in Hindi mode (known: most pages outside menu/settings).
  for (const route of ["/", "/feed", "/explore", "/messages", `/u/${users().a.username}`, "/settings/theme", "/designs"]) {
    await page.goto(route);
    await settle(page);
    const english = await page.getByRole("main").evaluate((m) => {
      const words = (m.textContent ?? "").match(/\b[A-Za-z]{4,}\b/g) ?? [];
      const hindi = (m.textContent ?? "").match(/[ऀ-ॿ]+/g) ?? [];
      return { english: words.length, hindi: hindi.length, sample: words.slice(0, 12).join(" ") };
    });
    note({ kind: "i18n", who: "a", url: route, detail: `Hindi mode: ${english.hindi} Hindi words, ${english.english} English words (e.g. ${english.sample})` });
  }
  await page.goto("/settings/language");
  await page.getByText("English", { exact: false }).first().click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByText("Settings")).toBeVisible(SLOW);
  await ctx.close();
});

test("theme: Denim is kept after reload; Premium themes are locked; profile theme is seen by visitors", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await page.goto("/settings/theme");
  const app = page.getByRole("region", { name: "App theme" });
  await app.getByRole("button", { name: /^Denim/ }).click();
  await expect(app.getByRole("button", { name: /^Denim/ })).toHaveAttribute("aria-pressed", "true");
  const themeAttr = () => page.evaluate(() => document.documentElement.getAttribute("data-theme") ?? document.documentElement.className);
  await settle(page);
  await page.reload();
  await expect(page.getByRole("region", { name: "App theme" }).getByRole("button", { name: /^Denim/ })).toHaveAttribute("aria-pressed", "true", SLOW);
  expect(await themeAttr()).toMatch(/denim/i);

  // In a fresh browser (no local copy), the theme should come from the account.
  const other = await signedIn(browser, "a");
  const p2 = await other.newPage();
  await p2.goto("/");
  await settle(p2);
  expect(await p2.evaluate(() => document.documentElement.getAttribute("data-theme") ?? document.documentElement.className)).toMatch(/denim/i);
  await other.close();

  await page.getByRole("region", { name: "App theme" }).getByRole("button", { name: /^Premium Silk/ }).click();
  await expect(page.getByText(/coming soon|Premium/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save custom theme" })).toBeDisabled();

  const profile = page.getByRole("region", { name: "Profile theme" });
  await profile.getByRole("button", { name: /^Linen/ }).click();
  await settle(page);
  const visitor = await signedIn(browser, "b");
  const vpage = await visitor.newPage();
  await vpage.goto(`/u/${users().a.username}`);
  await settle(vpage);
  await expect(vpage.locator('[data-profile-theme="linen"]')).toHaveCount(1, SLOW);
  await visitor.close();

  // Back to defaults with two quick clicks: both choices must be kept (BUG-12).
  await page.getByRole("region", { name: "App theme" }).getByRole("button", { name: /^System/ }).click();
  await profile.getByRole("button", { name: /^Default/ }).click();
  await settle(page);
  await page.reload();
  await expect(page.getByRole("region", { name: "App theme" }).getByRole("button", { name: /^System/ })).toHaveAttribute("aria-pressed", "true", SLOW);
  await expect(page.getByRole("region", { name: "Profile theme" }).getByRole("button", { name: /^Default/ })).toHaveAttribute("aria-pressed", "true");
  await ctx.close();
});

test("verification: c asks for the badge", async ({ browser }) => {
  const ctx = await signedIn(browser, "c");
  const page = await ctx.newPage();
  await page.goto("/settings/verification");
  const reason = page.getByRole("textbox", { name: /Who are you/ });
  await expect(reason.or(page.getByText("Waiting for review"))).toBeVisible(SLOW);
  if (await reason.isVisible()) {
    await reason.fill("QA test tailor shop in Jaipur, 10 years of bridal work.");
    // The link box starts with "https://"; leave it as a person who has no link would.
    const sent = page.waitForResponse((r) => r.url().includes("/api/me/verification") && r.request().method() === "POST", SLOW);
    await page.getByRole("button", { name: "Send" }).click();
    const res = await sent;
    if (res.status() >= 300) {
      note({ kind: "bug", who: "c", url: page.url(), detail: `Verification request with the pre-filled "https://" link answered ${res.status()}` });
      await page.getByRole("textbox", { name: /Portfolio/ }).fill("");
      await page.getByRole("button", { name: "Send" }).click();
    }
  }
  await expect(page.getByText("Waiting for review")).toBeVisible(SLOW);
  await ctx.close();
});

test("help: report a problem with a screenshot", async ({ browser }) => {
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  await page.goto("/help");
  await page.getByRole("combobox", { name: "What is it about?" }).selectOption({ index: 1 });
  await page.getByRole("textbox", { name: /What happened/ }).fill("QA test: the Unmute menu item is hidden behind the profile divider.");
  await page.locator('input[type="file"]').setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: makePng(200) });
  const sent = page.waitForResponse((r) => r.url().includes("/api/problem-reports"), SLOW);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByText(/Thank you|received|sent/i).first()).toBeVisible(SLOW);
  await ctx.close();
});

test("account: download my data", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await page.goto("/settings/account");
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Download your data" }).click();
  const file = await download;
  const path = await file.path();
  const data = JSON.parse(readFileSync(path, "utf-8"));
  expect(JSON.stringify(data)).toContain(users().a.username);
  await ctx.close();
});

test("account: change password, sign in with the new one", async ({ browser }) => {
  const c = users().c;
  const ctx = await signedIn(browser, "c");
  const page = await ctx.newPage();
  await page.goto("/settings/account");
  const next = `${c.password}-2`;
  await page.getByRole("textbox", { name: "Current password" }).fill(c.password);
  await page.getByRole("textbox", { name: "New password", exact: true }).fill(next);
  await page.getByRole("textbox", { name: "New password again" }).fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/password (was|has been) changed|Password changed|updated/i).first()).toBeVisible(SLOW);
  // Keep the QA account file in step with the new password.
  const all = JSON.parse(readFileSync(USERS_FILE, "utf-8"));
  all.users.find((u: { name: string }) => u.name === "c").password = next;
  writeFileSync(USERS_FILE, JSON.stringify(all, null, 1));
  await ctx.close();

  const fresh = await browser.newContext();
  const login = await fresh.newPage();
  watchPage(login, "c");
  await login.goto("/");
  await login.getByLabel("Email").fill(c.email);
  await login.getByLabel("Password").fill(next);
  await login.getByRole("button", { name: "Sign in" }).click();
  await expect(login.getByLabel("Password")).toBeHidden(SLOW);
  await fresh.storageState({ path: stateFile("c") });
  await fresh.close();
});

test("account: deactivate hides c; signing in again brings c back", async ({ browser }) => {
  const c = users().c;
  const ctx = await signedIn(browser, "c");
  const page = await ctx.newPage();
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Deactivate account" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Deactivate/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await settle(page);
  await snapshot(page, "after-deactivate");

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto(`/u/${c.username}`);
  await settle(bpage);
  const visible = await bpage.getByRole("heading", { name: "QA C Studio" }).isVisible();
  if (visible) note({ kind: "bug", who: "b", url: bpage.url(), detail: "A deactivated profile is still shown to others" });

  // Sign in again
  const fresh = await browser.newContext();
  const login = await fresh.newPage();
  await login.goto("/");
  await expect(login.getByLabel("Email")).toBeVisible(SLOW);
  await login.getByLabel("Email").fill(c.email);
  await login.getByLabel("Password").fill(users().c.password);
  const reactivated = login.waitForResponse((r) => r.url().includes("/api/me/reactivate"), SLOW);
  await login.getByRole("button", { name: "Sign in" }).click();
  await expect(login.getByLabel("Password")).toBeHidden(SLOW);
  expect((await reactivated).status()).toBe(200);
  await settle(login);
  await fresh.storageState({ path: stateFile("c") });
  await bpage.goto(`/u/${c.username}`);
  await expect(bpage.getByRole("heading", { name: "QA C Studio" })).toBeVisible(SLOW);
  await Promise.all([ctx.close(), bctx.close(), fresh.close()]);
});

test("account: ask to delete, then cancel within the 30 days", async ({ browser }) => {
  const c = users().c;
  const ctx = await signedIn(browser, "c");
  const page = await ctx.newPage();
  await page.goto("/settings/account");
  const confirmBox = page.getByRole("textbox", { name: /To confirm, type your username/ });
  const pending = page.getByRole("button", { name: "Cancel deletion" });
  await expect(confirmBox.or(pending).first()).toBeVisible(SLOW);
  if (await pending.isVisible()) {
    await pending.click();
    await settle(page);
    await page.goto("/settings/account");
  }
  await confirmBox.fill(c.username);
  await page.getByRole("button", { name: "Delete account" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Delete/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await settle(page);
  // Asking to delete signs you out; signing in again offers to keep the account.
  await expect(page.getByLabel("Email")).toBeVisible(SLOW);
  await page.getByLabel("Email").fill(c.email);
  await page.getByLabel("Password").fill(users().c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#auth-password")).toBeHidden(SLOW);
  await settle(page);
  await snapshot(page, "after-delete-request-signed-in");
  await page.goto("/settings/account");
  const cancel = page.getByRole("button", { name: /Cancel deletion|Keep my account|Cancel/ }).first();
  await expect(cancel).toBeVisible(SLOW);
  await cancel.click();
  await settle(page);
  await page.goto("/settings/account");
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible(SLOW);
  await page.context().storageState({ path: stateFile("c") });
  await ctx.close();
});
