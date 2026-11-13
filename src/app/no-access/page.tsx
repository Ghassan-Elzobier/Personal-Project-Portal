import type { Metadata } from "next";

export const metadata: Metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="space-y-4 card p-8">
        <h1 className="text-2xl font-bold">You&apos;re signed in, but not set up yet</h1>
        <p className="subtext">
          This account has no access to the portal yet. If you&apos;re a mentor, ask Ghassan to add you. Otherwise, sign
          out and try the email you were invited with.
        </p>
        <form action="/auth/signout" method="post">
          <button className="btn-ghost">Sign out</button>
        </form>
      </div>
    </div>
  );
}
