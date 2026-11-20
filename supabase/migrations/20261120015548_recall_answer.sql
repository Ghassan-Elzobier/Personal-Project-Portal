-- A recall card can hold its own answer, so the owner checks what they recalled
-- against it before rating themselves. The tutor writes it when a session ends, in
-- its own words: the claim behind a question it chose, or what it said about a
-- check the owner got wrong. Cards from the book plans, cards added by hand and
-- every card made before this have none, and work as they did.
--
-- Safe with the code already running: the column is nullable, a review sent with
-- no answer is saved as before, and the snapshot only gains a field.

alter table portal.reviews
  add column answer text check (answer is null or length(trim(answer)) between 1 and 1000);

-- As before, and each review may now carry an answer: [{prompt, days, answer}].
create or replace function public.tutor_end_session(p_session bigint, p_status text, p_summary text, p_reviews jsonb, p_access_hash text default null)
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
      insert into portal.reviews (task_gid, kind, prompt, due_on, answer)
      values (v_session.task_gid, 'idea', v_review ->> 'prompt', current_date + (v_review ->> 'days')::integer,
              nullif(trim(v_review ->> 'answer'), ''))
      on conflict (task_gid, prompt) do update
        set retired_at = null, step = 0, due_on = least(excluded.due_on, coalesce(portal.reviews.due_on, excluded.due_on)),
            -- A card that comes back keeps the answer it had, unless this session gives a new one.
            answer = coalesce(excluded.answer, portal.reviews.answer);
      v_added := v_added + 1;
    end loop;
  end if;
  return v_added;
end;
$function$;

-- As before, and each review now says its answer, to the owner alone. A mentor
-- reads a shared project's questions as they always could; the answer is the
-- tutor's words to the owner (for a missed check, about the mistake), so a mentor
-- gets null there.
create or replace function public.tracker_study_snapshot(p_access_hash text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with readable as (select * from portal.readable_projects(p_access_hash) k),
       tasks as (select t.gid, t.project from portal.tasks t where t.project in (select r.k from readable r)),
       me as (select coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) as is_owner)
  select jsonb_build_object(
    'subtasks', coalesce(
      (select jsonb_agg(jsonb_build_object('gid', s.gid::text, 'task_gid', s.task_gid::text, 'name', s.name, 'done', s.done) order by s.position, s.gid)
       from portal.subtasks s where s.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'exercises', coalesce(
      (select jsonb_agg(jsonb_build_object('task_gid', e.task_gid::text, 'number', e.number, 'status', e.status, 'updated_at', e.updated_at))
       from portal.task_exercises e where e.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'reviews', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'gid', v.gid::text, 'task_gid', v.task_gid::text, 'kind', v.kind, 'prompt', v.prompt, 'step', v.step,
                'due_on', v.due_on, 'last_rating', v.last_rating, 'last_reviewed_at', v.last_reviewed_at,
                'answer', case when (select m.is_owner from me m) then v.answer end)
              order by v.due_on nulls last, v.gid)
       from portal.reviews v where v.retired_at is null and v.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'benchmarks', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'gid', b.gid::text, 'project', b.project::text, 'task_gid', b.task_gid::text, 'metric', b.metric,
                'value', b.value, 'unit', b.unit, 'scene', b.scene, 'gpu', b.gpu, 'commit_sha', b.commit_sha,
                'notes', b.notes, 'created_at', b.created_at)
              order by b.created_at, b.gid)
       from portal.benchmarks b where b.project in (select r.k from readable r)),
      '[]'::jsonb)
  );
$function$;
