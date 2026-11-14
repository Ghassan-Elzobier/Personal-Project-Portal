-- Error tracking: production errors, grouped, for the factory to file and fix.
--
-- The portal reports each error it hits (src/lib/errors/), already scrubbed of
-- anything personal, because the triage workflow copies it into a public
-- GitHub issue. One row per bug: the fingerprint groups every occurrence.
--
--   report_error(...)         a portal member's session or connector token
--                             records an occurrence (the app, never a person)
--   portal.errors_to_triage() the groups GitHub has not heard about yet
--   portal.record_triage(...) what the triage did with one, and whether it
--                             handed the bug to Claude for a fix
--
-- The triage functions are not exposed: the release environment's workflow
-- runs them as postgres (`supabase db query --remote`). See docs/FACTORY.md.

create table portal.error_groups (
  fingerprint  text primary key check (fingerprint ~ '^[0-9a-f]{32}$'),
  source       text not null check (source in ('server', 'browser', 'connector')),
  name         text not null check (name ~ '^[A-Za-z_$][A-Za-z0-9_$.]{0,79}$'),
  message      text not null check (length(message) between 1 and 500),
  route        text not null check (route like '/%' and length(route) <= 200),
  context      text not null check (length(context) between 1 and 60),
  stack        text not null default '' check (length(stack) <= 4000),
  release      text check (release ~ '^[0-9a-f]{7,40}$'),
  occurrences  integer not null default 1 check (occurrences > 0),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  status       text not null default 'new' check (status in ('new', 'filed', 'ignored')),
  issue_number integer check (issue_number > 0),
  synced_at    timestamptz,
  autofix_at   timestamptz
);
comment on table portal.error_groups is
  'One row per production bug, scrubbed before it is stored. Written by report_error; read and updated by the triage workflow.';
comment on column portal.error_groups.synced_at is
  'When the triage last brought the GitHub issue up to date. Occurrences after it are news.';
comment on column portal.error_groups.autofix_at is
  'When the triage last handed the bug to Claude for a fix. Counts toward the daily limit.';

create index error_groups_first_seen on portal.error_groups (first_seen);

alter table portal.error_groups enable row level security;
revoke all on table portal.error_groups from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Records one occurrence for a portal member: from the browser session, or
-- from a connector call with its token's hash (portal.task_caller decides).
-- Returns 'new' for a new group, 'seen' for another occurrence, and 'dropped'
-- when 25 new groups have already arrived in the last day, so a flood of
-- distinct errors cannot fill the table or the issue list.
create function public.report_error(
  p_fingerprint text,
  p_source text,
  p_name text,
  p_message text,
  p_route text,
  p_context text,
  p_stack text,
  p_release text,
  p_access_hash text default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account uuid := portal.task_caller(p_access_hash);
begin
  if v_account is null or not exists (select 1 from portal.members m where m.account_id = v_account) then
    raise exception 'Only portal members can report errors.' using errcode = '42501';
  end if;

  update portal.error_groups g
  set occurrences = least(g.occurrences, 2147483646) + 1,
      last_seen = now(),
      release = coalesce(p_release, g.release),
      stack = case when coalesce(p_stack, '') <> '' then p_stack else g.stack end
  where g.fingerprint = p_fingerprint;
  if found then
    return 'seen';
  end if;

  if (select count(*) from portal.error_groups g where g.first_seen > now() - interval '1 day') >= 25 then
    return 'dropped';
  end if;

  insert into portal.error_groups (fingerprint, source, name, message, route, context, stack, release)
  values (p_fingerprint, p_source, p_name, p_message, p_route, p_context, coalesce(p_stack, ''), p_release)
  on conflict (fingerprint) do update
    set occurrences = least(portal.error_groups.occurrences, 2147483646) + 1,
        last_seen = now();
  return 'new';
end;
$function$;

revoke all on function public.report_error(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.report_error(text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triage (not callable through the API)
-- ---------------------------------------------------------------------------

-- New groups, and filed ones that happened again since the issue was last
-- updated. Ignored groups stay quiet. Oldest first, a batch at a time.
create function portal.errors_to_triage()
returns setof portal.error_groups
language sql
stable
set search_path to ''
as $function$
  select g.*
  from portal.error_groups g
  where g.status = 'new'
     or (g.status = 'filed' and g.last_seen > coalesce(g.synced_at, '-infinity'::timestamptz))
  order by g.first_seen
  limit 20;
$function$;

-- What the triage did: filed (with its issue) or ignored (the owner closed
-- the issue as not planned). Either way the group is up to date as of now.
-- p_autofix records that it was handed to Claude for a fix.
create function portal.record_triage(p_fingerprint text, p_status text, p_issue integer, p_autofix boolean default false)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  if p_status not in ('filed', 'ignored') then
    raise exception 'A triaged error is filed or ignored, not %.', p_status;
  end if;
  update portal.error_groups g
  set status = p_status,
      issue_number = coalesce(p_issue, g.issue_number),
      synced_at = now(),
      autofix_at = case when p_autofix then now() else g.autofix_at end
  where g.fingerprint = p_fingerprint;
  if not found then
    raise exception 'No error group %.', p_fingerprint;
  end if;
end;
$function$;

revoke all on function portal.errors_to_triage() from public, anon, authenticated;
revoke all on function portal.record_triage(text, text, integer, boolean) from public, anon, authenticated;
