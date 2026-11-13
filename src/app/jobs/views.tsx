import Link from "next/link";
import { Empty, SectionTitle } from "@/components/ui";
import { shortDate } from "@/lib/dates/week";
import { familyName } from "@/lib/jobs/classify";
import type { JobBoard, RoleView } from "@/lib/jobs/load";
import { BANDS, type Band, type MarketRow, type SkillStatus, type Standing } from "@/lib/jobs/match";
import { LEVELS, SKILLS } from "@/lib/jobs/skills";
import { AddRoleForm, AddSourceForm, CopySummary, EvidenceForm, RemoveEvidenceButton, SourceButtons } from "./controls";

export type Filters = { view?: string; where?: string; family?: string; level?: string; role?: string };

const BAND_STYLES: Record<Band, string> = {
  ready: "bg-mint/10 text-mint ring-mint/30",
  by_date: "bg-aqua/10 text-aqua ring-aqua/30",
  one_gap: "bg-sand/10 text-sand ring-sand/30",
  stretch: "bg-white/5 text-body ring-white/10",
  unread: "bg-white/5 text-muted ring-white/10",
};

export function BandChip({ band }: { band: Band }) {
  return (
    <span className={`chip ${BAND_STYLES[band]}`} title={BANDS[band].meaning}>
      {BANDS[band].name}
    </span>
  );
}

export const TIER_NAMES: Record<string, string> = {
  london: "London",
  uk: "UK",
  remote: "Remote",
  abroad: "Abroad",
  unknown: "Place not stated",
};
const SENIOR = new Set(["senior", "lead"]);

function query(current: Filters, next: Partial<Filters>): string {
  const merged = { ...current, ...next };
  const entries = Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1]));
  return `/jobs${entries.length ? `?${new URLSearchParams(entries)}` : ""}`;
}

/** The role's place: a London role also offered in Munich still reads as London first. */
function placeLabel(role: RoleView): string {
  const extra = role.alsoIn.length
    ? `, and ${role.alsoIn.length} more ${role.alsoIn.length === 1 ? "place" : "places"}`
    : "";
  return `${role.location || TIER_NAMES[role.location_tier]}${extra}`;
}

function RoleRow({ role, filters }: { role: RoleView; filters: Filters }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-56 flex-1">
        <Link
          href={query(filters, { role: role.gid })}
          prefetch={false}
          scroll={false}
          className="font-medium hover:underline"
        >
          {role.title}
        </Link>
        {role.fresh && <span className="ml-2 text-xs text-aqua">New to you</span>}
        <p className="text-xs text-muted">
          {role.company}, {placeLabel(role)}
          {role.source_kind === "arbeitnow" && (
            <>
              {", via "}
              <a
                href="https://www.arbeitnow.co.uk"
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Arbeitnow
              </a>
            </>
          )}
        </p>
        <p className="mt-1 max-w-3xl text-sm text-body">{role.fit.reason}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {role.interest !== null && role.interest >= 2 && (
          <span className="text-lavender">{role.interest === 3 ? "Really want" : "Want"}</span>
        )}
        {SENIOR.has(role.seniority) && (
          <span className="chip bg-white/5 text-body ring-white/10">
            {role.seniority === "lead" ? "Lead level" : "Senior"}
          </span>
        )}
        {role.closed_at && <span className="chip bg-coral/10 text-coral ring-coral/30">No longer listed</span>}
        <BandChip band={role.fit.band} />
      </div>
    </li>
  );
}

function Pick({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`rounded-full px-3 py-1 text-xs ring-1 transition hover:ring-white/30 ${active ? "bg-lavender/20 text-white ring-lavender/50" : "bg-white/5 text-body ring-white/10"}`}
    >
      {children}
    </Link>
  );
}

const SECTION_LIMIT = 60;

