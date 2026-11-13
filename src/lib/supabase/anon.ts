import "server-only";
import { createClient as createSupabase } from "@supabase/supabase-js";

/** A Supabase client with no session, for the RPCs the token and MCP endpoints call. */
export function anonClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
