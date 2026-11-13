import { expect, test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL, OWNER_STATE } from "./env";

// Signs in the way a real email link does: Supabase issues a one-time token for
// the seeded owner, and the portal's own /auth/callback exchanges it for a
// session. Nothing in the app is special-cased for tests.
setup("sign in as the seeded owner", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Run the suite through `npm run test:e2e`, which starts Supabase first.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: OWNER_EMAIL });
  if (error) throw error;

  await page.goto(`/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: OWNER_STATE });
});