function RoleSection({
  title,
  note,
  roles,
  filters,
  open,
}: {
  title: string;
  note?: string;
  roles: RoleView[];
  filters: Filters;
  open: boolean;
}) {
  if (!roles.length) return null;
  const shown = roles.slice(0, SECTION_LIMIT);
  return (
    <details open={open} className="group/section">
      <summary className="flex cursor-pointer items-baseline justify-between gap-4 border-b border-white/10 pb-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="shrink-0 text-xs text-muted tabular-nums">{roles.length}</span>
      </summary>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      <ul className="divide-y divide-white/5">
        {shown.map((role) => (
          <RoleRow key={role.gid} role={role} filters={filters} />
        ))}
      </ul>
      {roles.length > shown.length && (
        <p className="py-3 text-sm text-muted">
          Showing the first {shown.length}. Narrow the filters above to see the other {roles.length - shown.length}.
        </p>
      )}
    </details>
  );
}

export function RolesView({ board, filters }: { board: JobBoard; filters: Filters }) {
  const where = filters.where ?? "near";
  const live = board.roles.filter((r) => !r.closed_at && r.visible && r.stage !== "passed" && r.interest !== 0);
  const inPlace = (r: RoleView) => {
    if (where === "near") return r.location_tier === "london" || r.location_tier === "remote";
    if (where === "uk") return r.location_tier === "uk" || r.location_tier === "unknown";
    if (where === "abroad") return r.location_tier === "abroad";
    return true;
  };
  const placed = live.filter(inPlace);
  const levelled = filters.level === "open" ? placed.filter((r) => !SENIOR.has(r.seniority)) : placed;
  const roles = filters.family ? levelled.filter((r) => r.family === filters.family) : levelled;
  const familyCounts = new Map<string, number>();
  for (const r of filters.level === "open" ? placed.filter((x) => !SENIOR.has(x.seniority)) : placed)
    familyCounts.set(r.family, (familyCounts.get(r.family) ?? 0) + 1);
  const count = (test: (r: RoleView) => boolean) => live.filter(test).length;
  // What you marked stays in view whatever its fit, and wherever it is.
  const marked = (r: RoleView) => (r.interest ?? 0) >= 2 || (r.stage !== "new" && r.stage !== "rejected");
  const shortlist = roles.filter(marked);
  const bands = (...wanted: Band[]) => roles.filter((r) => !marked(r) && wanted.includes(r.fit.band));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Where">
          <Pick href={query(filters, { where: undefined, family: undefined })} active={where === "near"}>
            London and remote {count((r) => r.location_tier === "london" || r.location_tier === "remote")}
          </Pick>
          <Pick href={query(filters, { where: "uk", family: undefined })} active={where === "uk"}>
            Elsewhere in the UK {count((r) => r.location_tier === "uk" || r.location_tier === "unknown")}
          </Pick>
          <Pick href={query(filters, { where: "abroad", family: undefined })} active={where === "abroad"}>
            Abroad, strong matches only {count((r) => r.location_tier === "abroad")}
          </Pick>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <Pick
            href={query(filters, { level: filters.level === "open" ? undefined : "open" })}
            active={filters.level === "open"}
          >
            Hide senior and above
          </Pick>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Field">
          <Pick href={query(filters, { family: undefined })} active={!filters.family}>
            All fields
          </Pick>
          {[...familyCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => (
              <Pick key={key} href={query(filters, { family: key })} active={filters.family === key}>
                {familyName(key)} {n}
              </Pick>
            ))}
        </div>
      </div>

      {!roles.length && <Empty>No roles match these filters. Try another place or field.</Empty>}
      <RoleSection
        title="Your shortlist"
        note="Roles you marked or are tracking."
        roles={shortlist}
        filters={filters}
        open
      />
      <RoleSection
        title="Closest to you"
        note="Everything these require is either something you can show or coming in your plan."
        roles={bands("ready", "by_date")}
        filters={filters}
        open
      />
      <RoleSection
        title="One gap"
        note="One requirement is outside your plan. Often worth a look anyway: adverts ask for more than they need."
        roles={bands("one_gap")}
        filters={filters}
        open
      />
      <RoleSection
        title="Stretch"
        roles={bands("stretch")}
        filters={filters}
        open={!bands("ready", "by_date", "one_gap").length}
      />
      <RoleSection
        title="Too little to judge"
        note="Too few skills on your list were found in these to say how close you are. They may still be worth reading."
        roles={bands("unread")}
        filters={filters}
        open={false}
      />
    </div>
  );
}

