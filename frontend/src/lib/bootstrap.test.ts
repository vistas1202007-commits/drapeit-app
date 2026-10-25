import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, prefetchBootstrap, resetBootstrap } from "./api";

const BOOT = {
  profile: null,
  account: { email: "a@example.com", has_profile: false, deactivated: false, is_admin: false, warnings: [] },
  onboarding: { step: "profile", completed: false, is_new: true },
  appearance: { app_theme: "system", profile_theme: "default", custom_theme: null, is_premium: false },
  badges: { notifications: 2, chats: 1, requests: 0 },
};

let calls: string[];

beforeEach(() => {
  resetBootstrap();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = path === "/api/me/bootstrap" ? BOOT : { from: path };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("start-up summary", () => {
  it("answers the first call of every part with one request", async () => {
    const [account, onboarding, appearance, badges, profile] = await Promise.all([
      api.account(), api.onboarding(), api.appearance(), api.badges(), api.myProfile(),
    ]);
    expect(calls).toEqual(["/api/me/bootstrap"]);
    expect(account.email).toBe("a@example.com");
    expect(onboarding.is_new).toBe(true);
    expect(appearance.app_theme).toBe("system");
    expect(badges.notifications).toBe(2);
    expect(profile).toBeNull();
  });

  it("asks the part's own endpoint after the first time (fresh data after a change)", async () => {
    await api.account();
    await api.account();
    expect(calls).toEqual(["/api/me/bootstrap", "/api/me/account"]);
  });

  it("can start at sign-in, before any part asks, without a second request", async () => {
    prefetchBootstrap();
    await api.badges();
    await api.account();
    expect(calls).toEqual(["/api/me/bootstrap"]);
  });

  it("keeps the picture token on its own quick endpoint", async () => {
    await api.mediaToken();
    expect(calls).toEqual(["/api/media-token"]);
  });

  it("starts again after sign-in or sign-out", async () => {
    await api.badges();
    resetBootstrap();
    await api.badges();
    expect(calls).toEqual(["/api/me/bootstrap", "/api/me/bootstrap"]);
  });

  it("falls back to the part's own endpoint when the summary fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/api/me/bootstrap") return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ from: path }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    expect(await api.onboarding()).toEqual({ from: "/api/me/onboarding" });
    expect(calls).toEqual(["/api/me/bootstrap", "/api/me/onboarding"]);
  });
});
