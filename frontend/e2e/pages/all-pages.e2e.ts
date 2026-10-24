import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadState, note, RESULTS_DIR, signedIn, users, watchPage, type QaName } from "../support/qa";

// Every page, on desktop and on a phone-sized screen: how long until the page shows its content, whether it
// is still "Loading…", whether it scrolls sideways, whether it crashes, and what the empty states look like.

function routes(): string[] {
  const s = loadState();
  const { a } = users();
  const p = s.project;
  return [
    "/", "/feed", "/explore", "/messages", `/messages/${s.chatAB}`, "/notifications", "/designs", "/saved",
    `/u/${a.username}`, `/u/${a.username}/followers`, `/u/${a.username}/following`, `/p/${s.postPublic}`, `/p/${s.postPublic}/edit`,
    "/profile/edit", "/close-friends", "/requests", "/resources", "/welcome",
    "/settings", "/settings/account", "/settings/privacy", "/settings/activity", "/settings/language", "/settings/notifications",
    "/settings/theme", "/settings/verification", "/settings/ai-providers", "/help", "/admin",
    `/projects/${p}`, `/projects/${p}/studio`, `/projects/${p}/fabric`, `/projects/${p}/tailor`, `/projects/${p}/cost`, `/projects/${p}/publish`,
    "/legal/terms", "/legal/privacy", "/legal/guidelines", "/this-page-does-not-exist",
  ];
}

const LOADING = /Loading|Preparing|Opening/;

async function measure(page: Page, route: string, who: string, project: string) {
  const t0 = Date.now();
  await page.goto(route);
  const content = page.getByRole("main").getByRole("heading").first();
  const shown = await content.waitFor({ timeout: 30_000 }).then(() => true, () => false);
  const ms = Date.now() - t0;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  const stillLoading = await page.getByRole("main").getByText(LOADING).first().isVisible().catch(() => false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const crashed = await page.getByText("This page couldn’t load").count();
  const slug = route.replace(/[0-9a-f-]{36}/g, "id").replace(/[^a-z0-9]+/gi, "_") || "root";
  const dir = path.join(RESULTS_DIR, "pages", project);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${who}-${slug}.png`), fullPage: true }).catch(() => {});
  note({ kind: "timing", who: `${who}/${project}`, url: route, detail: `content after ${ms} ms${shown ? "" : " (no heading in 30 s)"}` });
  if (!shown || ms > 5000) note({ kind: "slow", who: `${who}/${project}`, url: route, detail: shown ? `content after ${ms} ms` : "no content after 30 s" });
  if (stillLoading) note({ kind: "bug", who: `${who}/${project}`, url: route, detail: "Still shows a loading message after the page settled" });
  if (overflow > 1) note({ kind: "bug", who: `${who}/${project}`, url: route, detail: `Page scrolls sideways by ${overflow}px` });
  if (crashed) note({ kind: "bug", who: `${who}/${project}`, url: route, detail: "Page crashed" });
  return { shown, overflow, crashed };
}

test("every page as a (lots of data)", async ({ browser }, info) => {
  test.setTimeout(1_200_000);
  const ctx = await signedIn(browser, "a", info.project.use);
  const page = await ctx.newPage();
  for (const route of routes()) {
    const r = await measure(page, route, "a", info.project.name);
    expect.soft(r.crashed, `${route} crashed`).toBe(0);
    expect.soft(r.overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});

test("empty states as c (little data)", async ({ browser }, info) => {
  test.setTimeout(600_000);
  const ctx = await signedIn(browser, "c", info.project.use);
  const page = await ctx.newPage();
  for (const route of ["/designs", "/saved", "/feed", "/close-friends", "/requests", "/settings/activity", "/resources", `/u/${users().c.username}`]) {
    await measure(page, route, "c", info.project.name);
    const text = ((await page.getByRole("main").textContent()) ?? "").trim();
    if (text.length < 40) note({ kind: "bug", who: `c/${info.project.name}`, url: route, detail: "Empty page with almost no text (no empty state)" });
  }
  await ctx.close();
});

test("signed out: private pages ask to sign in; legal pages open", async ({ browser }, info) => {
  const ctx = await browser.newContext(info.project.use);
  const page = await ctx.newPage();
  watchPage(page, "visitor");
  for (const route of ["/feed", "/designs", `/u/${users().a.username}`, `/p/${loadState().postPublic}`, "/settings"]) {
    await page.goto(route);
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
  }
  for (const route of ["/legal/terms", "/legal/privacy", "/legal/guidelines", "/forgot-password"]) {
    await page.goto(route);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.getByLabel("Password").count(), `${route} should open without signing in`).toBe(0);
  }
  await ctx.close();
});

test("phone: the menu can be opened and leads to every main section", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "phone only");
  const ctx = await signedIn(browser, "a", info.project.use);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("main").getByRole("heading").first().waitFor({ timeout: 30_000 });
  const nav = page.getByRole("navigation", { name: "Main" });
  let visible = await nav.isVisible();
  if (!visible) {
    const opener = page.getByRole("button", { name: /menu/i }).first();
    await expect(opener, "a menu button on phones").toBeVisible();
    await opener.click();
    visible = await nav.isVisible();
  }
  expect(visible, "main menu reachable on a phone").toBe(true);
  for (const name of ["Home Feed", "Explore", "Messages", "Notifications", "Settings"]) {
    await expect(page.getByRole("link", { name }).first()).toBeAttached();
  }
  await ctx.close();
});

const RISKY = /delete|remove|block|report|deactivate|sign out|unsend|archive|unfollow|mark all|^send|publish|clear|reset|leave|decline|accept|follow|request|like|save|repost|share|upload|import|download|export|duplicate|regenerate|generate|lift|suspend|warn|dismiss|approve|reject|skip|change|cancel/i;

test("dead buttons: safe buttons do something when pressed", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  test.setTimeout(900_000);
  const who: QaName = "a";
  const ctx = await signedIn(browser, who);
  const page = await ctx.newPage();
  for (const route of ["/", "/explore", "/settings", "/settings/theme", "/messages", "/notifications", "/resources", "/designs", `/u/${users().a.username}`, "/help", `/projects/${loadState().project}`]) {
    await page.goto(route);
    await page.getByRole("main").getByRole("heading").first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const names = await page.getByRole("main").getByRole("button").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled)
        .map((e) => e.getAttribute("aria-label") || (e.textContent ?? "").trim()).filter(Boolean));
    for (const name of [...new Set(names)].slice(0, 25)) {
      if (RISKY.test(name)) continue;
      if (page.url().replace(/^https?:\/\/[^/]+/, "") !== route) await page.goto(route);
      const button = page.getByRole("main").getByRole("button", { name, exact: true }).first();
      if (!(await button.isVisible().catch(() => false))) continue;
      const before = await page.evaluate(() => document.body.innerHTML.length + "|" + location.href);
      let requests = 0;
      const onRequest = () => requests++;
      page.on("request", onRequest);
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      page.off("request", onRequest);
      const after = await page.evaluate(() => document.body.innerHTML.length + "|" + location.href);
      const dialog = await page.getByRole("dialog").isVisible().catch(() => false);
      if (before === after && requests === 0 && !dialog) note({ kind: "dead-button", who, url: route, detail: `"${name}" did nothing visible` });
      if (dialog) await page.keyboard.press("Escape");
    }
  }
  await ctx.close();
});
