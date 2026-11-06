import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { isProjectKey, projectDef } from "@/lib/config/projects";
import { createClient } from "@/lib/supabase/server";
import { Empty, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";
import Link from "next/link";
import { revokeMember, setJobHuntShare } from "./actions";
import { GrantForm } from "./grant-form";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

type Member = {
  account_id: string;
  email: string;
  display_name: string;
  role: string;
  projects: string[];
  since: string;
};

export default async function PeoplePage() {
  const me = await requireOwner();
  const supabase = await createClient();
  const [{ data, error }, sharesResult] = await Promise.all([supabase.rpc("portal_members"), supabase.rpc("portal_mentor_shares")]);
  const members = (data ?? []) as Member[];
  const shares = new Map(((sharesResult.data ?? []) as { account_id: string; shares: string[] }[]).map((s) => [s.account_id, s.shares]));

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader eyebrow="Access" title="People">
        Mentors sign in with a magic link and see only the projects you choose. They never need an account anywhere else.
      </PageHeader>

      <section>
        <SectionTitle>Who has access</SectionTitle>
        {error && <ErrorNote message={error.message} />}
        {!error && members.length === 0 && <Empty>Nobody yet.</Empty>}
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.account_id} className="card flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {m.display_name} <span className="text-xs font-normal text-neutral-400">{m.role}</span>
                </p>
                <p className="text-sm text-neutral-400">{m.email}</p>
                {m.role === "mentor" && (
                  <p className="mt-1 text-xs text-lavender">
                    {m.projects.filter(isProjectKey).map((k) => projectDef(k).title).join(", ")}
                    {shares.get(m.account_id)?.includes("job-hunt") ? ", job hunt" : ""}
                  </p>
                )}
              </div>
              {m.role === "mentor" && (
                <form action={setJobHuntShare}>
                  <input type="hidden" name="account_id" value={m.account_id} />
                  <input type="hidden" name="on" value={shares.get(m.account_id)?.includes("job-hunt") ? "false" : "true"} />
                  <button className="btn-ghost text-sm">{shares.get(m.account_id)?.includes("job-hunt") ? "Stop sharing the job hunt" : "Share the job hunt"}</button>
                </form>
              )}
              {m.account_id !== me.userId && (
                <form action={revokeMember}>
                  <input type="hidden" name="account_id" value={m.account_id} />
                  <button className="btn-ghost text-coral">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-neutral-300">
        See what mentors see:{" "}
        <Link href="/progress" className="text-aqua hover:underline">Progress</Link>,{" "}
        <Link href="/roadmap" className="text-aqua hover:underline">Roadmap</Link> and{" "}
        <Link href="/job-hunt" className="text-aqua hover:underline">Job hunt</Link>.
      </p>

      <section>
        <SectionTitle>Add or update a mentor</SectionTitle>
        <p className="subtext mb-4">
          First invite their email from the Supabase dashboard (Authentication, then Users, then Invite user). Then add
          them here. Adding an existing mentor again replaces their projects.
        </p>
        <GrantForm />
      </section>
    </div>
  );
}
