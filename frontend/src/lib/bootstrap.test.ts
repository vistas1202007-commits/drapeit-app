import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, resetBootstrap } from "./api";

const BOOT = {
  media_token: { token: "mt", expires_at: "2026-10-24T13:00:00.000Z" },
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
    const [token, account, onboarding, appearance, badges, profile] = await Promise.all([
      api.mediaToken(), api.account(), api.onboarding(), api.appearance(), api.badges(), api.myProfile(),
    ]);
    expect(calls).toEqual(["/api/me/bootstrap"]);
    expect(token.token).toBe("mt");
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
