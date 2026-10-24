import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { Browser, BrowserContext, Page } from "@playwright/test";

// Shared helpers for the browser tests: the throw-away QA accounts, signed-in browser contexts,
// and a log of everything worth reporting (console errors, failed requests, slow pages).

export const FRONTEND = path.resolve(__dirname, "..", "..");
export const BACKEND = path.resolve(FRONTEND, "..", "backend");
export const AUTH_DIR = path.join(FRONTEND, "e2e", ".auth");
export const RESULTS_DIR = path.join(FRONTEND, "e2e", ".results");
export const USERS_FILE = path.join(AUTH_DIR, "users.json");
export const API = process.env.E2E_API_URL ?? "http://localhost:8000";

export type QaName = "a" | "b" | "c";
export type QaUser = { name: QaName; email: string; password: string; id: string; username: string };

export function users(): Record<QaName, QaUser> {
  const data = JSON.parse(readFileSync(USERS_FILE, "utf-8")) as { users: QaUser[] };
  return Object.fromEntries(data.users.map((u) => [u.name, u])) as Record<QaName, QaUser>;
}

export function runQaScript(...args: string[]): string {
  const python = path.join(BACKEND, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return execFileSync(python, ["scripts/qa_users.py", ...args], { cwd: BACKEND, encoding: "utf-8" });
}

export function stateFile(name: QaName): string {
  return path.join(AUTH_DIR, `${name}.json`);
}

/** A browser context signed in as one QA account, with the findings log attached to every page. */
export async function signedIn(browser: Browser, name: QaName, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext({ ...options, storageState: stateFile(name) });
  watch(context, name);
  return context;
}

// ---------- findings log ----------

export type Finding = { kind: string; who: string; url: string; detail: string };

export function note(finding: Finding): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  appendFileSync(path.join(RESULTS_DIR, "findings.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...finding }) + "\n");
}

const IGNORED_CONSOLE = [/Download the React DevTools/i];

/** Record console errors, page crashes and failed API calls for every page in this context. */
export function watch(context: BrowserContext, who: string): void {
  context.on("page", (page) => watchPage(page, who));
  for (const page of context.pages()) watchPage(page, who);
}

const watched = new WeakSet<Page>();

export function watchPage(page: Page, who: string): void {
  if (watched.has(page)) return;
  watched.add(page);
  page.on("console", (msg) => {
    if (msg.type() !== "error" || IGNORED_CONSOLE.some((r) => r.test(msg.text()))) return;
    note({ kind: "console-error", who, url: page.url(), detail: msg.text().slice(0, 500) });
  });
  page.on("pageerror", (err) => note({ kind: "page-crash", who, url: page.url(), detail: String(err).slice(0, 500) }));
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && (url.startsWith(API) || url.includes("supabase.co"))) {
      const kind = res.status() >= 500 ? "server-error" : "client-error";
      note({ kind, who, url: page.url(), detail: `${res.status()} ${res.request().method()} ${url}` });
    }
  });
}

export function hasUsers(): boolean {
  return existsSync(USERS_FILE);
}

/** The signed-in person's Supabase access token, read from the page (for direct API checks). */
export async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const value = JSON.parse(localStorage.getItem(key) ?? "{}");
        return value.access_token ?? value?.currentSession?.access_token ?? "";
      }
    }
    return "";
  });
}

// ---------- small shared state between test files (ids of things made earlier) ----------

const STATE_FILE = path.join(AUTH_DIR, "state.json");

export function loadState(): Record<string, string> {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : {};
}

export function saveState(values: Record<string, string>): void {
  writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...values }, null, 1));
}

// ---------- a real PNG picture for upload tests ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A size x size PNG with a diagonal two-colour pattern. */
export function makePng(size = 96, a: [number, number, number] = [122, 30, 58], b: [number, number, number] = [214, 180, 110]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row.set(x + y < size ? a : b, 1 + x * 3);
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Save the page's accessibility snapshot (roles and names) for reading later. */
export async function snapshot(page: Page, name: string): Promise<void> {
  const dir = path.join(RESULTS_DIR, "snapshots");
  mkdirSync(dir, { recursive: true });
  const snap = await page.locator("main").first().ariaSnapshot().catch((e) => String(e));
  writeFileSync(path.join(dir, `${name}.txt`), `URL ${page.url()}\n\n${snap}\n`);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => {});
}

/** Open a project page and wait until the project itself is shown (its title is the page's h1). */
export async function openProject(page: Page, projectId: string, sub = ""): Promise<void> {
  await page.goto(`/projects/${projectId}${sub}`);
  await page.getByRole("main").getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
}

/** Open a "⋯" menu and choose an item. If something on the page covers the item, that is noted as a bug
 * and the item is clicked directly so the rest of the test can go on. */
export async function chooseFromMenu(page: Page, menuButton: string, item: string, scope = page.locator("body")): Promise<void> {
  await scope.getByRole("button", { name: menuButton }).first().click();
  const entry = page.getByRole("menuitem", { name: item, exact: true });
  try {
    await entry.click({ timeout: 4000 });
  } catch {
    note({ kind: "bug", who: "-", url: page.url(), detail: `Menu item "${item}" in "${menuButton}" is covered by the page and cannot be clicked` });
    await entry.dispatchEvent("click");
  }
}
