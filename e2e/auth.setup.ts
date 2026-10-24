import { test as setup } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";

export const USER_STATE = "e2e/.auth/user.json";

/** Registers one user for the whole run (auth endpoints are rate limited). */
setup("register the e2e user", async ({ page }) => {
  await register(page, { name: "晋", email: uniqueEmail() });
  await page.context().storageState({ path: USER_STATE });
});
