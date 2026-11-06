-- The job tracker: which roles exist, what they ask for and where you stand on each.
--
--   job_sources     employer boards and discovery feeds to read, plus careers pages
--                   to check by hand
--   job_postings    what a source said about a role. Facts only.
--   job_tracking    your side of a role: interest, stage, next action, notes
--   job_events      every stage change, so an application has a history
--   skill_evidence  evidence the study plans cannot see, such as work and old projects
--
-- Facts and opinions sit in separate tables so that reading a feed can never touch
-- what you decided. Everything here is the owner's alone: employers, ratings and
-- applications are private, so no mentor grant reaches these tables.
--
-- These RPCs take no p_access_hash, unlike the task RPCs, because they are not for
-- the Claude connector. An advert is untrusted text, and a Claude session that can
-- read one must not also hold the connector's write tools. Without a token path,
-- that holds whatever a client does.

create table portal.job_sources (
  gid             bigint generated always as identity primary key,
  -- 'link' is a careers page checked by hand, for employers with no feed we may read.
  kind            text not null check (kind in ('greenhouse', 'ashby', 'lever', 'workable', 'teamtailor', 'arbeitnow', 'rse', 'link', 'manual')),
  token           text not null check (token ~ '^[A-Za-z0-9_.-]{1,120}$'),
  name            text not null check (length(trim(name)) between 1 and 200),
  careers_url     text check (careers_url is null or careers_url ~ '^https?://'),
  active          boolean not null default true,
  last_read_at    timestamptz,
  last_ok_at      timestamptz,
  last_error      text check (last_error is null or length(last_error) <= 500),
  last_count      integer,
  last_checked_on date,
  created_at      timestamptz not null default now(),
  unique (kind, token)
);

create table portal.job_postings (
  gid             bigint generated always as identity primary key,
  source_gid      bigint not null references portal.job_sources (gid) on delete restrict,
  source_job_id   text not null check (length(source_job_id) between 1 and 200),
  title           text not null check (length(trim(title)) between 1 and 300),
  company         text not null check (length(trim(company)) between 1 and 200),
  location        text not null default '' check (length(location) <= 500),
  location_tier   text not null default 'unknown' check (location_tier in ('london', 'uk', 'remote', 'abroad', 'unknown')),
  url             text check (url is null or url ~ '^https?://'),
  posted_on       date,
  salary          text check (salary is null or length(salary) <= 200),
  family          text not null default 'software' check (length(family) <= 40),
  seniority       text not null default 'any' check (seniority in ('intern', 'junior', 'any', 'mid', 'senior', 'lead')),
  body            text not null default '' check (length(body) <= 60000),
  requirements    jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  details         jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  extract_version integer not null default 0,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  missed_reads    integer not null default 0,
  closed_at       timestamptz,
  unique (source_gid, source_job_id)
);
create index job_postings_open_idx on portal.job_postings (source_gid) where closed_at is null;

create table portal.job_tracking (
  posting_gid     bigint primary key references portal.job_postings (gid) on delete cascade,
  interest        smallint check (interest between 0 and 3),
  stage           text not null default 'new' check (stage in ('new', 'saved', 'applied', 'interview', 'offer', 'rejected', 'passed')),
  next_action     text not null default '' check (length(next_action) <= 300),
  next_action_on  date,
  notes           text not null default '' check (length(notes) <= 5000),
  -- The rating from the old spreadsheet. It never said what it measured, so it is kept
  -- for reference and does not count as interest.
  legacy_rating   smallint check (legacy_rating between 0 and 10),
  applied_on      date,
  updated_at      timestamptz not null default now()
);

create table portal.job_events (
  gid         bigint generated always as identity primary key,
  posting_gid bigint not null references portal.job_postings (gid) on delete cascade,
  stage       text not null,
  created_at  timestamptz not null default now()
);
create index job_events_posting_idx on portal.job_events (posting_gid, created_at);

