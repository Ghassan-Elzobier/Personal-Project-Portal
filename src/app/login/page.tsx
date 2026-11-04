import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/access";
import { safeNext } from "@/lib/auth/safe-next";
import { supabaseConfigured } from "@/lib/supabase/server";
import { signInWithGoogle } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Ask for a new one.",
  "not-invited": "That Google account isn't invited yet. Use the email you were invited with, or ask Ghassan to add you.",
  google: "Google sign-in didn't finish. Try again, or use an email link.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  if (supabaseConfigured() && (await getAccess())) redirect(safeNext(next));
  const google = process.env.GOOGLE_SIGN_IN === "on";

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card space-y-6 p-8">
        <div className="space-y-2">
          <p className="eyebrow">Study and rendering progress</p>
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="subtext">Mentors: use the email you were invited with.</p>
        </div>
        {error && (
          <p className="text-sm text-coral" role="alert">
            {ERRORS[error] ?? ERRORS.link}
          </p>
        )}
        {supabaseConfigured() ? (
          <>
            {google && (
              <>
                <form action={signInWithGoogle}>
                  <input type="hidden" name="next" value={safeNext(next)} />
                  <button className="btn w-full bg-white text-neutral-900 hover:bg-neutral-200">
                    <GoogleMark />
                    Continue with Google
                  </button>
                </form>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span className="h-px flex-1 bg-white/10" />
                  or get an email link
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              </>
            )}
            <LoginForm next={safeNext(next)} />
          </>
        ) : (
          <p className="text-sm text-sand">Supabase is not configured yet. Follow docs/SETUP.md.</p>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
