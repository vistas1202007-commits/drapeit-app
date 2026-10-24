import { expect, test, type Page } from "@playwright/test";
import { loadState, note, saveState, signedIn, snapshot, users } from "../support/qa";

test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };

async function send(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await expect(box).toBeVisible(SLOW);
  await box.fill(text);
  const sent = page.waitForResponse((r) => /\/chats\/[^/]+\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", SLOW);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByRole("main").getByText(text).first()).toBeVisible(SLOW);
}

test("a and b chat: send, unread badge, reply, new message without reload", async ({ browser }) => {
  const { a, b } = users();
  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto(`/u/${b.username}`);
  await apage.getByRole("button", { name: "Message" }).click();
  await apage.waitForURL(/\/messages\/[0-9a-f-]{36}/, SLOW);
  saveState({ chatAB: apage.url().match(/messages\/([0-9a-f-]{36})/)![1] });
  await send(apage, "Hi B, can you stitch this lehenga by December?");

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto("/messages");
  const row = bpage.getByRole("main").getByRole("link", { name: new RegExp(a.username.replace(/_/g, "_") + "|QA A Atelier") }).first();
  await expect(row).toBeVisible(SLOW);
  await snapshot(bpage, "inbox-b");
  await row.click();
  await expect(bpage.getByRole("main").getByRole("listitem").getByText("can you stitch this lehenga").first()).toBeVisible(SLOW);
  await send(bpage, "Yes, send me the measurements.");

  // a's open chat should show the reply without reloading (Supabase Realtime, or polling).
  const arrived = await apage.getByRole("main").getByRole("listitem").getByText("send me the measurements").first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  if (!arrived) note({ kind: "bug", who: "a", url: apage.url(), detail: "New chat message did not appear within 20 s without reloading" });
  await apage.reload();
  await expect(apage.getByRole("main").getByRole("listitem").getByText("send me the measurements").first()).toBeVisible(SLOW);
  // a has now read b's reply, so b sees "Seen" under it.
  await apage.waitForLoadState("networkidle").catch(() => {});
  await bpage.reload();
  await expect(bpage.getByText(/Seen$/).first()).toBeVisible(SLOW);
  await Promise.all([actx.close(), bctx.close()]);
});

test("unsend removes a message for both people", async ({ browser }) => {
  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto(`/messages/${loadState().chatAB}`);
  await send(apage, "Oops, wrong chat");
  const bubble = apage.getByRole("main").getByRole("listitem").filter({ hasText: "Oops, wrong chat" }).last();
  await bubble.hover();
  await snapshot(apage, "chat-message-actions");
  const actions = bubble.getByRole("button", { name: /Message actions|More|Unsend/ }).first();
  await actions.click();
  const unsend = apage.getByRole("menuitem", { name: /Unsend/ }).or(apage.getByRole("button", { name: /Unsend/ })).first();
  await unsend.click();
  const confirm = apage.getByRole("dialog").getByRole("button", { name: /Unsend/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(apage.getByRole("main").getByText("Oops, wrong chat")).toHaveCount(0, SLOW);

  const bctx = await signedIn(browser, "b");
  const bpage = await bctx.newPage();
  await bpage.goto(`/messages/${loadState().chatAB}`);
  await expect(bpage.getByRole("main").getByRole("listitem").getByText("can you stitch this lehenga").first()).toBeVisible(SLOW);
  expect(await bpage.getByRole("main").getByText("Oops, wrong chat").count()).toBe(0);
  await Promise.all([actx.close(), bctx.close()]);
});

test("send a post into a chat", async ({ browser }) => {
  const { b } = users();
  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto(`/p/${loadState().postPublic}`);
  await apage.getByRole("article").first().getByRole("button", { name: "Send" }).click();
  const dialog = apage.getByRole("dialog");
  await expect(dialog).toBeVisible(SLOW);
  await snapshot(apage, "send-post-dialog");
  const search = dialog.getByRole("textbox").first();
  if (await search.isVisible()) await search.fill(b.username);
  await dialog.getByText(new RegExp(b.username)).first().click();
  await dialog.getByRole("button", { name: /^Send/ }).last().click();
  await expect(apage.getByText(/Sent|sent/).first()).toBeVisible(SLOW);
  await apage.goto(`/messages/${loadState().chatAB}`);
  await expect(apage.getByRole("main").getByText(/QA Public post/).first()).toBeVisible(SLOW);
  await actx.close();
});

test("a message from someone a does not follow arrives as a request", async ({ browser }) => {
  const { a, c } = users();
  const cctx = await signedIn(browser, "c");
  const cpage = await cctx.newPage();
  await cpage.goto(`/u/${a.username}`);
  await cpage.getByRole("button", { name: "Message" }).click();
  await cpage.waitForURL(/\/messages\/[0-9a-f-]{36}/, SLOW);
  await send(cpage, "Hello from C, love your work");

  const actx = await signedIn(browser, "a");
  const apage = await actx.newPage();
  await apage.goto("/messages");
  await apage.getByRole("tab", { name: /Requests/ }).click();
  const req = apage.getByRole("main").getByRole("link", { name: new RegExp(`QA C Studio|${c.username}`) }).first();
  await expect(req).toBeVisible(SLOW);
  await req.click();
  await expect(apage.getByRole("main").getByRole("listitem").getByText("Hello from C").first()).toBeVisible(SLOW);
  await snapshot(apage, "chat-request-a");
  await apage.getByRole("button", { name: /^Accept/ }).click();
  await expect(apage.getByRole("textbox", { name: "Message" })).toBeEnabled(SLOW);
  await Promise.all([cctx.close(), actx.close()]);
});

test("notifications: list, open, mark all as read, settings", async ({ browser }) => {
  const actx = await signedIn(browser, "a");
  const page = await actx.newPage();
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible(SLOW);
  const items = page.getByRole("main").getByRole("listitem");
  await expect(items.first()).toBeVisible(SLOW);
  for (const kind of [/started following you/, /liked your post/, /commented on your post/]) {
    if (!(await page.getByRole("main").getByText(kind).count())) note({ kind: "bug", who: "a", url: page.url(), detail: `No notification matching ${kind}` });
  }
  const markAll = page.getByRole("button", { name: "Mark all as read" });
  if (await markAll.isVisible()) {
    await markAll.click();
    await expect(page.getByText(/\(new\)/)).toHaveCount(0, SLOW);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible(SLOW);
  await page.waitForTimeout(2000);
  expect(await page.getByText(/^\d+ new$/).count(), "still says new after mark all as read + reload").toBe(0);

  await page.getByRole("link", { name: "Notification settings" }).click();
  await page.waitForURL(/\/settings\/notifications/, SLOW);
  const toggles = page.getByRole("main").getByRole("checkbox").or(page.getByRole("main").getByRole("switch"));
  await expect(toggles.first()).toBeVisible(SLOW);
  const first = toggles.first();
  const before = await first.isChecked();
  await first.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.reload();
  await expect(toggles.first()).toBeVisible(SLOW);
  expect(await toggles.first().isChecked(), "notification setting is remembered").toBe(!before);
  await toggles.first().click();
  await actx.close();
});
