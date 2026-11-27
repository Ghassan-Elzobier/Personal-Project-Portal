-- Edit the details of a role you added yourself: its title, employer, place, link and
-- pay. "Add from the advert" saves a role in one tap, so a misread field must be
-- fixable afterwards. Only roles added by hand can change: a feed's next read
-- rewrites its own roles, so editing one of those would not last.
--
-- The app works out the role's family, seniority and location tier from the new
-- values (src/lib/jobs/classify.ts, extract.ts) and sends them with the change. Like
-- every job RPC, this takes no p_access_hash: the Claude connector has no route in.

create function public.tracker_edit_job_details(p_posting bigint, p_details jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  if not exists (select 1 from portal.job_postings p where p.gid = p_posting) then
    raise exception 'That role no longer exists.' using errcode = 'P0002';
  end if;

  update portal.job_postings p
     set title = case when p_details ? 'title' then trim(p_details ->> 'title') else p.title end,
         company = case when p_details ? 'company' then trim(p_details ->> 'company') else p.company end,
         location = case when p_details ? 'location' then trim(coalesce(p_details ->> 'location', '')) else p.location end,
         location_tier = case when p_details ? 'location_tier' then p_details ->> 'location_tier' else p.location_tier end,
         url = case when p_details ? 'url' then nullif(trim(coalesce(p_details ->> 'url', '')), '') else p.url end,
         salary = case when p_details ? 'salary' then nullif(trim(coalesce(p_details ->> 'salary', '')), '') else p.salary end,
         family = case when p_details ? 'family' then p_details ->> 'family' else p.family end,
         seniority = case when p_details ? 'seniority' then p_details ->> 'seniority' else p.seniority end
    from portal.job_sources s
   where p.gid = p_posting and s.gid = p.source_gid and s.kind = 'manual';

  if not found then
    raise exception 'Only a role you added yourself can be edited.' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function public.tracker_edit_job_details(bigint, jsonb) from public, anon;
grant execute on function public.tracker_edit_job_details(bigint, jsonb) to authenticated;
