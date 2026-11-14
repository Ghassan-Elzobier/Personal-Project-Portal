-- The errors page (/errors): the owner reads the production error groups and
-- their occurrences, and ignores or restores a bug. Test errors, sent from that
-- page to check the pipeline end to end, are never filed as GitHub issues.
--
--   error_list(p_show)              the owner's list: 'open' or 'ignored'
--   error_detail(p_fingerprint)     one bug, its daily counts and recent occurrences
--   set_error_ignored(fp, ignored)  ignore or restore a bug; the triage then closes
--                                   or reopens its GitHub issue
--   portal.errors_to_triage()       also returns what the page changed, and leaves
--                                   test errors out

-- ---------------------------------------------------------------------------
-- RPCs (owner only)
-- ---------------------------------------------------------------------------

create function portal.error_group_json(g portal.error_groups)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_build_object(
    'fingerprint', g.fingerprint,
    'source', g.source,
    'name', g.name,
    'message', g.message,
    'route', g.route,
    'context', g.context,
    'stack', g.stack,
    'release', g.release,
    'occurrences', g.occurrences,
    'first_seen', g.first_seen,
    'last_seen', g.last_seen,
    'status', g.status,
    'issue_number', g.issue_number,
    'daily', coalesce(
      (select jsonb_agg(jsonb_build_object('day', d.day, 'occurrences', d.occurrences) order by d.day)
       from portal.error_daily d where d.fingerprint = g.fingerprint),
      '[]'::jsonb)
  );
$function$;

revoke all on function portal.error_group_json(portal.error_groups) from public, anon, authenticated;

-- The bugs to show: open ones (new or filed) or ignored ones, most recent first.
create function public.error_list(p_show text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can see errors.' using errcode = '42501';
  end if;
  if p_show is null or p_show not in ('open', 'ignored') then
    raise exception 'Show open or ignored errors, not %.', coalesce(p_show, 'nothing') using errcode = '22023';
  end if;

  return jsonb_build_object(
    'errors', coalesce(
      (select jsonb_agg(portal.error_group_json(g) order by g.last_seen desc)
       from (
         select * from portal.error_groups e
         where (e.status = 'ignored') = (p_show = 'ignored')
         order by e.last_seen desc
         limit 200
       ) g),
      '[]'::jsonb),
    'open', (select count(*) from portal.error_groups e where e.status <> 'ignored'),
    'ignored', (select count(*) from portal.error_groups e where e.status = 'ignored')
  );
end;
$function$;

-- One bug with its daily counts and its last 30 occurrences, newest first.
create function public.error_detail(p_fingerprint text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_group portal.error_groups;
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can see errors.' using errcode = '42501';
  end if;
  select * into v_group from portal.error_groups g where g.fingerprint = p_fingerprint;
  if not found then
    return null;
  end if;

  return portal.error_group_json(v_group) || jsonb_build_object(
    'events', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'occurred_at', e.occurred_at,
                'release', e.release,
                'reporter', e.reporter,
                'browser', e.browser,
                'os', e.os,
                'device', e.device,
                'viewport', e.viewport,
                'breadcrumbs', e.breadcrumbs
              ) order by e.occurred_at desc, e.id desc)
       from portal.error_events e where e.fingerprint = p_fingerprint),
      '[]'::jsonb)
  );
end;
$function$;

-- Ignores a bug, or restores it to new (no issue yet) or filed. Either way the
-- triage brings its GitHub issue in line on its next run.
create function public.set_error_ignored(p_fingerprint text, p_ignored boolean)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status text;
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can ignore or restore errors.' using errcode = '42501';
  end if;
  update portal.error_groups g
  set status = case
        when p_ignored then 'ignored'
        when g.issue_number is null then 'new'
        else 'filed'
      end,
      synced_at = null
  where g.fingerprint = p_fingerprint
  returning g.status into v_status;
  if not found then
    raise exception 'There is no such error.' using errcode = 'P0002';
  end if;
  return v_status;
end;
$function$;

revoke all on function public.error_list(text) from public, anon;
revoke all on function public.error_detail(text) from public, anon;
revoke all on function public.set_error_ignored(text, boolean) from public, anon;
grant execute on function public.error_list(text) to authenticated;
grant execute on function public.error_detail(text) to authenticated;
grant execute on function public.set_error_ignored(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Triage
-- ---------------------------------------------------------------------------

-- New bugs; filed ones that happened again, or that the errors page restored;
-- and ignored ones whose issue the page wants closed. Never test errors.
create or replace function portal.errors_to_triage()
returns setof portal.error_groups
language sql
stable
set search_path to ''
as $function$
  select g.*
  from portal.error_groups g
  where g.context <> 'test'
    and (
      g.status = 'new'
      or (g.status = 'filed' and g.last_seen > coalesce(g.synced_at, '-infinity'::timestamptz))
      or (g.status = 'ignored' and g.synced_at is null and g.issue_number is not null)
    )
  order by g.first_seen
  limit 20;
$function$;
