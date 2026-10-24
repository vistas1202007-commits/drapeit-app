import { expect, test, type Page } from "@playwright/test";
import { accessToken, API, loadState, note, signedIn, snapshot, users } from "../support/qa";

test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function adminTab(page: Page, name: string) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await settle(page);
}

/** Fill the admin action dialog (note or reason) and press its confirm button. */
async function confirmAction(page: Page, confirm: string, text = "QA admin test") {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole("textbox").first();
  if (await box.isVisible()) await box.fill(text);
  const days = dialog.getByRole("combobox").first();
  if (await days.isVisible()) await days.selectOption({ index: 1 }).catch(() => {});
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden(SLOW);
}

test("people who are not admins cannot open the admin panel or its API", async ({ browser }) => {
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  await page.goto("/admin");
  await settle(page);
  await expect(page.getByRole("tab", { name: /^Reports/ })).toHaveCount(0);
  await snapshot(page, "admin-as-b");
  const token = await accessToken(page);
  const res = await page.request.get(`${API}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } });
  expect([403, 404], "non-admin must get no admin data").toContain(res.status());
  await ctx.close();
});

test("reports queue: dismiss, warn, suspend and lift", async ({ browser }) => {
  test.setTimeout(300_000);
  const { b } = users();
  // c reports b's account (through the API, the menu item is hard to reach; see the "covered menu" bug).
  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await cpage.goto("/");
  const ctoken = await accessToken(cpage);
  const rep = await cpage.request.post(`${API}/api/reports`, {
    headers: { Authorization: `Bearer ${ctoken}` },
    data: { target_type: "user", target: b.username, reason: "spam", details: "QA test report" },
  });
  expect(rep.status()).toBe(201);
  await cctx.close();

  const actx = await signedIn(browser, "a");
  const page = await actx.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin panel" })).toBeVisible(SLOW);
  await adminTab(page, "Reports");
  await snapshot(page, "admin-reports");

  // Dismiss the report about a's post (made in the social tests), if it is listed.
  const postReport = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: /Post/ }).first();
  if (await postReport.isVisible()) {
    await postReport.getByRole("button", { name: "Dismiss" }).click();
    await confirmAction(page, "Dismiss");
  }

  const userReport = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: b.username }).first();
  await expect(userReport).toBeVisible(SLOW);
  await userReport.getByRole("button", { name: "Warn" }).click();
  await confirmAction(page, "Send warning", "QA warning: please do not post spam.");

  // b sees the warning until pressing "I understand".
  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto("/");
  await expect(bpage.getByText("QA warning: please do not post spam.")).toBeVisible(SLOW);
  await bpage.getByRole("button", { name: /I understand/ }).click();
  await expect(bpage.getByText("QA warning: please do not post spam.")).toHaveCount(0, SLOW);

  // Suspend b
  await page.reload();
  await adminTab(page, "Reports");
  const again = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: b.username }).first();
  if (await again.isVisible()) {
    await again.getByRole("button", { name: /^Suspend/ }).click();
    await snapshot(page, "admin-suspend-dialog");
    await confirmAction(page, "Suspend", "QA suspension test");
  } else {
    note({ kind: "check", who: "a", url: page.url(), detail: "Report left the queue after the warning; suspend tested from the API" });
    const token = await accessToken(page);
    const s = await page.request.post(`${API}/api/admin/users/${users().b.id}/suspend`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { reason: "QA suspension test", days: 1 },
    });
    expect(s.status()).toBe(204);
  }

  // A suspended person sees the banner and cannot comment.
  await bpage.goto(`/p/${loadState().postPublic}`);
  await expect(bpage.getByText(/suspended/i).first()).toBeVisible(SLOW);
  const box = bpage.getByRole("region", { name: "Comments" }).getByPlaceholder("Add a comment…");
  if (await box.isVisible()) {
    await box.fill("comment while suspended");
    const sent = bpage.waitForResponse((r) => /\/posts\/[^/]+\/comments$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", SLOW);
    await bpage.getByRole("region", { name: "Comments" }).getByRole("button", { name: /^(Post|Send|Comment)$/ }).last().click();
    expect((await sent).status(), "comment while suspended").toBe(403);
  }

  // Lift
  await adminTab(page, "Suspensions");
  const row = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: b.username }).first();
  await expect(row).toBeVisible(SLOW);
  await row.getByRole("button", { name: "Lift" }).click();
  await confirmAction(page, "Lift");
  await bpage.reload();
  await settle(bpage);
  await expect(bpage.getByText(/You are suspended|suspended until/i)).toHaveCount(0, SLOW);
  await Promise.all([actx.close(), bctx.close()]);
});

test("verification: approve c, the badge shows on c's profile", async ({ browser }) => {
  const { c } = users();
  const actx = await signedIn(browser, "a");
  const page = await actx.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin panel" })).toBeVisible(SLOW);
  await adminTab(page, "Verification");
  const row = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: c.username }).first();
  await expect(row).toBeVisible(SLOW);
  await row.getByRole("button", { name: "Approve" }).click();
  await confirmAction(page, "Approve");
  await page.goto(`/u/${c.username}`);
  await expect(page.getByRole("img", { name: /Verified/i }).or(page.getByLabel(/Verified/i)).first()).toBeVisible(SLOW);
  await actx.close();
});

test("problem reports and the action log", async ({ browser }) => {
  const actx = await signedIn(browser, "a");
  const page = await actx.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin panel" })).toBeVisible(SLOW);
  await adminTab(page, "Problem reports");
  const row = page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: "Unmute menu item" }).first();
  await expect(row).toBeVisible(SLOW);
  const popup = page.waitForEvent("popup", { timeout: 30_000 }).catch(() => null);
  await row.getByRole("button", { name: /Screenshot/ }).click();
  const shot = await popup;
  if (!shot) note({ kind: "check", who: "a", url: page.url(), detail: "Screenshot button did not open a new tab" });
  await row.getByRole("button", { name: "Resolved" }).click();
  await settle(page);
  await adminTab(page, "Action log");
  await snapshot(page, "admin-log");
  await expect(page.getByRole("tabpanel").getByRole("listitem").first()).toBeVisible(SLOW);
  await actx.close();
});
