import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { accessToken, API, FRONTEND, loadState, makePng, note, signedIn, users } from "../support/qa";

// Can one person see or change another person's private data? Everything here goes straight to the
// backend API or to Supabase, the way an attacker would, not through the buttons.

test.describe.configure({ mode: "serial" });

function publicEnv(): { url: string; key: string } {
  const text = readFileSync(path.join(FRONTEND, ".env.local"), "utf-8");
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim() ?? "";
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || get("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

async function tokenFor(page: Page): Promise<string> {
  await page.goto("/legal/terms");
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});
  return accessToken(page);
}

function as(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (p: string) => request.get(`${API}${p}`, { headers }),
    post: (p: string, data?: unknown) => request.post(`${API}${p}`, { headers, data }),
    patch: (p: string, data?: unknown) => request.patch(`${API}${p}`, { headers, data }),
    put: (p: string, data?: unknown) => request.put(`${API}${p}`, { headers, data }),
    del: (p: string) => request.delete(`${API}${p}`, { headers }),
  };
}

let tokens: Record<"a" | "b" | "c", string>;

test("get fresh tokens for a, b and c", async ({ browser }) => {
  tokens = {} as typeof tokens;
  for (const who of ["a", "b", "c"] as const) {
    const ctx = await signedIn(browser, who);
    tokens[who] = await tokenFor(await ctx.newPage());
    await ctx.close();
    expect(tokens[who].length, `token for ${who}`).toBeGreaterThan(20);
  }
});

test("b cannot read, change, export, generate on or delete a's design", async ({ request }) => {
  const { project } = loadState();
  const a = as(request, tokens.a);
  const b = as(request, tokens.b);
  const mine = await a.get(`/api/projects/${project}`);
  expect(mine.status()).toBe(200);
  const assetId: string | undefined = (await mine.json()).assets?.[0]?.id;

  for (const [what, res] of [
    ["read", await b.get(`/api/projects/${project}`)],
    ["rename", await b.patch(`/api/projects/${project}`, { title: "hacked" })],
    ["export", await b.get(`/api/projects/${project}/export`)],
    ["generate", await b.post(`/api/projects/${project}/generate/design`, {})],
    ["canvas", await b.get(`/api/projects/${project}/canvas`)],
    ["publish options", await b.get(`/api/projects/${project}/publish-options`)],
    ["delete", await b.del(`/api/projects/${project}`)],
  ] as const) {
    expect([403, 404], `b ${what} a's project`).toContain(res.status());
  }
  if (assetId) expect([403, 404], "b reads a's picture").toContain((await b.get(`/api/assets/${assetId}`)).status());
  expect((await b.get("/api/projects")).status()).toBe(200);
  expect(JSON.stringify(await (await b.get("/api/projects")).json())).not.toContain(project);
  expect((await a.get(`/api/projects/${project}`)).status(), "a's project still there").toBe(200);
});

test("b cannot see or act on a's private and close-friends posts", async ({ request }) => {
  const s = loadState();
  const b = as(request, tokens.b);
  for (const id of [s.postPrivate, s.postCloseFriends]) {
    expect((await b.get(`/api/posts/${id}`)).status()).toBe(404);
    expect([403, 404]).toContain((await b.post(`/api/posts/${id}/like`)).status());
    expect([403, 404]).toContain((await b.post(`/api/posts/${id}/comments`, { body: "sneaky" })).status());
    expect([403, 404]).toContain((await b.get(`/api/posts/${id}/comments`)).status());
    expect([403, 404]).toContain((await b.patch(`/api/posts/${id}`, { caption: "hacked" })).status());
    expect([403, 404]).toContain((await b.del(`/api/posts/${id}`)).status());
  }
  const feed = JSON.stringify(await (await b.get("/api/feed")).json());
  expect(feed).not.toContain(s.postPrivate);
  expect(feed).not.toContain(s.postCloseFriends);
  const profilePosts = JSON.stringify(await (await b.get(`/api/profiles/${users().a.username}/posts`)).json());
  expect(profilePosts).not.toContain(s.postPrivate);
});

test("b cannot read or write the chat between a and c", async ({ request }) => {
  const a = as(request, tokens.a);
  const b = as(request, tokens.b);
  const chats = (await (await a.get("/api/chats")).json()) as { chats?: { id: string; other?: { username?: string } }[] };
  const list = chats.chats ?? (chats as unknown as { id: string; other?: { username?: string } }[]);
  const withC = (Array.isArray(list) ? list : []).find((ch) => JSON.stringify(ch).includes(users().c.username));
  test.skip(!withC, "no a-c chat found");
  const id = withC!.id;
  expect([403, 404]).toContain((await b.get(`/api/chats/${id}`)).status());
  expect([403, 404]).toContain((await b.get(`/api/chats/${id}/messages`)).status());
  expect([403, 404]).toContain((await b.post(`/api/chats/${id}/messages`, { body: "hi" })).status());
  expect([403, 404]).toContain((await b.post(`/api/chats/${id}/read`)).status());
  expect([403, 404]).toContain((await b.del(`/api/chats/${id}`)).status());
});

