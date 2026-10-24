import { expect, test, type Page, type Response } from "@playwright/test";
import { chooseFromMenu, loadState, note, signedIn, snapshot, users } from "../support/qa";

test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };

/** The request that adds a comment or a reply (not a comment like). */
function isAddComment(r: Response): boolean {
  return /\/posts\/[^/]+\/comments$/.test(new URL(r.url()).pathname) && r.request().method() === "POST";
}

async function openPost(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await expect(page.getByRole("article").first()).toBeVisible(SLOW);
}

function commentBox(page: Page) {
  return page.getByRole("region", { name: "Comments" }).getByPlaceholder("Add a comment…");
}

async function addComment(page: Page, text: string) {
  const box = commentBox(page);
  await expect(box).toBeVisible(SLOW);
  await box.fill(text);
  const sent = page.waitForResponse(isAddComment, SLOW);
  await page.getByRole("region", { name: "Comments" }).getByRole("button", { name: /^(Post|Send|Comment|Reply)$/ }).last().click();
  return sent;
}

test("b likes, saves and comments on a's public post", async ({ browser }) => {
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  const { postPublic } = loadState();
  await openPost(page, postPublic);
  const article = page.getByRole("article").first();

  await article.getByRole("button", { name: /^\d+ likes?$/ }).click();
  await expect(article.getByRole("button", { name: /^1 like$/ })).toBeVisible(SLOW);
  await article.getByRole("button", { name: /^(Save|Saved)$/ }).click();
  await expect(article.getByRole("button", { name: "Saved" })).toBeVisible(SLOW);

  expect((await addComment(page, "Beautiful zari work! @" + users().a.username)).status()).toBe(201);
  await expect(page.getByRole("region", { name: "Comments" }).getByText("Beautiful zari work!").first()).toBeVisible(SLOW);

  // The like and the save survive a reload, and the post is listed on /saved.
  await openPost(page, postPublic);
  await expect(article.getByRole("button", { name: /^1 like$/ })).toBeVisible(SLOW);
  await page.goto("/saved");
  await expect(page.getByText(/QA Public post/).first()).toBeVisible(SLOW);
  await ctx.close();
});

test("a replies to b's comment and likes it", async ({ browser }) => {
  const ctx = await signedIn(browser, "a");
  const page = await ctx.newPage();
  await openPost(page, loadState().postPublic);
  const comments = page.getByRole("region", { name: "Comments" });
  await expect(comments.getByText("Beautiful zari work!").first()).toBeVisible(SLOW);
  await snapshot(page, "comments-owner-view");
  const like = comments.getByRole("button", { name: /like/i }).first();
  await like.click();
  await comments.getByRole("button", { name: "Reply" }).first().click();
  const reply = comments.getByRole("textbox").last();
  await reply.fill("Thank you!");
  const sent = page.waitForResponse(isAddComment, SLOW);
  await comments.getByRole("button", { name: /^(Post|Send|Reply)$/ }).last().click();
  expect((await sent).status()).toBe(201);
  await expect(comments.getByText("Thank you!").first()).toBeVisible(SLOW);
  await ctx.close();
});

test("b reposts a's post and shares the link", async ({ browser }) => {
  const ctx = await signedIn(browser, "b", { permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await openPost(page, loadState().postPublic);
  const article = page.getByRole("article").first();
  await snapshot(page, "post-seen-by-b");
  const repost = article.getByRole("button", { name: /Repost/ });
  if (await repost.count()) {
    const saved = page.waitForResponse((r) => r.url().endsWith("/repost") && r.request().method() === "POST", SLOW);
    await repost.first().click();
    expect((await saved).status()).toBe(200);
    await expect(article.getByRole("button", { name: /Reposted|Undo repost/ })).toBeVisible(SLOW);
    await page.goto(`/u/${users().b.username}`);
    await page.getByRole("tab", { name: "Reposts" }).click();
    await expect(page.getByText(/QA Public post/).first()).toBeVisible(SLOW);
  } else {
    note({ kind: "bug", who: "b", url: page.url(), detail: "No Repost button on someone else's public post" });
  }
  await openPost(page, loadState().postPublic);
  await page.getByRole("article").first().getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/copied/i).first()).toBeVisible(SLOW);
  await ctx.close();
});

test("restrict: b's new comment waits for a's approval", async ({ browser }) => {
  const { a, b } = users();
  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto(`/u/${b.username}`);
  await chooseFromMenu(apage, "More actions", "Restrict");
  await expect(apage.getByText("Restricted", { exact: true })).toBeVisible(SLOW);

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await openPost(bpage, loadState().postPublic);
  await addComment(bpage, "Restricted comment from b");

  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await openPost(cpage, loadState().postPublic);
  await page_wait(cpage);
  expect(await cpage.getByText("Restricted comment from b").count(), "others must not see a restricted comment").toBe(0);

  await openPost(apage, loadState().postPublic);
  const approve = apage.getByRole("region", { name: "Comments" }).getByRole("button", { name: "Approve" });
  await expect(approve.first()).toBeVisible(SLOW);
  await approve.first().click();
  await openPost(cpage, loadState().postPublic);
  await expect(cpage.getByText("Restricted comment from b").first()).toBeVisible(SLOW);

  // Undo restrict for the later tests.
  await apage.goto(`/u/${b.username}`);
  await chooseFromMenu(apage, "More actions", "Unrestrict");
  await Promise.all([actx.close(), bctx.close(), cctx.close()]);
  void a;
});

