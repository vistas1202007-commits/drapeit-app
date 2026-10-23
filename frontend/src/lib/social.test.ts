import { describe, expect, it } from "vitest";
import { activeFilterCount, cleanUsername, countLabel, followLabel, hashtag, initials, NO_FILTERS, postLink, REPORT_REASONS, tagList, usernameProblem, VISIBILITY_LABEL } from "./social";

describe("social helpers", () => {
  it("cleans and checks usernames like the server does", () => {
    expect(cleanUsername("  @Vistas.Atelier ")).toBe("vistas.atelier");
    expect(usernameProblem("ab")).toContain("at least 3");
    expect(usernameProblem("has space")).toContain("lowercase letters");
    expect(usernameProblem("@Meera_B")).toBeNull();
    expect(usernameProblem("x".repeat(31))).toContain("at most 30");
  });

  it("labels counts, tags, initials and visibility", () => {
    expect(countLabel(1, "like")).toBe("1 like");
    expect(countLabel(3, "save")).toBe("3 saves");
    expect(tagList({ garment: "Anarkali", fabric: " ", occasion: "Wedding" })).toEqual(["Anarkali", "Wedding"]);
    expect(initials("Vistas Atelier")).toBe("VA");
    expect(initials("meera_b")).toBe("MB");
    expect(VISIBILITY_LABEL.close_friends).toBe("Close Friends");
  });

  it("labels the follow button for public and private accounts", () => {
    expect(followLabel("none", false)).toBe("Follow");
    expect(followLabel("none", true)).toBe("Request to follow");
    expect(followLabel("requested", true)).toBe("Requested");
    expect(followLabel("following", true)).toBe("Following");
  });

  it("builds post links, hashtags and counts filters", () => {
    expect(postLink("https://croquis.app/", "abc")).toBe("https://croquis.app/p/abc");
    expect(hashtag("Winter Wedding")).toBe("#winterwedding");
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, colour: "Wine", fabric: " " })).toBe(1);
    expect(new Set(REPORT_REASONS.map((r) => r.id)).size).toBe(REPORT_REASONS.length);
  });
});
