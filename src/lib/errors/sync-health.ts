// Whether the scheduled bank sync is still running, as the error triage sees it.
// A refused secret, a missing key, crons switched off or a run Vercel never
// delivered leave no error and no sync row, so the triage watches the symptom
// instead: no good scheduled sync for SYNC_OVERDUE_HOURS while a bank is connected.
// It keeps one issue for that, found by its marker, and closes it once a sync works.
// Pure, so it is tested here; the query and gh calls are in scripts/error-triage.mjs.
//
// The repository is public: the issue carries durations, counts and error codes only.
import { SYNC_OVERDUE_HOURS, syncOverdue } from "../money/state.ts";

/** One row of SYNC_HEALTH_QUERY. */
export type SyncHealth = {
  /** A Lunch Flow connection exists and is not switched off. */
  connected: boolean;
  /** When it was connected, which counts as the start before the first good sync. */
  connected_at: string | null;
  /** When a scheduled sync last finished well. Owner and connect syncs don't count. */
  last_ok: string | null;
  /** Scheduled runs since then, and how many of them failed. */
  runs: number;
  failed: number;
  /** The newest of those runs' error codes, if any. */
  last_code: string | null;
};

/**
 * The newest good scheduled sync and what has happened since. A fixed string: the
 * triage runs it as postgres on production, and reads nothing else from these tables.
 */
export const SYNC_HEALTH_QUERY = `
with c as (
  select created_at from portal.bank_connections where provider = 'lunchflow' and status <> 'off'
), ok as (
  select max(finished_at) as at from portal.bank_sync_runs where trigger = 'schedule' and outcome = 'ok'
), since as (
  select r.outcome, r.error_code, r.started_at from portal.bank_sync_runs r, ok
  where r.trigger = 'schedule' and r.started_at > coalesce(ok.at, '-infinity')
)
select
  exists (select 1 from c) as connected,
  (select min(created_at) from c) as connected_at,
  (select at from ok) as last_ok,
  (select count(*)::int from since) as runs,
  (select count(*)::int from since where outcome = 'failed') as failed,
  (select error_code from since where error_code is not null order by started_at desc limit 1) as last_code
`;

export const SYNC_MARKER = "<!-- bank-sync-health -->";
export const SYNC_TITLE = "The scheduled bank sync has stopped";

const CODE = /^[A-Z0-9_]+$/;

/** The query's row, read strictly: anything unexpected becomes a safe default. */
export function syncHealthFrom(row: Record<string, unknown> | undefined): SyncHealth {
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const count = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const code = text(row?.last_code);
  return {
    connected: row?.connected === true,
    connected_at: text(row?.connected_at),
    last_ok: text(row?.last_ok),
    runs: count(row?.runs),
    failed: count(row?.failed),
    last_code: code && CODE.test(code) ? code : null,
  };
}

export type SyncAction = "file" | "update" | "close" | "none";

/** File the issue when the sync has stopped, keep it current while it stays stopped, close it once it works. */
export function decideSync(h: SyncHealth, now: Date, issueOpen: boolean): SyncAction {
  const stopped = h.connected && syncOverdue(h.last_ok, now, h.connected_at);
  if (stopped) return issueOpen ? "update" : "file";
  return issueOpen ? "close" : "none";
}

function hours(from: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 3_600_000));
}

export function syncIssueBody(h: SyncHealth, now: Date): string {
  const quiet = h.last_ok ?? h.connected_at;
  const since = quiet ? `${hours(quiet, now)} hours` : "unknown";
  return [
    SYNC_MARKER,
    `**Filed automatically by the error triage.** A bank is connected, but no scheduled sync has worked for ` +
      `more than ${SYNC_OVERDUE_HOURS} hours, so balances, the weekly amount and bill alerts are going out of date. ` +
      `This closes itself once a scheduled sync works again.`,
    "",
    "| | |",
    "| --- | --- |",
    `| No good scheduled sync for | ${since}${h.last_ok ? "" : " (none since connecting)"} |`,
    `| Scheduled runs since | ${h.runs} (${h.failed} failed) |`,
    `| Last error code | ${h.last_code ? `\`${h.last_code}\`` : "none"} |`,
    "",
    "No runs at all means the cron never reached the sync: check that Vercel's crons are on, and that " +
      "`CRON_SECRET` and `MONEY_SYNC_KEY` are set in Vercel (a refused secret or a missing key stops a run " +
      "before it is recorded). Runs that failed say why on the Money page.",
  ].join("\n");
}

export function syncClosedComment(h: SyncHealth): string {
  return h.connected ? "A scheduled bank sync worked again." : "No bank is connected any more.";
}
