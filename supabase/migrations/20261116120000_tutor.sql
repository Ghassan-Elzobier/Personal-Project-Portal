-- Tutor: sessions where Claude probes, plans and teaches one checked step at a
-- time, the answers (with confidence and reasoning), and the knowledge graph of
-- claims and the reasoning chains behind them. The owner's alone: mentors see none
-- of it. Claude's app teaches through the connector; the tables are what it saves.
--
--   tutor_sessions  one teach or practice session, optionally on a roadmap unit
--   tutor_answers   every probe, prediction, check, recall or practice attempt
--   tutor_claims    propositions taught, in the owner's own words
--   tutor_chains    premises that jointly imply a conclusion
--
-- A session on a unit can end by adding reviews, which join the existing recall
-- queue (portal.reviews). Nothing here holds book text.

create table portal.tutor_sessions (
  gid        bigint generated always as identity primary key,
  kind       text not null check (kind in ('teach', 'practice')),
  task_gid   bigint references portal.tasks (gid) on delete set null,
  goal       text not null check (length(trim(goal)) between 1 and 500),
  status     text not null default 'open' check (status in ('open', 'done', 'dropped')),
  plan       jsonb check (plan is null or (jsonb_typeof(plan) = 'object' and pg_column_size(plan) < 32768)),
  summary    text not null default '' check (length(summary) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tutor_sessions_task_idx on portal.tutor_sessions (task_gid, created_at desc);

create table portal.tutor_answers (
  gid         bigint generated always as identity primary key,
  session_gid bigint not null references portal.tutor_sessions (gid) on delete cascade,
  kind        text not null check (kind in ('probe', 'predict', 'check', 'recall', 'practice')),
  question    text not null check (length(trim(question)) between 1 and 1000),
  options     jsonb check (options is null or (jsonb_typeof(options) = 'array' and pg_column_size(options) < 8192)),
  answer      text not null default '' check (length(answer) <= 2000),
  dont_know   boolean not null default false,
  correct     boolean,
  confidence  smallint check (confidence is null or confidence between 0 and 100),
  thinking    text not null default '' check (length(thinking) <= 2000),
  feedback    text not null default '' check (length(feedback) <= 1000),
  created_at  timestamptz not null default now()
);
create index tutor_answers_session_idx on portal.tutor_answers (session_gid, gid);

create table portal.tutor_claims (
  gid         bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 120),
  statement   text not null check (length(trim(statement)) between 1 and 600),
  task_gid    bigint references portal.tasks (gid) on delete set null,
  session_gid bigint references portal.tutor_sessions (gid) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index tutor_claims_statement_idx on portal.tutor_claims (lower(statement));
create index tutor_claims_task_idx on portal.tutor_claims (task_gid);

-- Premises are kept sorted, so the same argument is one row however it was listed.
create table portal.tutor_chains (
  gid           bigint generated always as identity primary key,
  premise_gids  bigint[] not null check (cardinality(premise_gids) between 1 and 8),
  conclusion_gid bigint not null references portal.tutor_claims (gid) on delete cascade,
  session_gid   bigint references portal.tutor_sessions (gid) on delete set null,
  created_at    timestamptz not null default now(),
  unique (premise_gids, conclusion_gid)
);
create index tutor_chains_conclusion_idx on portal.tutor_chains (conclusion_gid);

do $$
declare t text;
begin
  foreach t in array array['tutor_sessions', 'tutor_answers', 'tutor_claims', 'tutor_chains'] loop
    execute format('alter table portal.%I enable row level security', t);
    execute format('revoke all on table portal.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

-- The owner, from the browser or with a live connector token. Nobody else.
create function portal.require_tutor_owner(p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can use the tutor.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_tutor_owner(text) from public, anon, authenticated;

-- An open session, or an error a person can act on.
create function portal.tutor_open_session(p_session bigint)
returns portal.tutor_sessions
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v portal.tutor_sessions;
begin
  select * into v from portal.tutor_sessions where gid = p_session;
  if not found then
    raise exception 'That tutor session does not exist.' using errcode = 'P0002';
  end if;
  if v.status <> 'open' then
    raise exception 'That tutor session is already closed.' using errcode = '22023';
  end if;
  return v;
end;
$function$;
revoke all on function portal.tutor_open_session(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

create function public.tutor_start_session(p_kind text, p_task bigint, p_goal text, p_access_hash text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_gid bigint;
begin
  perform portal.require_tutor_owner(p_access_hash);
  if p_task is not null and not exists (select 1 from portal.tasks t where t.gid = p_task) then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  insert into portal.tutor_sessions (kind, task_gid, goal) values (p_kind, p_task, p_goal)
  returning gid into v_gid;
  if p_task is not null then
    perform portal.mark_started(p_task);
  end if;
  return v_gid;
end;
$function$;

-- The plan is a map: nodes (id, label, status) and prerequisite edges [from, to].
-- Its shape is checked in src/lib/tutor/plan.ts; here only its size and type.
create function public.tutor_set_plan(p_session bigint, p_plan jsonb, p_access_hash text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_revision integer;
begin
  perform portal.require_tutor_owner(p_access_hash);
  perform portal.tutor_open_session(p_session);
  select coalesce((plan ->> 'revision')::integer, 0) + 1 into v_revision
    from portal.tutor_sessions where gid = p_session;
  update portal.tutor_sessions
     set plan = jsonb_set(p_plan, '{revision}', to_jsonb(v_revision)), updated_at = now()
   where gid = p_session;
  return v_revision;
end;
$function$;

create function public.tutor_record_answer(
  p_session bigint,
  p_kind text,
  p_question text,
  p_answer text,
  p_dont_know boolean,
  p_correct boolean,
  p_confidence integer,
  p_thinking text,
  p_feedback text,
  p_options jsonb,
  p_access_hash text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_gid bigint;
begin
  perform portal.require_tutor_owner(p_access_hash);
  perform portal.tutor_open_session(p_session);
  insert into portal.tutor_answers
    (session_gid, kind, question, options, answer, dont_know, correct, confidence, thinking, feedback)
  values
    (p_session, p_kind, p_question, p_options, coalesce(p_answer, ''), coalesce(p_dont_know, false), p_correct,
     case when coalesce(p_dont_know, false) then null else p_confidence end,
     coalesce(p_thinking, ''), coalesce(p_feedback, ''))
  returning gid into v_gid;
  update portal.tutor_sessions set updated_at = now() where gid = p_session;
  return v_gid;
end;
$function$;

-- p_claims: [{key, name, statement}]. p_chains: [{premises: [ref], conclusion: ref}]
-- where a ref is a key from p_claims or the gid of a claim saved earlier. A claim
-- already saved (same statement, ignoring case) keeps its row. Returns {key: gid}.
create function public.tutor_save_claims(p_session bigint, p_claims jsonb, p_chains jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_session portal.tutor_sessions;
  v_keys jsonb := '{}'::jsonb;
  v_claim jsonb;
  v_chain jsonb;
  v_gid bigint;
  v_ref text;
  v_premises bigint[];
  v_conclusion bigint;
begin
  perform portal.require_tutor_owner(p_access_hash);
  v_session := portal.tutor_open_session(p_session);

  for v_claim in select * from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    insert into portal.tutor_claims (name, statement, task_gid, session_gid)
    values (v_claim ->> 'name', v_claim ->> 'statement', v_session.task_gid, p_session)
    on conflict (lower(statement)) do nothing;
    select c.gid into v_gid from portal.tutor_claims c where lower(c.statement) = lower(v_claim ->> 'statement');
    v_keys := v_keys || jsonb_build_object(v_claim ->> 'key', v_gid);
  end loop;

  for v_chain in select * from jsonb_array_elements(coalesce(p_chains, '[]'::jsonb)) loop
    v_premises := '{}';
    for v_ref in select jsonb_array_elements_text(v_chain -> 'premises') loop
      v_gid := coalesce((v_keys ->> v_ref)::bigint, case when v_ref ~ '^\d+$' then v_ref::bigint end);
      if v_gid is null or not exists (select 1 from portal.tutor_claims c where c.gid = v_gid) then
        raise exception 'A chain names a claim that was not saved.' using errcode = '22023';
      end if;
      v_premises := v_premises || v_gid;
    end loop;
    v_ref := v_chain ->> 'conclusion';
    v_conclusion := coalesce((v_keys ->> v_ref)::bigint, case when v_ref ~ '^\d+$' then v_ref::bigint end);
    if v_conclusion is null or not exists (select 1 from portal.tutor_claims c where c.gid = v_conclusion) then
      raise exception 'A chain names a conclusion that was not saved.' using errcode = '22023';
    end if;
    if v_conclusion = any (v_premises) then
      raise exception 'A claim cannot be its own premise.' using errcode = '22023';
    end if;
    select array_agg(distinct x order by x) into v_premises from unnest(v_premises) as x;
    insert into portal.tutor_chains (premise_gids, conclusion_gid, session_gid)
    values (v_premises, v_conclusion, p_session)
    on conflict (premise_gids, conclusion_gid) do nothing;
  end loop;

  update portal.tutor_sessions set updated_at = now() where gid = p_session;
  return v_keys;
end;
$function$;

-- p_reviews: [{prompt, days}], added to the unit's recall queue when the session
-- is tied to one. A repeat of a prompt starts it again, never earlier than before.
-- Returns how many were added.
create function public.tutor_end_session(p_session bigint, p_status text, p_summary text, p_reviews jsonb, p_access_hash text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_session portal.tutor_sessions;
  v_review jsonb;
  v_added integer := 0;
begin
  perform portal.require_tutor_owner(p_access_hash);
  v_session := portal.tutor_open_session(p_session);
  update portal.tutor_sessions
     set status = p_status, summary = coalesce(p_summary, ''), updated_at = now()
   where gid = p_session;

  if v_session.task_gid is not null and p_status = 'done' then
    for v_review in select * from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb)) loop
      insert into portal.reviews (task_gid, kind, prompt, due_on)
      values (v_session.task_gid, 'idea', v_review ->> 'prompt', current_date + (v_review ->> 'days')::integer)
      on conflict (task_gid, prompt) do update
        set retired_at = null, step = 0, due_on = least(excluded.due_on, coalesce(portal.reviews.due_on, excluded.due_on));
      v_added := v_added + 1;
    end loop;
  end if;
  return v_added;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- With p_session: that session, its answers and what it taught. Otherwise the
-- latest sessions with their answer counts, and the claims and chains of the
-- given tasks (every claim when p_tasks is null).
create function public.tutor_read(p_session bigint, p_tasks bigint[], p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_tutor_owner(p_access_hash);

  if p_session is not null then
    if not exists (select 1 from portal.tutor_sessions where gid = p_session) then
      raise exception 'That tutor session does not exist.' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'session', (select jsonb_build_object('gid', s.gid::text, 'kind', s.kind, 'task_gid', s.task_gid::text, 'goal', s.goal,
                    'status', s.status, 'plan', s.plan, 'summary', s.summary, 'created_at', s.created_at, 'updated_at', s.updated_at)
                  from portal.tutor_sessions s where s.gid = p_session),
      'answers', coalesce((select jsonb_agg(jsonb_build_object('gid', a.gid::text, 'kind', a.kind, 'question', a.question,
                    'options', a.options, 'answer', a.answer, 'dont_know', a.dont_know, 'correct', a.correct,
                    'confidence', a.confidence, 'thinking', a.thinking, 'feedback', a.feedback, 'created_at', a.created_at) order by a.gid)
                  from portal.tutor_answers a where a.session_gid = p_session), '[]'),
      'claims', coalesce((select jsonb_agg(jsonb_build_object('gid', c.gid::text, 'name', c.name, 'statement', c.statement) order by c.gid)
                  from portal.tutor_claims c where c.session_gid = p_session), '[]'),
      'chains', coalesce((select jsonb_agg(jsonb_build_object('gid', h.gid::text, 'premises', to_jsonb(h.premise_gids), 'conclusion', h.conclusion_gid::text) order by h.gid)
                  from portal.tutor_chains h where h.session_gid = p_session), '[]')
    );
  end if;

  return jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
        select jsonb_build_object('gid', s.gid::text, 'kind', s.kind, 'task_gid', s.task_gid::text, 'goal', s.goal,
                 'status', s.status, 'summary', s.summary, 'created_at', s.created_at,
                 'answers', (select count(*) from portal.tutor_answers a where a.session_gid = s.gid),
                 'checked', (select count(*) from portal.tutor_answers a where a.session_gid = s.gid and a.correct is not null),
                 'correct', (select count(*) from portal.tutor_answers a where a.session_gid = s.gid and a.correct),
                 'confident_misses', (select count(*) from portal.tutor_answers a where a.session_gid = s.gid and a.correct = false and a.confidence >= 70)) as x
          from portal.tutor_sessions s
         where p_tasks is null or s.task_gid = any (p_tasks)
         order by s.created_at desc, s.gid desc limit 60) q), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('gid', c.gid::text, 'name', c.name, 'statement', c.statement,
                  'task_gid', c.task_gid::text, 'session_gid', c.session_gid::text) order by c.gid)
                from portal.tutor_claims c where p_tasks is null or c.task_gid = any (p_tasks)), '[]'),
    'chains', coalesce((select jsonb_agg(jsonb_build_object('gid', h.gid::text, 'premises', to_jsonb(h.premise_gids), 'conclusion', h.conclusion_gid::text) order by h.gid)
                from portal.tutor_chains h
                join portal.tutor_claims c on c.gid = h.conclusion_gid
               where p_tasks is null or c.task_gid = any (p_tasks)), '[]')
  );
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array[
    'tutor_start_session(text, bigint, text, text)',
    'tutor_set_plan(bigint, jsonb, text)',
    'tutor_record_answer(bigint, text, text, text, boolean, boolean, integer, text, text, jsonb, text)',
    'tutor_save_claims(bigint, jsonb, jsonb, text)',
    'tutor_end_session(bigint, text, text, jsonb, text)',
    'tutor_read(bigint, bigint[], text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
