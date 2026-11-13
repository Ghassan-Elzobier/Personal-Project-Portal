import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, OWNER_STATE, PORT } from "./e2e/env";

// End-to-end, layout, accessibility and screenshot checks against a production
// build and a local Supabase stack. Run them with `npm run test:e2e` (which
// calls scripts/e2e.sh); see docs/FACTORY.md for what each suite guards.
//
// Phones are the main target: the owner uses the portal on a Pixel 7 (412 px)
// and every page must also hold at 360 px. Screenshots use a device scale of 1
// so the baselines stay small; layout is the same at any pixel density.

const pixel7 = { ...devices["Pixel 7"], deviceScaleFactor: 1 };

export default defineConfig({
  testDir: "e2e",
  // Baselines are rendered in the Playwright Linux image (scripts/e2e-docker.sh),
  // so there is one set, without a platform suffix.
  snapshotPathTemplate: "e2e/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixels: 0 },
  },
  use: {
    baseURL: BASE_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "pixel-7",
      use: { ...pixel7, storageState: OWNER_STATE },
      dependencies: ["setup"],
    },
    {
      name: "small-phone",
      use: { ...pixel7, viewport: { width: 360, height: 780 }, storageState: OWNER_STATE },
      dependencies: ["setup"],
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, storageState: OWNER_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
