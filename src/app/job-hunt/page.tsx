import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { shortDate } from "@/lib/dates/week";
import { familyName } from "@/lib/jobs/classify";
import { mentorJobView, type MentorSource } from "@/lib/jobs/mentor";
import { createClient } from "@/lib/supabase/server";
import { Chip, Empty, ErrorNote, PageHeader, ScrollX, SectionTitle } from "@/components/ui";
import { BandChip, SkillTable, TIER_NAMES } from "../jobs/views";

export const metadata: Metadata = { title: "Job hunt" };
export const dynamic = "force-dynamic";

const STAGE_NAMES: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interviewing",
  offer: "Offer",
};

/**
 * The job hunt, read-only, for a mentor it is shared with. It is built from a read
 * that leaves out notes, next actions, ratings, contacts and advert text.
 */
export default async function SharedJobHuntPage() {
  const access = await requireAccess();
  if (usesAsana()) notFound();
  const owner = access.role === "owner";
  const header = (
    <PageHeader eyebrow="Read-only" title="Job hunt">
      {owner
        ? "What a mentor sees when you share the job hunt with them on People. Your notes, next actions, ratings, contacts and advert text are left out."
        : "The roles Ghassan is tracking, how close he is to them, and which skills they keep asking for that his plan does or does not cover."}
    </PageHeader>
  );
  if (!access.shares.includes("job-hunt")) {
    return (
      <div className="space-y-6">
        {header}
        <Empty>The job hunt has not been shared with you.</Empty>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tracker_mentor_job_source");
  if (error) {
    console.error("tracker_mentor_job_source failed", error.message);
    return (
      <div className="space-y-6">
        {header}
        <ErrorNote message="The job hunt did not load. Try again in a minute." />
      </div>
    );
  }
  const view = mentorJobView(data as MentorSource);

  return (
    <div className="space-y-10">
      {header}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 card sm:grid-cols-5">
        <Stat label="Roles in scope" value={view.inScope} detail={`${view.nearby} in London or remote`} />
        <Stat label="Saved" value={view.pipeline.saved} />
        <Stat label="Applied" value={view.pipeline.applied} />
        <Stat label="Interviewing" value={view.pipeline.interview} />
        <Stat
          label="Offers"
          value={view.pipeline.offer}
          detail={view.lastRead ? `Roles checked ${shortDate(view.lastRead.slice(0, 10))}` : undefined}
        />
      </dl>

      <section aria-labelledby="closest-title" className="space-y-3">
        <SectionTitle>
          <span id="closest-title">Closest roles</span>
        </SectionTitle>
        {view.closest.length === 0 ? (
          <Empty>No role is close yet.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {view.closest.map((r) => (
              <li key={r.gid} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-56 flex-1">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted">
                    {r.company}, {TIER_NAMES[r.location_tier] ?? r.location_tier}, {familyName(r.family)}
                  </p>
                  <p className="mt-1 max-w-3xl text-sm text-body">{r.fit.reason}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {(r.seniority === "senior" || r.seniority === "lead") && (
                    <Chip>{r.seniority === "lead" ? "Lead level" : "Senior"}</Chip>
                  )}
                  <BandChip band={r.fit.band} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="gap-title" className="space-y-3">
        <SectionTitle>
          <span id="gap-title">Skills gap</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          What the roles in scope require, ranked by how many require it and how far the plan is from it.
        </p>
        <h3 className="text-sm font-semibold">Not in the plan</h3>
        <SkillTable about="him" rows={view.gaps} empty="Nothing the roles ask for is missing from the plan." />
        <h3 className="pt-2 text-sm font-semibold">Coming in the plan</h3>
        <SkillTable about="him" rows={view.coming} empty="Nothing is waiting on the plan." />
        <h3 className="pt-2 text-sm font-semibold">Can show now</h3>
        <SkillTable about="him" rows={view.showing} empty="No evidence recorded yet." />
      </section>

      <section aria-labelledby="branch-title" className="space-y-3">
        <SectionTitle>
          <span id="branch-title">Which way after phase 3</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          The first three phases are fundamentals every route needs. These are the options after them, and what each
          would do for the roles in scope.
        </p>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {view.branches.map((b) => (
            <li key={b.key} className="space-y-2 card">
              <h3 className="font-semibold">{b.name}</h3>
              <p className="text-sm text-body">{b.why}</p>
              <dl className="space-y-1 text-sm tabular-nums">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Roles asking for it</dt>
                  <dd>{b.asking}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Would move up a band</dt>
                  <dd>{b.unlocks}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fields-title" className="space-y-3">
        <SectionTitle>
          <span id="fields-title">By field</span>
        </SectionTitle>
        <ScrollX label="Roles by field">
          <table className="w-full min-w-lg text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-4 font-normal">Field</th>
                <th className="py-1 pr-4 text-right font-normal">Roles</th>
                <th className="py-1 pr-4 text-right font-normal">Ready</th>
                <th className="py-1 pr-4 text-right font-normal">On the plan</th>
                <th className="py-1 text-right font-normal">One gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 tabular-nums">
              {[...view.families]
                .sort((a, b) => b.ready + b.onPlan - (a.ready + a.onPlan) || b.roles - a.roles)
                .map((f) => (
                  <tr key={f.key}>
                    <td className="py-2 pr-4">{f.name}</td>
                    <td className="py-2 pr-4 text-right text-body">{f.roles}</td>
                    <td className="py-2 pr-4 text-right text-mint">{f.ready}</td>
                    <td className="py-2 pr-4 text-right text-aqua">{f.onPlan}</td>
                    <td className="py-2 text-right text-sand">{f.oneGap}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </ScrollX>
      </section>

      {view.applications.length > 0 && (
        <section aria-labelledby="apps-title" className="space-y-2">
          <SectionTitle>
            <span id="apps-title">Applications</span>
          </SectionTitle>
          <ul className="divide-y divide-white/5 text-sm">
            {view.applications.map((r) => (
              <li key={r.gid} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                <span>
                  {r.title}
                  <span className="text-muted">
                    , {r.company}
                    {r.closed_at ? ", no longer listed" : ""}
                  </span>
                </span>
                <span className="text-body">{STAGE_NAMES[r.stage] ?? r.stage}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      {detail && <dd className="text-xs text-muted">{detail}</dd>}
    </div>
  );
}