create table portal.skill_evidence (
  gid        bigint generated always as identity primary key,
  skill      text not null check (skill ~ '^[a-z0-9-]{1,40}$'),
  -- 1 studied, 2 practised or built, 3 built and measured, 4 anyone can see it.
  level      smallint not null check (level between 1 and 4),
  note       text not null check (length(trim(note)) between 1 and 300),
  url        text check (url is null or url ~ '^https?://'),
  created_at timestamptz not null default now()
);
create index skill_evidence_skill_idx on portal.skill_evidence (skill);

alter table portal.job_sources enable row level security;
alter table portal.job_postings enable row level security;
alter table portal.job_tracking enable row level security;
alter table portal.job_events enable row level security;
alter table portal.skill_evidence enable row level security;
revoke all on table portal.job_sources, portal.job_postings, portal.job_tracking, portal.job_events, portal.skill_evidence
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------

create function public.tracker_job_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'gid', s.gid::text, 'kind', s.kind, 'token', s.token, 'name', s.name, 'careers_url', s.careers_url,
        'active', s.active, 'last_read_at', s.last_read_at, 'last_ok_at', s.last_ok_at, 'last_error', s.last_error,
        'last_count', s.last_count, 'last_checked_on', s.last_checked_on
      )
      order by s.name, s.gid
    )
    from portal.job_sources s
    where s.kind <> 'manual'
  ), '[]'::jsonb);
end;
$function$;

create function public.tracker_add_job_source(p_kind text, p_token text, p_name text, p_careers_url text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_gid bigint;
begin
  perform portal.require_task_owner(null);
  if p_kind = 'manual' then
    raise exception 'That kind of source is added for you.' using errcode = '22023';
  end if;
  insert into portal.job_sources (kind, token, name, careers_url)
  values (p_kind, trim(p_token), trim(p_name), nullif(trim(coalesce(p_careers_url, '')), ''))
  on conflict (kind, token) do update set active = true, name = excluded.name, careers_url = coalesce(excluded.careers_url, portal.job_sources.careers_url)
  returning gid into v_gid;
  return v_gid;
end;
$function$;

-- A source is paused, never deleted, because its postings may hold your applications.
create function public.tracker_update_job_source(p_gid bigint, p_active boolean default null, p_checked boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  update portal.job_sources
     set active = coalesce(p_active, active),
         last_checked_on = case when p_checked then current_date else last_checked_on end
   where gid = p_gid;
  if not found then
    raise exception 'That source no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading a feed
-- ---------------------------------------------------------------------------

-- Ids of roles whose text we already hold, so a feed that needs one request per
-- role is only asked about the new ones.
create function public.tracker_job_known_ids(p_source bigint)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((select array_agg(p.source_job_id) from portal.job_postings p where p.source_gid = p_source and p.body <> ''), '{}');
end;
$function$;

-- p_seen is every id in the feed, kept or not. Null means the read was partial.
-- A role only closes after two good reads in a row without it. A failed read, a
-- partial one or an empty one closes nothing, because each says more about the feed
-- than about the role.
create function public.tracker_save_job_read(p_source bigint, p_ok boolean, p_error text, p_seen text[], p_postings jsonb)
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
      -- A feed that lists roles without their text must not blank what we hold.
      body = case when excluded.body = '' then p.body else excluded.body end,
      requirements = case when excluded.body = '' then p.requirements else excluded.requirements end,
      details = case when excluded.body = '' then p.details else excluded.details end,
      extract_version = case when excluded.body = '' then p.extract_version else excluded.extract_version end
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

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Everything the pages need except the advert text. Closed roles drop off after a
-- month unless you were tracking them or they came from your old sheet.
create function public.tracker_job_postings()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'gid', p.gid::text, 'source_kind', s.kind, 'source_name', s.name, 'title', p.title, 'company', p.company,
        'location', p.location, 'location_tier', p.location_tier, 'url', p.url, 'posted_on', p.posted_on, 'salary', p.salary,
        'family', p.family, 'seniority', p.seniority, 'has_body', p.body <> '', 'requirements', p.requirements, 'details', p.details,
        'first_seen_at', p.first_seen_at, 'last_seen_at', p.last_seen_at, 'closed_at', p.closed_at,
        'interest', t.interest, 'stage', coalesce(t.stage, 'new'), 'next_action', coalesce(t.next_action, ''), 'next_action_on', t.next_action_on,
        'notes', coalesce(t.notes, ''), 'legacy_rating', t.legacy_rating, 'applied_on', t.applied_on
      )
      order by p.first_seen_at desc, p.gid desc
    )
    from portal.job_postings p
    join portal.job_sources s on s.gid = p.source_gid
    left join portal.job_tracking t on t.posting_gid = p.gid
    where p.closed_at is null or p.closed_at > now() - interval '30 days' or coalesce(t.stage, 'new') not in ('new', 'passed') or t.legacy_rating is not null
  ), '[]'::jsonb);
