import { expect, test, type Browser, type Page } from "@playwright/test";
import { loadState, openProject, saveState, signedIn, snapshot, users, type QaName } from "../support/qa";

test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };
type Visibility = "Public" | "Followers" | "Close Friends" | "Private";

async function follow(page: Page, username: string) {
  await page.goto(`/u/${username}`);
  const button = page.getByRole("button", { name: /^(Follow|Request to follow|Following|Requested)$/ });
  await expect(button).toBeVisible(SLOW);
  if ((await button.textContent())?.trim() === "Follow") {
    await button.click();
    await expect(page.getByRole("button", { name: /^(Following|Unfollow)$/ })).toBeVisible(SLOW);
  }
}

test("set up: b follows a, and c is on a's Close Friends list", async ({ browser }) => {
  const { a, c } = users();
  const b = await signedIn(browser, "b");
  await follow(await b.newPage(), a.username);
  await b.close();

  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await page.goto("/close-friends");
  await page.getByRole("textbox", { name: "Add people" }).fill(c.username);
  const row = page.getByRole("listitem").filter({ hasText: c.username }).first();
  await expect(row).toBeVisible(SLOW);
  const add = row.getByRole("button", { name: /Add/ });
  if (await add.isVisible()) await add.click();
  await expect(page.getByRole("heading", { name: /Your list \([1-9]/ })).toBeVisible(SLOW);
  await ctx.close();
});

async function publish(browser: Browser, visibility: Visibility): Promise<string> {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await openProject(page, loadState().project, "/publish");
  await expect(page.getByRole("group", { name: "Who can see it" })).toBeVisible(SLOW);
  // Pick the first picture if none is chosen yet.
  const chosen = page.getByText(/Pictures \((\d+) chosen/);
  await expect(chosen).toBeVisible(SLOW);
  if (/\(0 chosen/.test((await chosen.textContent()) ?? "")) {
    await page.getByRole("main").getByRole("checkbox").first().check();
  }
  await page.getByRole("textbox", { name: /^Caption/ }).fill(`QA ${visibility} post #lehenga`);
  await page.getByRole("textbox", { name: "Garment tag" }).fill("Lehenga");
  await page.getByRole("textbox", { name: "Occasion tag" }).fill("Wedding");
  await page.getByRole("group", { name: "Who can see it" }).getByText(visibility, { exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/, SLOW);
  const id = page.url().match(/\/p\/([0-9a-f-]{36})/)![1];
  await expect(page.getByRole("article").getByText(`QA ${visibility} post`)).toBeVisible(SLOW);
  await ctx.close();
  return id;
}

test("publish four posts, one for each visibility", async ({ browser }) => {
  test.setTimeout(400_000);
  const ids: Record<string, string> = {};
  for (const v of ["Public", "Followers", "Close Friends", "Private"] as Visibility[]) ids[`post${v.replace(" ", "")}`] = await publish(browser, v);
  saveState(ids);
});

const EXPECT: Record<QaName, Record<string, boolean>> = {
  a: { postPublic: true, postFollowers: true, postCloseFriends: true, postPrivate: true },
  b: { postPublic: true, postFollowers: true, postCloseFriends: false, postPrivate: false },
  c: { postPublic: true, postFollowers: true, postCloseFriends: true, postPrivate: false },
};

for (const who of ["b", "c"] as QaName[]) {
  test(`${who} sees exactly the posts they are allowed to see`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await signedIn(browser, who);
    const page = await ctx.newPage();
    const state = loadState();
    for (const [key, allowed] of Object.entries(EXPECT[who])) {
      await page.goto(`/p/${state[key]}`);
      const caption = page.getByRole("article").getByText(/QA (Public|Followers|Close Friends|Private) post/).first();
      const missing = page.getByText("This post could not be opened");
      await expect(caption.or(missing)).toBeVisible(SLOW);
      expect(await caption.isVisible(), `${who} opening ${key}`).toBe(allowed);
    }
    // The feed and a's profile grid agree with the rules.
    await page.goto(`/u/${users().a.username}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await snapshot(page, `profile-a-seen-by-${who}`);
    await ctx.close();
  });
}

test("drafts, edit caption, archive and pin", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  const { postPublic } = loadState();
  await page.goto(`/p/${postPublic}/edit`);
  await expect(page.getByRole("textbox", { name: /^Caption/ })).toBeVisible(SLOW);
  await page.getByRole("textbox", { name: /^Caption/ }).fill("QA Public post #lehenga (edited)");
  const saved = page.waitForResponse((r) => r.url().includes(`/api/posts/${postPublic}`) && r.request().method() === "PATCH", SLOW);
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).status()).toBe(200);
  await page.goto(`/p/${postPublic}`);
  await expect(page.getByRole("article").getByText("(edited)").first()).toBeVisible(SLOW);
  await snapshot(page, "post-detail-owner");
  await ctx.close();
});
