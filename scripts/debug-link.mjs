// Prints a one-time sign-in link for the seeded owner on the LOCAL stack, the way
// e2e/auth.setup.ts signs in: Supabase issues a token and the portal's own
// /auth/callback turns it into a session. Refuses anything but a local database.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
if (!url || !key) throw new Error("Run it through `npm run debug:link`, which starts the local database first.");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${url}/`)) {
  throw new Error(`Refusing to sign in against a database that is not local: ${new URL(url).host}`);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "owner@example.test" });
if (error) throw error;
console.log(`${site}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