test("no sign-in means no data", async ({ request }) => {
  for (const p of ["/api/projects", "/api/feed", "/api/me/profile", "/api/chats", "/api/notifications", "/api/me/export"]) {
    expect([401, 403], `no token: ${p}`).toContain((await request.get(`${API}${p}`)).status());
  }
  const bad = await request.get(`${API}/api/projects`, { headers: { Authorization: "Bearer not-a-real-token" } });
  expect(bad.status()).toBe(401);
});

test("Supabase directly: the browser key cannot read app tables or private pictures", async ({ request }) => {
  const { url, key } = publicEnv();
  test.skip(!url || !key, "no Supabase settings in .env.local");
  for (const token of [key, tokens.b]) {
    for (const table of ["projects", "posts", "messages", "profiles", "assets", "admin_users", "premium_members", "reports"]) {
      const res = await request.get(`${url}/rest/v1/${table}?select=*&limit=5`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      const body = await res.text();
      const leaked = res.status() === 200 && body.trim() !== "[]";
      if (leaked) note({ kind: "security", who: token === key ? "anonymous" : "b", url: `${url}/rest/v1/${table}`, detail: `Readable directly: ${body.slice(0, 120)}` });
      expect(leaked, `${table} readable directly with ${token === key ? "the public key" : "b's token"}`).toBe(false);
    }
  }
  // Storage: a's design pictures live under "<a's id>/..."
  const list = await request.post(`${url}/storage/v1/object/list/project-assets`, {
    headers: { apikey: key, Authorization: `Bearer ${tokens.b}` },
    data: { prefix: `${users().a.id}/`, limit: 10 },
  });
  const items = list.status() === 200 ? ((await list.json()) as unknown[]) : [];
  expect(items.length, "b can list a's files in Storage").toBe(0);
});

test("picture links: a's media token does not open b's pictures, and links need a token", async ({ request }) => {
  const a = as(request, tokens.a);
  const b = as(request, tokens.b);
  const aProject = loadState().project;
  const assetId: string | undefined = (await (await a.get(`/api/projects/${aProject}`)).json()).assets?.[0]?.id;
  test.skip(!assetId, "a has no pictures");
  const bToken = (await (await b.get("/api/media-token")).json()) as { token?: string; mt?: string };
  const mt = bToken.token ?? bToken.mt ?? "";
  const viaB = await request.get(`${API}/api/assets/${assetId}?mt=${encodeURIComponent(mt)}`);
  expect([401, 403, 404], "b's media token opens a's picture").toContain(viaB.status());
  const noToken = await request.get(`${API}/api/assets/${assetId}`);
  expect([401, 403, 404], "picture without any token").toContain(noToken.status());
});

test("uploads: SVG with script, wrong type and fake PNG are refused", async ({ request }) => {
  const b = as(request, tokens.b);
  void b;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const tries = [
    { name: "x.svg", mimeType: "image/svg+xml", buffer: svg },
    { name: "x.png", mimeType: "image/png", buffer: Buffer.from("GIF89a fake") },
    { name: "x.html", mimeType: "text/html", buffer: Buffer.from("<html></html>") },
  ];
  for (const file of tries) {
    const res = await request.post(`${API}/api/me/avatar`, { headers: { Authorization: `Bearer ${tokens.b}` }, multipart: { file } });
    expect(res.status(), `avatar upload ${file.name}`).toBeGreaterThanOrEqual(400);
  }
  const ok = await request.post(`${API}/api/me/avatar`, {
    headers: { Authorization: `Bearer ${tokens.b}` },
    multipart: { file: { name: "ok.png", mimeType: "image/png", buffer: makePng(64) } },
  });
  expect(ok.status()).toBe(200);
});

test("CORS: another website cannot call the API with the person's token", async ({ request }) => {
  const res = await request.get(`${API}/api/projects`, { headers: { Authorization: `Bearer ${tokens.b}`, Origin: "https://evil.example" } });
  const allow = res.headers()["access-control-allow-origin"];
  expect(allow === "*" || allow === "https://evil.example", `CORS allows ${allow}`).toBe(false);
});

test("security headers on the website", async ({ request }) => {
  const res = await request.get("/legal/terms");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  if (!h["content-security-policy"]) note({ kind: "security", who: "-", url: "/", detail: "No Content-Security-Policy header on the website" });
  if (!h["strict-transport-security"]) note({ kind: "security", who: "-", url: "/", detail: "No Strict-Transport-Security header (add it on the host, e.g. Vercel, for https)" });
});

test("rate limit: many likes in a burst are slowed down", async ({ request }) => {
  test.setTimeout(300_000);
  const b = as(request, tokens.b);
  const id = loadState().postPublic;
  // 40 calls at the same time (one at a time takes about 2 s each on this connection).
  const calls = Array.from({ length: 40 }, (_, i) => (i % 2 ? b.del(`/api/posts/${id}/like`) : b.post(`/api/posts/${id}/like`)));
  const statuses = (await Promise.all(calls)).map((r) => r.status());
  if (!statuses.includes(429)) note({ kind: "security", who: "b", url: `/api/posts/${id}/like`, detail: "40 like/unlike calls at once were never rate-limited" });
  await b.post(`/api/posts/${id}/like`);
});