const STATUS_DOT: Record<SkillStatus, string> = {
  evidenced: "bg-mint",
  in_plan: "bg-aqua",
  near: "bg-sand",
  missing: "bg-coral",
};

export function StandingNote({ standing, about = "you" }: { standing: Standing; about?: "you" | "him" }) {
  const plan = about === "you" ? "your plan" : "the plan";
  if (standing.status === "evidenced") {
    const top = standing.evidence[0];
    return (
      <span>
        {LEVELS[standing.level].name}:{" "}
        {top?.href ? (
          <a
            href={top.href}
            target={top.href.startsWith("/") ? undefined : "_blank"}
            rel="noreferrer"
            className="text-aqua underline-offset-2 hover:underline"
          >
            {top.label}
          </a>
        ) : (
          top?.label
        )}
      </span>
    );
  }
  if (standing.status === "in_plan" && standing.next) {
    const when = standing.next.dueOn
      ? `by ${shortDate(standing.next.dueOn)}`
      : standing.next.phase !== null
        ? `phase ${standing.next.phase + 1}`
        : "not dated";
    return (
      <span>
        {standing.level === 1 ? "Studied, not practised. " : ""}
        {standing.next.href ? (
          <Link href={standing.next.href} className="text-aqua underline-offset-2 hover:underline">
            {standing.next.name}
          </Link>
        ) : (
          standing.next.name
        )}
        , {when}
        {standing.next.optional ? ", optional" : ""}
      </span>
    );
  }
  if (standing.nearName)
    return (
      <span>
        Not in {plan}, but close to {standing.nearName}
      </span>
    );
  return <span>Not in {plan}</span>;
}

