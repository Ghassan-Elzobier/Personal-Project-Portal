import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAIL } from "./env";

// The database's own functions, called as the seeded owner. For the two things a
// save test sometimes needs and no page offers: a starting state the pages only
// build in bulk (one unit of a study plan, where the page loads a whole plan), and
// putting back what the pages have no undo for. What a test checks still goes
// through the pages.
//
// It signs in as e2e/auth.setup.ts does, with a one-time token from the local
// Supabase, and keeps the session in memory: the browser's own session is untouched.

export async function ownerDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey)
    throw new Error("Run the suite through `npm run test:e2e`, which starts Supabase first.");

  const inMemory = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, inMemory);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: OWNER_EMAIL });
  if (link.error) throw link.error;
  const owner = createClient(url, anonKey, inMemory);
  const session = await owner.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (session.error) throw session.error;

  return {
    /** Calls one function as the owner. A refusal fails the test, with the database's own words. */
    async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const { data, error } = await owner.rpc(name, args);
      if (error) throw new Error(`The database refused '${name}': ${error.message}`);
      return data as T;
    },
  };
}
