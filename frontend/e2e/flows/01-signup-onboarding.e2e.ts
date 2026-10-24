import { expect, test, type Page } from "@playwright/test";
import { makePng, note, signedIn, users, watchPage, type QaName } from "../support/qa";

test.describe.configure({ mode: "serial" });

// Supabase allows only a few sign-ups per hour from one address, so this runs only with E2E_SIGNUP=1.
test("sign-up form checks the password and answers a new email", async ({ page }) => {
  test.skip(process.env.E2E_SIGNUP !== "1", "set E2E_SIGNUP=1 to try a real sign-up");
  watchPage(page, "visitor");
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(`qa-drapeit-signup-${Date.now()}@example.com`);
  await page.getByLabel(/^Password/).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  // The browser's own minLength check or the app's message must stop a short password.
  const blocked = await page.getByLabel(/^Password/).evaluate((el) => !(el as HTMLInputElement).validity.valid);
  expect(blocked).toBe(true);

  await page.getByLabel(/^Password/).fill("Qa-signup-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  const answer = page.getByText(/sent you an email|not authorized|invalid|error|limit|try again/i).first();
  await expect(answer).toBeVisible();
  const text = (await answer.textContent()) ?? "";
  if (!/sent you an email/i.test(text)) note({ kind: "signup-blocked", who: "visitor", url: page.url(), detail: text });
});

async function finishOnboarding(page: Page, name: QaName, withAvatar: boolean) {
  const user = users()[name];
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: "Welcome to Drapeit" })).toBeVisible();
  // Progress is saved, so it may open on a later step: go back to the first one.
  const stepHeading = page.getByRole("heading", { level: 2 }).first();
  await expect(stepHeading).toBeVisible();
  for (let i = 0; i < 5 && !/^1\./.test((await stepHeading.textContent()) ?? ""); i++) {
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForTimeout(200);
  }
  await page.getByRole("textbox", { name: "Username" }).fill(user.username);
  await page.getByRole("textbox", { name: "Display name" }).fill(`QA ${name.toUpperCase()} Studio`);
  await page.getByRole("group", { name: "What do you do?" }).getByText(name === "a" ? "Designer" : "Tailor", { exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: /^2\./ })).toBeVisible();

  // Step 2: picture
  await expect(page.getByRole("button", { name: /Choose (a|another) picture/ })).toBeVisible();
  if (withAvatar) {
    await page.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: makePng() });
    await expect(page.getByRole("button", { name: "Choose another picture" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: /^3\./ })).toBeVisible();

  // Step 3: interests
  const garments = page.getByRole("group", { name: "Garments" });
  const choice = (await garments.getByRole("button", { pressed: false }).first().textContent()) ?? "";
  const firstGarment = garments.getByRole("button", { name: choice, exact: true });
  await firstGarment.click();
  await expect(firstGarment).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 4: people to follow, then the 3-screen tour
  await expect(page.getByRole("heading", { name: /^4\./ })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: /^5\./ })).toBeVisible();
  const finish = page.getByRole("button", { name: "Start designing" });
  for (let i = 0; i < 5 && !(await finish.isVisible()); i++) {
    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(300);
  }
  await finish.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await page.waitForTimeout(2500);
  // BUG-05: not sent back to /welcome, and no "finish setting up" reminder right after finishing (no reload).
  expect(new URL(page.url()).pathname, "stays on the dashboard after finishing").toBe("/");
  await expect(page.getByText("Finish setting up your account")).toHaveCount(0);
}

test("people a and b finish onboarding (profile, picture, interests, tour)", async ({ browser }) => {
  for (const name of ["a", "b"] as QaName[]) {
    const context = await signedIn(browser, name);
    const page = await context.newPage();
    await finishOnboarding(page, name, name === "a");
    await page.goto("/");
    await expect(page.getByText("Finish setting up your account")).toHaveCount(0);
    await context.close();
  }
});

test("person c skips onboarding and sees the reminder banner", async ({ browser }) => {
  const context = await signedIn(browser, "c");
  const page = await context.newPage();
  // A brand-new person is taken from the dashboard to /welcome once.
  // (Only on a fresh account: on later runs the saved "skipped" state means no redirect.)
  await page.goto("/");
  await page.waitForURL(/\/welcome/, { timeout: 8000 }).catch(() => page.goto("/welcome"));
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname, "Skip for now stays on the dashboard (BUG-05)").toBe("/");
  // After skipping, the reminder is right to show (onboarding is not finished).
  await expect(page.getByText("Finish setting up your account")).toBeVisible();
  // Come back and finish (c needs a username for the social tests).
  await finishOnboarding(page, "c", false);
  await context.close();
});

test("a username that is taken is refused with a clear message", async ({ browser }) => {
  const context = await signedIn(browser, "b");
  const page = await context.newPage();
  await page.goto("/profile/edit");
  const box = page.getByRole("textbox", { name: "Username" });
  await expect(box).toHaveValue(users().b.username);
  await box.fill(users().a.username);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/taken|already|in use/i)).toBeVisible();
  await context.close();
});
