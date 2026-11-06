-- What a mentor may see beyond their projects.
--
-- The roadmap follows the project grants mentors already have. The job hunt is more
-- personal, so it is shared with each mentor on its own switch, off until the owner
-- turns it on. Even then a mentor gets a summary built from a cut-down read: roles,
-- the skills they ask for, stages and evidence levels. Notes, next actions, the old
-- sheet's ratings, advert text, salaries and contacts never leave the database.

create table portal.mentor_shares (
  account_id uuid not null references portal.members (account_id) on delete cascade,
  share      text not null check (share in ('job-hunt')),
  granted_at timestamptz not null default now(),
  primary key (account_id, share)
);

alter table portal.mentor_shares enable row level security;
revoke all on table portal.mentor_shares from public, anon, authenticated;

-- What the caller may see. The owner sees everything.
create function public.my_mentor_shares()
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when portal.is_owner(auth.uid()) then array['job-hunt']
    else coalesce((select array_agg(s.share order by s.share) from portal.mentor_shares s where s.account_id = auth.uid()), '{}')
  end;
$function$;

-- For the People page: each mentor and what is shared with them.
create function public.portal_mentor_shares()
returns table (account_id uuid, shares text[])
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can see who has access.' using errcode = '42501';
  end if;
  return query
    select m.account_id, coalesce(array_agg(s.share order by s.share) filter (where s.share is not null), '{}')
    from portal.members m
    left join portal.mentor_shares s on s.account_id = m.account_id
    where m.role = 'mentor'
    group by m.account_id;
end;
$function$;

create function public.set_mentor_share(p_account uuid, p_share text, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can change access.' using errcode = '42501';
  end if;
  if not exists (select 1 from portal.members m where m.account_id = p_account and m.role = 'mentor') then
    raise exception 'That account is not a mentor.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into portal.mentor_shares (account_id, share) values (p_account, p_share) on conflict do nothing;
  else
    delete from portal.mentor_shares where account_id = p_account and share = p_share;
  end if;
end;
$function$;

-- The job hunt as a mentor may see it: no free text written by the owner, no advert
-- text, and requirements without their quotes. The app works out fit and the skills
-- gap from this the same way it does for the owner, so both see the same numbers.
create function public.tracker_mentor_job_source()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or not (
    portal.is_owner(v_caller)
    or exists (select 1 from portal.mentor_shares s where s.account_id = v_caller and s.share = 'job-hunt')
  ) then
    raise exception 'The job hunt is not shared with you.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'postings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gid', p.gid::text, 'title', p.title, 'company', p.company, 'location_tier', p.location_tier,
        'family', p.family, 'seniority', p.seniority, 'closed_at', p.closed_at,
        'stage', coalesce(t.stage, 'new'), 'interest', t.interest,
        'details', jsonb_build_object('years', p.details -> 'years', 'earlyCareer', p.details -> 'earlyCareer'),
        'requirements', coalesce((
          select jsonb_agg(jsonb_build_object('skill', r ->> 'skill', 'level', r ->> 'level', 'group', r -> 'group', 'quote', ''))
          from jsonb_array_elements(p.requirements) r
        ), '[]'::jsonb)
      ))
      from portal.job_postings p
      left join portal.job_tracking t on t.posting_gid = p.gid
      where p.closed_at is null or coalesce(t.stage, 'new') in ('applied', 'interview', 'offer', 'rejected')
    ), '[]'::jsonb),
    -- Evidence levels, with a link only for work that is already public.
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object('gid', e.gid::text, 'skill', e.skill, 'level', e.level,
        'note', case when e.level = 4 and e.url is not null then e.note else '' end,
        'url', case when e.level = 4 then e.url end))
      from portal.skill_evidence e
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', t.ref, 'done', t.completed, 'due_on', t.due_on,
        'solved', (select count(*) from portal.task_exercises x where x.task_gid = t.gid and x.status = 'solved'),
        'measured', exists (select 1 from portal.benchmarks b where b.task_gid = t.gid and b.commit_sha is not null)))
      from portal.tasks t
      where t.ref is not null
    ), '[]'::jsonb),
    'last_read', (select max(s.last_ok_at) from portal.job_sources s)
  );
end;
$function$;

-- Signed-in sessions only, so the Claude connector has no route in.
do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.my_mentor_shares()',
    'public.portal_mentor_shares()',
    'public.set_mentor_share(uuid, text, boolean)',
    'public.tracker_mentor_job_source()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$grants$;
