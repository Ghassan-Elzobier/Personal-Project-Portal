import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { timeZone } from "@/lib/config/env";
import { loadScheduleWeek, resolveWeek } from "@/lib/portal/schedule";
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
  const data = await loadScheduleWeek(week, { showInvites });
  const keep = showInvites ? "&invites=show" : "";
  const googleReady = typeof data.google === "object" && "email" in data.google;
  const tz = timeZone();
  const now = zonedParts(clockNow(), tz);
  const thisWeek = dateIn(clockNow(), tz);
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
              className="text-sm text-neutral-400 hover:text-white"
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

      {note && <p className="rounded-xl bg-white/5 p-3 text-sm text-neutral-300">{note}</p>}
      {data.errors.map((e) => (
        <ErrorNote key={e} message={e} />
      ))}

      <WeekPlanner
        key={week.start}
        days={data.days}
        blocks={data.blocks}
        unscheduled={data.unscheduled}
        today={thisWeek}
        nowMinutes={now.minutes}
        googleReady={googleReady}
      />
    </div>
  );
}

function GoogleStatus({ google }: { google: Awaited<ReturnType<typeof loadScheduleWeek>>["google"] }) {
  if (google === "not-configured") {
    return <span className="text-sm text-neutral-400">Google Calendar not set up</span>;
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
    <form action={disconnectGoogle} className="flex items-center gap-3 text-sm text-neutral-400">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-mint" aria-hidden />
        Google Calendar{google.email ? `: ${google.email}` : ""}
      </span>
      <button className="cursor-pointer text-neutral-400 hover:text-white">Disconnect</button>
    </form>
  );
}
