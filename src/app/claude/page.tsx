import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { siteOrigin } from "@/lib/config/site";
import { createClient } from "@/lib/supabase/server";
import { Empty, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";
import { disconnectClaude } from "./actions";
import { CopyField } from "./copy-field";

export const metadata: Metadata = { title: "Claude" };
export const dynamic = "force-dynamic";

type Connection = { id: string; client_name: string | null; created_at: string; last_used_at: string | null };

const PROJECT_LINE =
  "Use the Portal connector to plan my week, schedule study blocks, add life blocks and log sessions. Call get_today first. For GPU questions, search my PMPP and cite section and page; for my renderer, read explain_renderer first.";

const EXAMPLES = [
  "Why does my bounce loop waste lanes? Quiz me first, then show me where PMPP explains it.",
  "Walk me through the barrier bug in my renderer and how I would prove the fix.",
  "Plan Thursday: 2 hours of PMPP chapter 3 in the morning, lunch at 1, gym at 6.",
  "Move everything I didn't finish today to tomorrow.",
  "Log 1.5 hours on Axler 1.B, stage In progress, notes: did exercises 1 to 8.",
  "What's overdue, and what should I do first?",
  "Draft my Sunday updates and show me before posting.",
];

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ClaudePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  const { error: linkError } = await searchParams;
  const base = await siteOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mcp_connections");
  const connections = (data ?? []) as Connection[];

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader eyebrow="Connector" title="Use the portal from Claude">
        Ask Claude to plan, schedule and log in plain words, from the Claude app on your computer or phone. It runs on
        your Claude subscription and asks you before each change.
      </PageHeader>

      {linkError && (
        <ErrorNote message="That connect link was not valid. Start again from Claude's connector settings." />
      )}

      <section className="space-y-4">
        <SectionTitle>Set it up once</SectionTitle>
        <ol className="list-decimal space-y-3 card pl-10 text-sm">
          <li>
            In Claude, open <span className="text-white">Settings</span>, then{" "}
            <span className="text-white">Connectors</span>, then{" "}
            <span className="text-white">Add custom connector</span>.
          </li>
          <li>
            Name it <span className="text-white">Portal</span> and paste this URL:
            <div className="mt-2">
              <CopyField value={`${base}/api/mcp`} label="Connector URL" />
            </div>
          </li>
          <li>Press Connect. This page asks you to allow it; press Allow.</li>
          <li>
            In your GPU programming Claude project, add this line to the project instructions so Claude reaches for the
            portal on its own:
            <div className="mt-2">
              <CopyField value={PROJECT_LINE} label="Project instruction" />
            </div>
          </li>
        </ol>
        <p className="subtext text-sm">
          Once added on the web, the connector also shows up in the desktop and phone apps. Turn it on per chat from the
          tools menu, or leave it on in the project.
        </p>
      </section>

      <section>
        <SectionTitle>Things to ask</SectionTitle>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EXAMPLES.map((e) => (
            <li key={e} className="card text-sm text-bright">
              &ldquo;{e}&rdquo;
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Connected</SectionTitle>
        {error && <ErrorNote message={error.message} />}
        {!error && connections.length === 0 && <Empty>Nothing connected yet.</Empty>}
        {connections.length > 0 && (
          <div className="space-y-3">
            <ul className="space-y-3">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 card text-sm">
                  <span className="font-semibold">{c.client_name ?? "Claude"}</span>
                  <span className="text-muted">
                    Connected {when(c.created_at)} · last used {when(c.last_used_at)}
                  </span>
                </li>
              ))}
            </ul>
            <form action={disconnectClaude}>
              <button className="btn-ghost text-coral">Disconnect everything</button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