end;
$function$;

create function public.tracker_job_detail(p_gid bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_body text;
begin
  perform portal.require_task_owner(null);
  select p.body into v_body from portal.job_postings p where p.gid = p_gid;
  if not found then
    raise exception 'That role no longer exists.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'body', v_body,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('stage', e.stage, 'created_at', e.created_at) order by e.created_at, e.gid)
      from portal.job_events e where e.posting_gid = p_gid
    ), '[]'::jsonb)
  );
end;
$function$;

-- Postings read by an older version of the reader, so better rules reach old adverts
-- without asking any feed again.
create function public.tracker_job_stale_extractions(p_version integer, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((
    select jsonb_agg(jsonb_build_object('gid', x.gid::text, 'title', x.title, 'source_kind', x.kind, 'location_tier', x.location_tier, 'body', x.body))
    from (
      select p.gid, p.title, s.kind, p.location_tier, p.body
      from portal.job_postings p
      join portal.job_sources s on s.gid = p.source_gid
      where p.extract_version < p_version and p.body <> ''
      order by p.gid
      limit p_limit
    ) x
  ), '[]'::jsonb);
end;
$function$;

-- p_items: [{gid, family, seniority, requirements, details, extract_version}]
create function public.tracker_set_job_extractions(p_items jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  update portal.job_postings p
     set family = i ->> 'family',
         seniority = i ->> 'seniority',
         requirements = i -> 'requirements',
         details = i -> 'details',
         extract_version = (i ->> 'extract_version')::integer
    from jsonb_array_elements(p_items) i
   where p.gid = (i ->> 'gid')::bigint;
end;
$function$;

-- p_patch holds only what changed. A key that is present and null clears the field.
create function public.tracker_set_job_tracking(p_posting bigint, p_patch jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_before text;
  v_after text;
begin
  perform portal.require_task_owner(null);
  if not exists (select 1 from portal.job_postings p where p.gid = p_posting) then
    raise exception 'That role no longer exists.' using errcode = 'P0002';
  end if;
  insert into portal.job_tracking (posting_gid) values (p_posting) on conflict (posting_gid) do nothing;
  select t.stage into v_before from portal.job_tracking t where t.posting_gid = p_posting;

  update portal.job_tracking t
     set interest = case when p_patch ? 'interest' then (p_patch ->> 'interest')::smallint else t.interest end,
         stage = case when p_patch ? 'stage' then p_patch ->> 'stage' else t.stage end,
         next_action = case when p_patch ? 'next_action' then trim(coalesce(p_patch ->> 'next_action', '')) else t.next_action end,
         next_action_on = case when p_patch ? 'next_action_on' then (p_patch ->> 'next_action_on')::date else t.next_action_on end,
         notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else t.notes end,
         legacy_rating = case when p_patch ? 'legacy_rating' then (p_patch ->> 'legacy_rating')::smallint else t.legacy_rating end,
         updated_at = now()
   where t.posting_gid = p_posting
  returning t.stage into v_after;

  if v_after is distinct from v_before then
    insert into portal.job_events (posting_gid, stage) values (p_posting, v_after);
    if v_after = 'applied' then
      update portal.job_tracking set applied_on = coalesce(applied_on, current_date) where posting_gid = p_posting;
    end if;
  end if;
end;
$function$;

-- A role typed or pasted in: a recruiter's message, a referral, or a site with no feed.
create function public.tracker_add_job_by_hand(p_posting jsonb, p_tracking jsonb default '{}'::jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_source bigint;
  v_gid bigint;
begin
  perform portal.require_task_owner(null);
  insert into portal.job_sources (kind, token, name) values ('manual', 'manual', 'Added by hand')
  on conflict (kind, token) do update set name = excluded.name
  returning gid into v_source;

  insert into portal.job_postings (
    source_gid, source_job_id, title, company, location, location_tier, url, salary, family, seniority, body, requirements, details, extract_version, closed_at
  )
  values (
    v_source, gen_random_uuid()::text, trim(p_posting ->> 'title'), trim(p_posting ->> 'company'), coalesce(p_posting ->> 'location', ''),
    coalesce(p_posting ->> 'location_tier', 'unknown'), nullif(p_posting ->> 'url', ''), nullif(p_posting ->> 'salary', ''),
    coalesce(p_posting ->> 'family', 'software'), coalesce(p_posting ->> 'seniority', 'any'), left(coalesce(p_posting ->> 'body', ''), 60000),
    coalesce(p_posting -> 'requirements', '[]'::jsonb), coalesce(p_posting -> 'details', '{}'::jsonb), coalesce((p_posting ->> 'extract_version')::integer, 0),
    (p_posting ->> 'closed_at')::timestamptz
  )
  returning gid into v_gid;

  perform public.tracker_set_job_tracking(v_gid, coalesce(p_tracking, '{}'::jsonb) || case when p_tracking ? 'stage' then '{}'::jsonb else '{"stage": "saved"}'::jsonb end);
  return v_gid;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

create function public.tracker_skill_evidence()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  return coalesce((
    select jsonb_agg(jsonb_build_object('gid', e.gid::text, 'skill', e.skill, 'level', e.level, 'note', e.note, 'url', e.url) order by e.skill, e.level desc, e.gid)
    from portal.skill_evidence e
  ), '[]'::jsonb);
end;
$function$;

create function public.tracker_add_skill_evidence(p_skill text, p_level integer, p_note text, p_url text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  insert into portal.skill_evidence (skill, level, note, url)
  values (p_skill, p_level, trim(p_note), nullif(trim(coalesce(p_url, '')), ''));
end;
$function$;

create function public.tracker_delete_skill_evidence(p_gid bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(null);
  delete from portal.skill_evidence where gid = p_gid;
end;
$function$;

-- Signed-in sessions only. Anonymous callers, and so the connector, have no route in.
do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.tracker_job_sources()',
    'public.tracker_add_job_source(text, text, text, text)',
    'public.tracker_update_job_source(bigint, boolean, boolean)',
    'public.tracker_job_known_ids(bigint)',
    'public.tracker_save_job_read(bigint, boolean, text, text[], jsonb)',
    'public.tracker_job_postings()',
    'public.tracker_job_detail(bigint)',
    'public.tracker_job_stale_extractions(integer, integer)',
    'public.tracker_set_job_extractions(jsonb)',
    'public.tracker_set_job_tracking(bigint, jsonb)',
    'public.tracker_add_job_by_hand(jsonb, jsonb)',
    'public.tracker_skill_evidence()',
    'public.tracker_add_skill_evidence(text, integer, text, text)',
    'public.tracker_delete_skill_evidence(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$grants$;
