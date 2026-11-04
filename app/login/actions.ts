"use server";

import { safeNext } from "@/lib/safe-next";
import { siteOrigin } from "@/lib/site";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export type LoginState = { sent?: string; error?: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseConfigured()) return { error: "Supabase is not configured yet. See docs/SETUP.md." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };

  const next = safeNext(formData.get("next"));
  const callback = new URL("/auth/callback", await siteOrigin());
  if (next !== "/") callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Nobody signs themselves up: only invited accounts get a link.
    options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
  });

  // Same answer whether or not the account exists, so the form does not
  // reveal who has access. Rate limits are the one error worth showing.
  if (error && error.status === 429) return { error: "Too many sign-in emails. Wait a minute and try again." };
  if (error && error.status !== 400 && error.status !== 422) console.error("signInWithOtp failed", error.message);
  return { sent: email };
}
