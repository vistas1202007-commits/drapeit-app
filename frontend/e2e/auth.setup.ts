import { expect, test } from "@playwright/test";
import { stateFile, users, watchPage, type QaName } from "./support/qa";

// Signs each QA account in through the real sign-in screen and saves the session for the other tests.
for (const name of ["a", "b", "c"] as QaName[]) {
  test(`sign in as ${name}`, async ({ page }) => {
    const user = users()[name];
    watchPage(page, name);
    await page.goto("/");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Password")).toBeHidden();
    await page.context().storageState({ path: stateFile(name) });
  });
}