export function SkillTable({
  rows,
  empty,
  about = "you",
}: {
  rows: MarketRow[];
  empty: string;
  about?: "you" | "him";
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-lg text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-4 font-normal">Skill</th>
            <th className="py-1 pr-4 text-right font-normal">Required by</th>
            <th className="py-1 pr-4 text-right font-normal">Wanted by</th>
            <th className="py-1 font-normal">{about === "you" ? "Where you stand" : "Where he stands"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={row.skill.key}>
              <td className="py-2 pr-4">
                <span
                  className={`mr-2 inline-block size-2 rounded-full ${STATUS_DOT[row.standing.status]}`}
                  aria-hidden
                />
                {row.skill.name}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{row.must}</td>
              <td className="py-2 pr-4 text-right text-muted tabular-nums">{row.soft}</td>
              <td className="py-2 text-body">
                <StandingNote standing={row.standing} about={about} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkillsView({ board, summary }: { board: JobBoard; summary: string }) {
  const { market, families, branches, unknown, evidence } = board;
  const gaps = market.filter((m) => m.standing.status === "missing" || m.standing.status === "near");
  const coming = market.filter((m) => m.standing.status === "in_plan");
  const showing = market.filter((m) => m.standing.status === "evidenced");
  const targetCount = board.roles.filter((r) => r.target).length;

  return (
    <div className="space-y-10">
      {targetCount === 0 ? (
        <Empty>This fills in once roles are on file. Check for new roles, or add an employer under Sources.</Empty>
      ) : (
        <>
          <section aria-labelledby="closest-title">
            <SectionTitle>
              <span id="closest-title">Where you are closest</span>
            </SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-body">
              {targetCount} open roles are in scope. This is how they split by field, and how many you could go for now
              or once your plan reaches them.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-lg text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-4 font-normal">Field</th>
                    <th className="py-1 pr-4 text-right font-normal">Roles</th>
                    <th className="py-1 pr-4 text-right font-normal">Ready</th>
                    <th className="py-1 pr-4 text-right font-normal">On your plan</th>
                    <th className="py-1 text-right font-normal">One gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 tabular-nums">
                  {[...families]
                    .sort((a, b) => b.ready + b.onPlan - (a.ready + a.onPlan) || b.roles - a.roles)
                    .map((f) => (
                      <tr key={f.key}>
                        <td className="py-2 pr-4">
                          <Link href={`/jobs?family=${f.key}&where=all`} className="hover:underline">
                            {f.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-right text-body">{f.roles}</td>
                        <td className="py-2 pr-4 text-right text-mint">{f.ready}</td>
                        <td className="py-2 pr-4 text-right text-aqua">{f.onPlan}</td>
                        <td className="py-2 text-right text-sand">{f.oneGap}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="branch-title">
            <SectionTitle>
              <span id="branch-title">Which way after phase 3</span>
            </SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-body">
              The first three phases of your plan are fundamentals every route needs. After them you choose where to go
              deeper, and these numbers are the case to take to your mentor.
            </p>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {branches.map((b) => (
                <li key={b.key} className="space-y-2 card">
                  <h3 className="font-semibold">{b.name}</h3>
                  <p className="text-sm text-body">{b.why}</p>
                  <dl className="space-y-1 text-sm tabular-nums">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Roles asking for it</dt>
                      <dd>{b.asking}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Of those you want</dt>
                      <dd>{b.askingWanted}</dd>
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

          <section aria-labelledby="gaps-title" className="space-y-3">
            <SectionTitle>
              <span id="gaps-title">Asked for, and not in your plan</span>
            </SectionTitle>
            <p className="max-w-3xl text-sm text-body">
              Ranked by how many roles require it and how much you want those roles. A candidate for your plan, not an
              instruction.
            </p>
            <SkillTable rows={gaps.slice(0, 20)} empty="Nothing the roles ask for is missing from your plan." />
          </section>

          <section aria-labelledby="coming-title" className="space-y-3">
            <SectionTitle>
              <span id="coming-title">Asked for, and coming in your plan</span>
            </SectionTitle>
            <SkillTable rows={coming.slice(0, 20)} empty="Nothing in the roles on file is waiting on your plan." />
          </section>

          <section aria-labelledby="showing-title" className="space-y-3">
            <SectionTitle>
              <span id="showing-title">Asked for, and you can show it</span>
            </SectionTitle>
            <SkillTable
              rows={showing.slice(0, 20)}
              empty="No evidence yet. Finish a unit, or add work you have already done below."
            />
          </section>

          {unknown.length > 0 && (
            <section aria-labelledby="unknown-title" className="space-y-2">
              <SectionTitle>
                <span id="unknown-title">Terms not on your skill list</span>
              </SectionTitle>
              <p className="max-w-3xl text-sm text-body">
                The tracker only sees skills it has been told about. These keep appearing in requirements, so any that
                matter should be added to <code className="text-xs">src/lib/jobs/skills.ts</code>. Some will be noise.
              </p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {unknown.map((u) => (
                  <li key={u.term} className="chip bg-white/5 text-body ring-white/10">
                    {u.term} {u.roles}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="evidence-title" className="space-y-3">
        <SectionTitle>
          <span id="evidence-title">Evidence the plans cannot see</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          Finished units and recorded results count automatically. Add what you did before this plan, or at work, so
          your closest matches show up.
        </p>
        <EvidenceForm
          skills={SKILLS.map((s) => ({ key: s.key, name: s.name, group: s.group }))}
          levels={[4, 3, 2, 1].map((level) => ({ level, name: LEVELS[level].name, meaning: LEVELS[level].meaning }))}
        />
        {evidence.length > 0 && (
          <ul className="divide-y divide-white/5 text-sm">
            {evidence.map((e) => (
              <li key={e.gid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <span>
                  <span className="font-medium">{SKILLS.find((s) => s.key === e.skill)?.name ?? e.skill}</span>
                  <span className="text-muted"> ({LEVELS[e.level]?.name}): </span>
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-aqua underline-offset-2 hover:underline"
                    >
                      {e.note}
                    </a>
                  ) : (
                    e.note
                  )}
                </span>
                <RemoveEvidenceButton gid={e.gid} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mentor-title" className="space-y-3">
        <SectionTitle>
          <span id="mentor-title">For your mentor</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          A summary to paste into a message or your Sunday update. It leaves out your notes and contacts.
        </p>
        <CopySummary text={summary} />
      </section>
    </div>
  );
}

const STAGE_NAMES: [string, string][] = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["interview", "Interviewing"],
  ["offer", "Offer"],
];

export function ApplicationsView({ board, filters }: { board: JobBoard; filters: Filters }) {
  const actions = board.roles
    .filter((r) => r.next_action && !["rejected", "passed"].includes(r.stage))
    .sort((a, b) => (a.next_action_on ?? "9999").localeCompare(b.next_action_on ?? "9999"));
  // A saved role that has gone from its board is no longer something to act on.
  const ended = board.roles.filter(
    (r) => r.stage === "rejected" || r.stage === "passed" || (r.stage === "saved" && r.closed_at),
  );
  const oldSheet = board.roles
    .filter((r) => r.legacy_rating !== null)
    .sort((a, b) => (b.legacy_rating ?? 0) - (a.legacy_rating ?? 0) || a.company.localeCompare(b.company));
  const link = (r: RoleView) => query(filters, { role: r.gid });

  return (
    <div className="space-y-8">
      <section aria-labelledby="actions-title" className="space-y-2">
        <SectionTitle>
          <span id="actions-title">Next actions</span>
        </SectionTitle>
        {actions.length === 0 ? (
          <Empty>
            Nothing to do yet. Open a role and give it a next action with a date. Two a week is plenty alongside your
            plan.
          </Empty>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {actions.map((r) => (
              <li key={r.gid} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <Link href={link(r)} scroll={false} className="hover:underline">
                  {r.next_action}
                  <span className="text-muted">
                    {" "}
                    for {r.title}, {r.company}
                  </span>
                </Link>
                {r.next_action_on && (
                  <span
                    className={
                      r.next_action_on < board.today
                        ? "text-coral"
                        : r.next_action_on === board.today
                          ? "text-sand"
                          : "text-muted"
                    }
                  >
                    {shortDate(r.next_action_on)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="By stage">
        {STAGE_NAMES.map(([stage, name]) => {
          const here = board.roles.filter((r) => r.stage === stage && !(stage === "saved" && r.closed_at));
          return (
            <div key={stage} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/5">
              <h3 className="mb-2 flex items-baseline justify-between text-sm font-semibold">
                {name}
                <span className="text-xs font-normal text-muted tabular-nums">{here.length}</span>
              </h3>
              {here.length === 0 ? (
                <p className="text-xs text-muted">None.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {here.map((r) => (
                    <li key={r.gid}>
                      <Link href={link(r)} scroll={false} className="block hover:underline">
                        {r.title}
                      </Link>
                      <span className="text-xs text-muted">
                        {r.company}
                        {r.closed_at ? ", no longer listed" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {ended.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-body hover:text-white">
            Ended or passed on, {ended.length}
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {ended.map((r) => (
              <li key={r.gid}>
                <Link href={link(r)} scroll={false} className="hover:underline">
                  {r.title}, {r.company}
                </Link>{" "}
                ({r.stage === "passed" ? "passed on" : r.stage === "rejected" ? "rejected" : "no longer listed"})
              </li>
            ))}
          </ul>
        </details>
      )}

      {oldSheet.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-body hover:text-white">
            From your old sheet, {oldSheet.length}, highest rated first
          </summary>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            These keep your old rating for reference. It never said what it measured, so it does not count as interest.
            Mark the ones you still want. Roles with no advert on file are on sites that cannot be read automatically,
            so paste the text if you want them compared.
          </p>
          <ul className="mt-2 divide-y divide-white/5 text-sm">
            {oldSheet.map((r) => (
              <li key={r.gid} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="min-w-56 flex-1">
                  <span className="mr-2 inline-block w-5 text-right text-muted tabular-nums">{r.legacy_rating}</span>
                  <Link href={link(r)} scroll={false} className="hover:underline">
                    {r.title}
                  </Link>
                  <span className="text-muted">, {r.company}</span>
                </span>
                <span className="text-xs text-muted">
                  {r.closed_at ? "No longer listed" : r.has_body ? BANDS[r.fit.band].name : "No advert on file"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const KIND_NAMES: Record<string, string> = {
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  workable: "Workable",
  teamtailor: "Teamtailor",
  arbeitnow: "Arbeitnow",
  rse: "RSE Society",
};

function ago(iso: string | null, today: string): string {
  if (!iso) return "Not read yet";
  const day = iso.slice(0, 10);
  return day === today ? "Read today" : `Read ${shortDate(day)}`;
}

export function SourcesView({ board }: { board: JobBoard }) {
  const feeds = board.sources.filter((s) => s.kind !== "link");
  const links = board.sources.filter((s) => s.kind === "link");
  return (
    <div className="space-y-10">
      <section aria-labelledby="add-title" className="space-y-3">
        <SectionTitle>
          <span id="add-title">Follow an employer</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          Paste any job link or careers page. If they use Greenhouse, Ashby, Lever, Workable or Teamtailor, their roles
          arrive by themselves. Anything else goes on the list to check by hand, because reading those sites
          automatically is against their terms or unsupported.
        </p>
        <AddSourceForm />
      </section>

      <section aria-labelledby="feeds-title" className="space-y-3">
        <SectionTitle>
          <span id="feeds-title">Read automatically</span>
        </SectionTitle>
        {feeds.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {feeds.map((s) => (
              <li key={s.gid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <div className="min-w-48">
                  <span className={s.active ? "" : "text-muted"}>{s.name}</span>
                  <span className="text-xs text-muted"> {KIND_NAMES[s.kind] ?? s.kind}</span>
                  {s.last_error && <p className="text-xs text-coral">{s.last_error}</p>}
                </div>
                <span className="flex items-center gap-3 text-xs text-muted tabular-nums">
                  {s.last_count !== null && <span>{s.last_count} listed</span>}
                  <span>{ago(s.last_ok_at, board.today)}</span>
                  <SourceButtons gid={s.gid} active={s.active} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="links-title" className="space-y-3">
        <SectionTitle>
          <span id="links-title">Check by hand</span>
        </SectionTitle>
        {links.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {[...links]
              .sort((a, b) => (a.last_checked_on ?? "").localeCompare(b.last_checked_on ?? ""))
              .map((s) => (
                <li key={s.gid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  {s.careers_url ? (
                    <a
                      href={s.careers_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-aqua underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                  <span className="flex items-center gap-3 text-xs text-muted">
                    <span>{s.last_checked_on ? `Checked ${shortDate(s.last_checked_on)}` : "Not checked yet"}</span>
                    <SourceButtons gid={s.gid} active={s.active} canCheck />
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="hand-title" className="space-y-3">
        <SectionTitle>
          <span id="hand-title">Add a role by hand</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-body">
          For a role from LinkedIn, a recruiter or a site with no feed. Paste the advert and it gets the same comparison
          as any other role.
        </p>
        <AddRoleForm />
      </section>
    </div>
  );
}
