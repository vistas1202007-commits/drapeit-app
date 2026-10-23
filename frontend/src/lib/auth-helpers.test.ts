import { describe, expect, it } from "vitest";
import { api, setMediaToken, statusMessage } from "./api";
import { authRedirectUrl, friendlyAuthError, passwordProblem } from "./supabase";

describe("sign-in and error helpers", () => {
  it("adds the media token to picture addresses", () => {
    setMediaToken("user.123.sig/+");
    expect(api.assetUrl("abc")).toMatch(/\/api\/assets\/abc\?mt=user\.123\.sig%2F%2B$/);
    setMediaToken("");
  });

  it("explains HTTP errors in plain words", () => {
    expect(statusMessage(401)).toBe("Please sign in again.");
    expect(statusMessage(429)).toContain("wait a minute");
    expect(statusMessage(503)).toContain("restarting");
    expect(statusMessage(500)).toContain("Something went wrong");
    expect(statusMessage(422)).toContain("check what you entered");
  });

  it("turns Supabase sign-in errors into plain words", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe("Wrong email or password.");
    expect(friendlyAuthError("Email not confirmed")).toContain("confirm your email");
    expect(friendlyAuthError("User already registered")).toContain("already exists");
    expect(friendlyAuthError("Something new")).toBe("Something new");
    expect(friendlyAuthError("New password should be different from the old password.")).toContain("not used");
    expect(friendlyAuthError("Auth session missing!")).toContain("expired");
    expect(friendlyAuthError("Email link is invalid or has expired")).toContain("ask for a new one");
  });

  it("checks a new password and its confirmation", () => {
    expect(passwordProblem("short")).toContain("at least 8");
    expect(passwordProblem("long enough 1", "long enough 2")).toBe("The two passwords do not match.");
    expect(passwordProblem("long enough 1", "long enough 1")).toBeNull();
    expect(passwordProblem("long enough 1")).toBeNull();
  });

  it("builds the reset link address on this website", () => {
    expect(authRedirectUrl("/reset-password", "http://localhost:3000")).toBe("http://localhost:3000/reset-password");
  });
});