async function page_wait(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

test("report a post with a reason", async ({ browser }) => {
  const ctx = await signedIn(browser, "c");
  const page = await ctx.newPage();
  await openPost(page, loadState().postPublic);
  await page.getByRole("article").first().getByRole("button", { name: "Post actions" }).click();
  await page.getByRole("menuitem", { name: "Report post" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await snapshot(page, "report-dialog");
  await dialog.getByRole("combobox").first().selectOption({ index: 1 }).catch(async () => {
    await dialog.getByRole("radio").first().check();
  });
  await dialog.getByRole("button", { name: /^(Report|Send|Send report)$/ }).click();
  await expect(page.getByText("Thank you for telling us")).toBeVisible(SLOW);
  await ctx.close();
});

test("private account: b asks to follow c, c accepts", async ({ browser }) => {
  const { b, c } = users();
  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await cpage.goto("/settings/privacy");
  const priv = cpage.getByRole("checkbox", { name: /Private account/ }).or(cpage.getByRole("switch", { name: /Private account/ }));
  await expect(priv.first()).toBeVisible(SLOW);
  if (!(await priv.first().isChecked())) await priv.first().click();
  await expect(priv.first()).toBeChecked(SLOW);

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto(`/u/${c.username}`);
  const request = bpage.getByRole("button", { name: /^(Request to follow|Requested|Following)$/ });
  await expect(request).toBeVisible(SLOW);
  if ((await request.textContent())?.trim() === "Request to follow") await request.click();
  await expect(bpage.getByRole("button", { name: /^(Requested|Following)$/ })).toBeVisible(SLOW);

  await cpage.goto("/requests");
  const row = cpage.getByRole("listitem").filter({ hasText: b.username }).first();
  await expect(row).toBeVisible(SLOW);
  const accepted = cpage.waitForResponse((r) => r.url().includes("/accept") && r.request().method() === "POST", SLOW);
  await row.getByRole("button", { name: "Accept" }).click();
  expect((await accepted).status()).toBe(200);
  await bpage.goto(`/u/${c.username}`);
  await expect(bpage.getByRole("button", { name: "Following" })).toBeVisible(SLOW);
  await Promise.all([cctx.close(), bctx.close()]);
});

test("mute hides a's posts from b's feed; unmute brings them back", async ({ browser }) => {
  const { a } = users();
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  // Start from "not muted" (an earlier run may have stopped half way).
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible(SLOW);
  if (await page.getByText("Muted", { exact: true }).isVisible()) await chooseFromMenu(page, "More actions", "Unmute");
  await expect(page.getByText("Muted", { exact: true })).toHaveCount(0, SLOW);
  await page.goto("/feed");
  await expect(page.getByText(/QA (Public|Followers) post/).first()).toBeVisible(SLOW);
  await page.goto(`/u/${a.username}`);
  await chooseFromMenu(page, "More actions", "Mute");
  await expect(page.getByText("Muted", { exact: true })).toBeVisible(SLOW);
  await page.goto("/feed");
  await page_wait(page);
  expect(await page.getByText(/QA (Public|Followers) post/).count(), "muted posts in feed").toBe(0);
  await page.goto(`/u/${a.username}`);
  await chooseFromMenu(page, "More actions", "Unmute");
  await expect(page.getByText("Muted", { exact: true })).toHaveCount(0, SLOW);
  await ctx.close();
});

test("block: c blocks b, b can no longer open c's profile; unblock", async ({ browser }) => {
  const { b, c } = users();
  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await cpage.goto(`/u/${b.username}`);
  await chooseFromMenu(cpage, "More actions", "Block");
  await cpage.getByRole("dialog").getByRole("button", { name: "Block" }).click();
  await expect(cpage.getByRole("button", { name: "Unblock" })).toBeVisible(SLOW);

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto(`/u/${c.username}`);
  await page_wait(bpage);
  await snapshot(bpage, "blocked-profile-seen-by-b");
  expect(await bpage.getByRole("button", { name: /^(Follow|Request to follow|Following|Requested)$/ }).count(), "b must not be able to follow c").toBe(0);

  await cpage.goto("/settings/privacy");
  await snapshot(cpage, "privacy-with-blocked");
  await cpage.goto(`/u/${b.username}`);
  await cpage.getByRole("button", { name: "Unblock" }).click();
  await expect(cpage.getByRole("button", { name: /^(Follow|Request to follow)$/ })).toBeVisible(SLOW);
  await Promise.all([cctx.close(), bctx.close()]);
});

test("explore and search find the public post and the people", async ({ browser }) => {
  const { a } = users();
  const ctx = await signedIn(browser, "b");
  const page = await ctx.newPage();
  await page.goto("/explore");
  await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible(SLOW);
  await snapshot(page, "explore");
  const search = page.getByRole("searchbox").or(page.getByRole("textbox", { name: /Search/ })).first();
  await search.fill(a.username);
  await search.press("Enter");
  await expect(page.getByText(`@${a.username}`).first()).toBeVisible(SLOW);
  await search.fill("lehenga");
  await search.press("Enter");
  const state = loadState();
  await expect(page.locator(`main a[href="/p/${state.postPublic}"]`).first()).toBeVisible(SLOW);
  const hrefs = await page.locator('main a[href^="/p/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  for (const hidden of [state.postCloseFriends, state.postPrivate, state.postFollowers]) {
    expect(hrefs, "search must not show non-public posts").not.toContain(`/p/${hidden}`);
  }
  await ctx.close();
});
