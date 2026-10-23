import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { INTEREST_CHOICES, nextStep, ONBOARDING_STEPS, toggleChoice } from "./onboarding";

describe("onboarding", () => {
  it("walks the steps in order and ends with done", () => {
    expect(ONBOARDING_STEPS).toEqual(["profile", "avatar", "interests", "follow", "tour"]);
    expect(nextStep("profile")).toBe("avatar");
    expect(nextStep("tour")).toBe("done");
    expect(nextStep("avatar", -1)).toBe("profile");
    expect(nextStep("profile", -1)).toBe("profile");
    expect(nextStep("done")).toBe("done");
  });

  it("toggles interest choices", () => {
    expect(toggleChoice(["Silk"], "Velvet")).toEqual(["Silk", "Velvet"]);
    expect(toggleChoice(["Silk", "Velvet"], "Silk")).toEqual(["Velvet"]);
    expect(INTEREST_CHOICES.garments.length).toBeGreaterThan(5);
  });

  it("has Hindi and Hinglish for the new text", () => {
    expect(translate("hi", "onboarding.skip")).toBe("अभी छोड़ें");
    expect(translate("hinglish", "banner.understand")).toBe("Samajh gaya/gayi");
    expect(translate("hi", "nav.admin")).toBe("एडमिन");
  });
});
