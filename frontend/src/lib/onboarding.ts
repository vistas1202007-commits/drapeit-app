// The welcome steps and the interest choices (Phase 6E), kept free of React so they can be tested.

import { GARMENT_CATEGORIES } from "./format";
import type { Interests, OnboardingStep } from "./types";

/** The steps in order ("done" is not a step people see). */
export const ONBOARDING_STEPS: Exclude<OnboardingStep, "done">[] = ["profile", "avatar", "interests", "follow", "tour"];

export const INTEREST_CHOICES: Record<keyof Interests, string[]> = {
  garments: GARMENT_CATEGORIES.filter((g) => g !== "Other").slice(0, 16),
  fabrics: ["Cotton", "Silk", "Velvet", "Georgette", "Chiffon", "Linen", "Crepe", "Organza", "Net", "Satin", "Chanderi", "Khadi"],
  styles: ["Bridal", "Festive", "Everyday", "Indo-western", "Minimal", "Traditional", "Handloom", "Embroidery", "Office wear", "Kids"],
};

/** The step after (or before) this one. */
export function nextStep(step: OnboardingStep, direction: 1 | -1 = 1): OnboardingStep {
  if (step === "done") return "done";
  const i = ONBOARDING_STEPS.indexOf(step) + direction;
  if (i < 0) return ONBOARDING_STEPS[0];
  return i >= ONBOARDING_STEPS.length ? "done" : ONBOARDING_STEPS[i];
}

/** Add or remove one choice. */
export function toggleChoice(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
