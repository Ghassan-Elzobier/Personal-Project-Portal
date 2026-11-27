-- Claude's reading of the adverts the rules can't read (src/lib/jobs/ai-requirements.ts).
--
--   tracker_set_job_advert   keeps the advert of a role that arrived without one (a careers
--                            page lists only titles and links), once the owner has the portal
--                            read it from the role's pane, with the requirements read from it.
--   tracker_job_weak_adverts the open adverts whose rules reading is too weak to judge fit, a
--                            few at a time, for each check to give to Claude.
--   tracker_save_job_read    replaced from its definition in 20261105140000_job_tracker.sql
--                            with one change: Claude's reading stands while the advert's text
--                            is unchanged, so a feed's next read doesn't undo it.
--
-- A reading by Claude has extract_version 1000 or more, so the rules never read over it. Like
-- every job RPC, these take no p_access_hash: the Claude connector has no route in.

create function public.tracker_set_job_advert(p_posting bigint, p_advert jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  if trim(coalesce(p_advert ->> 'body', '')) = '' then
    raise exception 'There is no advert text to keep.' using errcode = '22023';
  end if;

  update portal.job_postings p
     set body = left(p_advert ->> 'body', 60000),
         family = coalesce(p_advert ->> 'family', p.family),
         seniority = coalesce(p_advert ->> 'seniority', p.seniority),
         requirements = coalesce(p_advert -> 'requirements', '[]'::jsonb),
         details = coalesce(p_advert -> 'details', '{}'::jsonb),
         extract_version = coalesce((p_advert ->> 'extract_version')::integer, 0)
   where p.gid = p_posting;

  if not found then
    raise exception 'That role no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.tracker_set_job_advert(bigint, jsonb) from public, anon;
grant execute on function public.tracker_set_job_advert(bigint, jsonb) to authenticated;

-- The same test as needsClaude in src/lib/jobs/ai-requirements.ts: an advert of 400 characters
-- or more whose rules reading has a line read from duties ("unstated"), or fewer than two
-- required groups, or fewer than three requirements. Read ones (1000 and up) never come back.
create function public.tracker_job_weak_adverts(p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((
    select jsonb_agg(jsonb_build_object('gid', x.gid::text, 'title', x.title, 'family', x.family, 'seniority', x.seniority,
      'body', x.body, 'requirements', x.requirements, 'details', x.details) order by x.first_seen_at desc, x.gid desc)
    from (
      select p.gid, p.title, p.family, p.seniority, p.body, p.requirements, p.details, p.first_seen_at
      from portal.job_postings p
      left join portal.job_tracking t on t.posting_gid = p.gid
      where p.closed_at is null
        and p.extract_version < 1000
        and length(p.body) >= 400
        and coalesce(t.stage, 'new') <> 'passed'
        and coalesce(t.interest, 1) <> 0
        and (
          exists (select 1 from jsonb_array_elements(p.requirements) r where r ->> 'level' = 'unstated')
          or (select count(distinct r ->> 'group') from jsonb_array_elements(p.requirements) r where r ->> 'level' = 'required') < 2
          or jsonb_array_length(p.requirements) < 3
        )
      order by p.first_seen_at desc, p.gid desc
      limit greatest(1, least(coalesce(p_limit, 8), 50))
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.tracker_job_weak_adverts(integer) from public, anon;
grant execute on function public.tracker_job_weak_adverts(integer) to authenticated;

create or replace function public.tracker_save_job_read(p_source bigint, p_ok boolean, p_error text, p_seen text[], p_postings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_added integer := 0;
  v_closed integer := 0;
  v_row jsonb;
  v_inserted boolean;
begin
  perform portal.require_task_owner(null);
  if not exists (select 1 from portal.job_sources s where s.gid = p_source) then
    raise exception 'That source no longer exists.' using errcode = 'P0002';
  end if;

  if not p_ok then
    update portal.job_sources set last_read_at = now(), last_error = left(coalesce(p_error, 'The read failed.'), 500) where gid = p_source;
    return jsonb_build_object('added', 0, 'closed', 0);
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_postings, '[]'::jsonb)) loop
    insert into portal.job_postings as p (
      source_gid, source_job_id, title, company, location, location_tier, url, posted_on, salary, family, seniority,
      body, requirements, details, extract_version
    )
    values (
      p_source, v_row ->> 'source_job_id', trim(v_row ->> 'title'), trim(v_row ->> 'company'), coalesce(v_row ->> 'location', ''),
      coalesce(v_row ->> 'location_tier', 'unknown'), nullif(v_row ->> 'url', ''), (v_row ->> 'posted_on')::date, nullif(v_row ->> 'salary', ''),
      coalesce(v_row ->> 'family', 'software'), coalesce(v_row ->> 'seniority', 'any'), left(coalesce(v_row ->> 'body', ''), 60000),
      coalesce(v_row -> 'requirements', '[]'::jsonb), coalesce(v_row -> 'details', '{}'::jsonb), coalesce((v_row ->> 'extract_version')::integer, 0)
    )
    on conflict (source_gid, source_job_id) do update set
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      location_tier = excluded.location_tier,
      url = excluded.url,
      posted_on = coalesce(excluded.posted_on, p.posted_on),
      salary = coalesce(excluded.salary, p.salary),
      family = excluded.family,
      seniority = excluded.seniority,
      -- A feed that lists roles without their text must not blank what we hold, and
      -- Claude's reading of an advert (extract_version 1000 and up) stands while the
      -- advert's text is unchanged; new text is read by the rules again.
      body = case when excluded.body = '' then p.body else excluded.body end,
      requirements = case when excluded.body = '' or (p.extract_version >= 1000 and excluded.body = p.body) then p.requirements else excluded.requirements end,
      details = case when excluded.body = '' or (p.extract_version >= 1000 and excluded.body = p.body) then p.details else excluded.details end,
      extract_version = case when excluded.body = '' or (p.extract_version >= 1000 and excluded.body = p.body) then p.extract_version else excluded.extract_version end
    returning (xmax = 0) into v_inserted;
    if v_inserted then
      v_added := v_added + 1;
    end if;
  end loop;

  if coalesce(cardinality(p_seen), 0) > 0 then
    update portal.job_postings
       set last_seen_at = now(), missed_reads = 0, closed_at = null
     where source_gid = p_source and source_job_id = any(p_seen);
    update portal.job_postings
       set missed_reads = missed_reads + 1
     where source_gid = p_source and closed_at is null and not (source_job_id = any(p_seen));
    with shut as (
      update portal.job_postings
         set closed_at = now()
       where source_gid = p_source and closed_at is null and missed_reads >= 2
      returning 1
    )
    select count(*) into v_closed from shut;
  end if;

  update portal.job_sources
     set last_read_at = now(), last_ok_at = now(), last_error = nullif(left(coalesce(p_error, ''), 500), ''), last_count = coalesce(cardinality(p_seen), last_count)
   where gid = p_source;
  return jsonb_build_object('added', v_added, 'closed', v_closed);
end;
$function$;
