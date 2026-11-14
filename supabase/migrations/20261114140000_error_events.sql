-- Error tracking, part two: every occurrence, not only the count.
--
-- portal.error_groups keeps one row per bug (20261114120000_error_tracking.sql).
-- Now each occurrence is kept as well, as Sentry keeps events: when, on which
-- release and device, who hit it (decided here, not by the browser), the
-- symbolicated stack, and the breadcrumbs that led up to it. Everything is
-- scrubbed before it arrives (src/lib/errors/). The last 30 occurrences of each
-- bug and 90 days of daily counts are kept.
--
--   record_error(...)               a member's session or connector token records
--                                   an occurrence. It replaces report_error,
--                                   which stays until no deployment calls it.
--   portal.latest_error_event(fp)   the newest occurrence, for the triage's issues

create table portal.error_events (
  id           bigint generated always as identity primary key,
  fingerprint  text not null references portal.error_groups (fingerprint) on delete cascade,
  occurred_at  timestamptz not null default now(),
  release      text check (release ~ '^[0-9a-f]{7,40}$'),
  reporter     text not null check (reporter in ('owner', 'mentor', 'connector')),
  browser      text check (length(browser) <= 40),
  os           text check (length(os) <= 40),
  device       text not null default 'unknown' check (device in ('phone', 'tablet', 'desktop', 'unknown')),
  viewport     text check (viewport ~ '^\d{2,5}x\d{2,5}$'),
  stack        text not null default '' check (length(stack) <= 4000),
  breadcrumbs  jsonb not null default '[]'::jsonb check (
    jsonb_typeof(breadcrumbs) = 'array'
    and jsonb_array_length(breadcrumbs) <= 30
    and length(breadcrumbs::text) <= 16000
  )
);
comment on table portal.error_events is
  'One row per occurrence of a bug in portal.error_groups, scrubbed. The last 30 per bug, for 90 days.';

create index error_events_by_group on portal.error_events (fingerprint, occurred_at desc, id desc);
create index error_events_by_time on portal.error_events (occurred_at);

create table portal.error_daily (
  fingerprint text not null references portal.error_groups (fingerprint) on delete cascade,
  day         date not null,
  occurrences integer not null default 1 check (occurrences > 0),
  primary key (fingerprint, day)
);
comment on table portal.error_daily is
  'Occurrences of each bug per day (UTC), for trends. 90 days are kept.';

alter table portal.error_events enable row level security;
alter table portal.error_daily enable row level security;
revoke all on table portal.error_events, portal.error_daily from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- The group half of an occurrence: count it, or start a new group unless 25
-- new ones have already arrived today. Returns 'seen', 'new' or 'dropped'.
create function portal.upsert_error_group(
  p_fingerprint text,
  p_source text,
  p_name text,
  p_message text,
  p_route text,
  p_context text,
  p_stack text,
  p_release text
)
returns text
language plpgsql
set search_path to ''
as $function$
begin
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

revoke all on function portal.upsert_error_group(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;

-- The newest occurrence of a bug (none if it has none yet).
create function portal.latest_error_event(p_fingerprint text)
returns setof portal.error_events
language sql
stable
set search_path to ''
as $function$
  select e.*
  from portal.error_events e
  where e.fingerprint = p_fingerprint
  order by e.occurred_at desc, e.id desc
  limit 1;
$function$;

revoke all on function portal.latest_error_event(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Records one occurrence for a portal member, from the browser session or a
-- connector call with its token's hash (portal.task_caller decides). Who hit it
-- is the member's role, or 'connector'. Returns what portal.upsert_error_group
-- did; a dropped occurrence keeps no event either.
create function public.record_error(
  p_fingerprint text,
  p_source text,
  p_name text,
  p_message text,
  p_route text,
  p_context text,
  p_stack text,
  p_release text,
  p_browser text,
  p_os text,
  p_device text,
  p_viewport text,
  p_breadcrumbs jsonb,
  p_access_hash text default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account uuid := portal.task_caller(p_access_hash);
  v_role text;
  v_result text;
begin
  select m.role::text into v_role from portal.members m where m.account_id = v_account;
  if v_account is null or v_role is null then
    raise exception 'Only portal members can report errors.' using errcode = '42501';
  end if;

  v_result := portal.upsert_error_group(
    p_fingerprint, p_source, p_name, p_message, p_route, p_context, p_stack, p_release
  );
  if v_result = 'dropped' then
    return v_result;
  end if;

  insert into portal.error_events (fingerprint, release, reporter, browser, os, device, viewport, stack, breadcrumbs)
  values (
    p_fingerprint,
    p_release,
    case when p_access_hash is null then v_role else 'connector' end,
    p_browser,
    p_os,
    coalesce(p_device, 'unknown'),
    p_viewport,
    coalesce(p_stack, ''),
    coalesce(p_breadcrumbs, '[]'::jsonb)
  );

  insert into portal.error_daily (fingerprint, day)
  values (p_fingerprint, (now() at time zone 'utc')::date)
  on conflict (fingerprint, day) do update
    set occurrences = least(portal.error_daily.occurrences, 2147483646) + 1;

  -- Keep the last 30 occurrences of this bug, and 90 days of everything.
  delete from portal.error_events e
  where e.fingerprint = p_fingerprint
    and e.id not in (
      select k.id from portal.error_events k
      where k.fingerprint = p_fingerprint
      order by k.occurred_at desc, k.id desc
      limit 30
    );
  delete from portal.error_events e where e.occurred_at < now() - interval '90 days';
  delete from portal.error_daily d where d.day < (now() at time zone 'utc')::date - 90;

  return v_result;
end;
$function$;

revoke all on function public.record_error(
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text
) from public;
grant execute on function public.record_error(
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text
) to anon, authenticated;
