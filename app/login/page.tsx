import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { safeNext } from "@/lib/safe-next";
import { supabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  if (supabaseConfigured() && (await getAccess())) redirect(safeNext(next));

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card space-y-6 p-8">
        <div className="space-y-2">
          <p className="eyebrow">Study and rendering progress</p>
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="subtext">Mentors: use the email you were invited with.</p>
        </div>
        {error && <p className="text-sm text-coral">That link has expired or was already used. Ask for a new one.</p>}
        {supabaseConfigured() ? (
          <LoginForm next={safeNext(next)} />
        ) : (
          <p className="text-sm text-sand">Supabase is not configured yet. Follow docs/SETUP.md.</p>
        )}
      </div>
    </div>
  );
}
