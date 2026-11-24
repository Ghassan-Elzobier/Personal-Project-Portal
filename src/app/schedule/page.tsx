import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { timeZone } from "@/lib/config/env";
import { attempt, studyTarget } from "@/lib/portal/data";
import { studyTotals } from "@/lib/portal/stats";
import { studyWeek, type StudyWeek } from "@/lib/portal/study-week";
import { formatHours } from "@/lib/tasks/session-log";
import { missedBlocks } from "@/lib/portal/day";
import { loadScheduleWeek, resolveWeek } from "@/lib/portal/schedule";
import { listSessionComments } from "@/lib/tasks/tracker";
import { addDays, dateIn, shortDate, zonedParts } from "@/lib/dates/week";
import { ErrorNote, PageHeader } from "@/components/ui";
import { disconnectGoogle } from "./actions";
import { SyncStudyButton } from "./sync-button";
import { CalendarButton } from "../life/calendar-button";
import { WeekPlanner } from "./week-planner";
import { now as clockNow } from "@/lib/dates/clock";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";
// The study sync writes to Google Calendar one task at a time.
export const maxDuration = 60;

const GOOGLE_NOTES: Record<string, string> = {
  connected: "Google Calendar is connected. Study blocks and life blocks you add here appear there too.",
  cancelled: "Google Calendar was not connected.",
  expired: "That took too long. Try connecting again.",
  denied: "Only the owner can connect Google Calendar.",
  failed: "Google Calendar could not be connected. Try again.",
  "no-refresh-token":
    "Google did not grant ongoing access. Remove the portal under myaccount.google.com/permissions and connect again.",
  "not-configured": "Google Calendar is not set up yet. See docs/SETUP.md.",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; google?: string; invites?: string }>;
}) {
  await requireOwner();
  const params = await searchParams;
  const week = resolveWeek(params.week);
  const showInvites = params.invites === "show";
  // The week's session logs say which study blocks were kept. If they can't be read, none is called missed.
  const [data, comments, target] = await Promise.all([
    loadScheduleWeek(week, { showInvites }),
    attempt(() => listSessionComments(week.startsAt)),
    studyTarget(week),
  ]);
  const keep = showInvites ? "&invites=show" : "";
  const googleReady = typeof data.google === "object" && "email" in data.google;
  const tz = timeZone();
  const now = zonedParts(clockNow(), tz);
  const thisWeek = dateIn(clockNow(), tz);
  const logs = comments.ok
    ? comments.value.map((c) => ({ taskGid: c.taskGid, ...zonedParts(new Date(c.createdAt), tz) }))
    : [];
  const missed = comments.ok ? missedBlocks(data.blocks, now.date, now.minutes, logs) : new Set<string>();
  // Without the session logs, nothing logged is known, so the line is left out rather than wrong.
  const study = comments.ok
    ? studyWeek({
        blocks: data.blocks,
        missed,
        logs,
        logged: studyTotals(comments.value, week, now.date, tz).week,
        target,
        today: now.date,
        now: now.minutes,
      })
    : null;
  const note = params.google ? GOOGLE_NOTES[params.google] : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${shortDate(week.start)} to ${shortDate(week.end)}`} title="Schedule">
        Drag a task onto a time to plan it, then add more sessions on it from its block. Meals, cooking and the gym come
        from your Life plans and make room for study when they clash. Everything is copied to Google Calendar.
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/schedule?week=${addDays(week.start, -7)}${keep}`}
            className="btn-ghost px-4 py-1.5"
            aria-label="Previous week"
          >
            ←
          </Link>
          <Link href={`/schedule${showInvites ? "?invites=show" : ""}`} className="btn-ghost px-4 py-1.5">
            This week
          </Link>
          <Link
            href={`/schedule?week=${addDays(week.start, 7)}${keep}`}
            className="btn-ghost px-4 py-1.5"
            aria-label="Next week"
          >
            →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {googleReady && (data.hiddenInvites > 0 || showInvites) && (
            <Link
              href={`/schedule?week=${week.start}${showInvites ? "" : "&invites=show"}`}
              className="text-sm text-muted hover:text-white"
            >
              {showInvites
                ? "Hide invites I haven't accepted"
                : `${data.hiddenInvites} unanswered ${data.hiddenInvites === 1 ? "invite" : "invites"} hidden · Show`}
            </Link>
          )}
          {googleReady && <SyncStudyButton />}
          {googleReady && <CalendarButton className="btn-ghost px-4 py-1.5" label="Update Life in Google" />}
          <GoogleStatus google={data.google} />
        </div>
      </div>

      {note && <p className="rounded-xl bg-white/5 p-3 text-sm text-body">{note}</p>}
      {data.errors.map((e) => (
        <ErrorNote key={e} message={e} />
      ))}

      {study && <StudyLine study={study} />}

      <WeekPlanner
        key={week.start}
        days={data.days}
        blocks={data.blocks}
        unscheduled={data.unscheduled}
        today={thisWeek}
        nowMinutes={now.minutes}
        googleReady={googleReady}
        missed={[...missed]}
      />
    </div>
  );
}

/** The week's study plan against its target: logged plus planned, and what is short, over or missed. */
function StudyLine({ study }: { study: StudyWeek }) {
  const h = (n: number) => `${formatHours(n)} h`;
  const status =
    study.target === null
      ? null
      : study.over
        ? `${h(study.over)} over`
        : study.short
          ? `${h(study.short)} still to place`
          : "covered";
  return (
    <p className="text-sm text-muted">
      Study:{" "}
      <span className="font-semibold text-bright tabular-nums">
        {h(study.logged)} logged + {h(study.toCome)} planned{study.target !== null && ` of ${h(study.target)}`}
      </span>
      {status && ` · ${status}`}
      {study.missed > 0 && ` · ${h(study.missed)} missed`}
    </p>
  );
}

function GoogleStatus({ google }: { google: Awaited<ReturnType<typeof loadScheduleWeek>>["google"] }) {
  if (google === "not-configured") {
    return <span className="text-sm text-muted">Google Calendar not set up</span>;
  }
  if (google === "not-connected") {
    return (
      <a href="/api/google/connect" className="btn-primary px-4 py-1.5">
        Connect Google Calendar
      </a>
    );
  }
  if ("error" in google) {
    return (
      <span className="flex items-center gap-3 text-sm text-coral">
        {google.error}
        <a href="/api/google/connect" className="btn-ghost px-4 py-1.5">
          Reconnect
        </a>
      </span>
    );
  }
  return (
    <form action={disconnectGoogle} className="flex items-center gap-3 text-sm text-muted">
      <span className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-mint" aria-hidden />
        Google Calendar{google.email ? `: ${google.email}` : ""}
      </span>
      <button className="cursor-pointer text-muted hover:text-white">Disconnect</button>
    </form>
  );
}
