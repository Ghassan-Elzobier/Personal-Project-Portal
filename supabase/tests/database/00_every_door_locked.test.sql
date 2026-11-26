-- Suite: every door is locked
--
-- The database rule (.claude/rules/database.md) for the whole schema at once,
-- read from the system catalogue, so a new table or function is checked
-- without anyone naming it:
--   1. every portal table has row level security on, and no portal relation
--      gives the API roles (anon, authenticated) any rights;
--   2. public holds no table, view or materialized view the API roles can use;
--   3. every public function the API roles can run is security definer with
--      search_path set to '';
--   4. the body of each of those calls a known guard, unless the allow-list
--      below names it with a reason.
-- Supabase's default privileges grant anon and authenticated EXECUTE on every
-- new public function, so a migration that forgets its guard is open at once.
-- Finding a guard call is a heuristic: the per-feature suites still check
-- what each function lets each caller do. This file only proves none is
-- missing its lock. The probes at the end show each check catching a breach.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Functions the API may run that need no guard call in their body. Every row
-- says why. Keep it short: each row is a door left open on purpose.
create temp table guard_allow_list (fn regprocedure primary key, why text not null check (why <> '')) on commit drop;
-- (empty: every callable function calls a guard today)

-- Calls that check or scope the caller. portal.require_* refuse anyone without
-- access; is_owner and auth.uid() decide on the signed-in account;
-- task_caller resolves a connector token to its account; readable_projects
-- narrows a read to the projects the caller may see (built on the two above).
create function pg_temp.calls_a_guard(p_fn regprocedure)
returns boolean
language sql
as $$
  select regexp_replace(pg_get_functiondef(p_fn), '--[^\n]*', '', 'g')
    ~* '(portal\.(require_[a-z_]+|is_owner|task_caller|readable_projects)\s*\(|auth\.uid\s*\(\s*\))';
$$;

-- Portal relations that break check 1, with what is wrong.
create function pg_temp.open_portal_relations()
returns table (rel regclass, problem text)
language sql
as $$
  select c.oid::regclass, 'row level security is off'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'portal' and c.relkind in ('r', 'p') and not c.relrowsecurity
  union all
  select c.oid::regclass, r.role || ' holds rights on it'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'portal' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.role, c.oid, 'select,insert,update,delete,truncate,references,trigger');
$$;

-- Public relations the API roles can use (check 2).
create function pg_temp.open_public_relations()
returns setof regclass
language sql
as $$
  select distinct c.oid::regclass
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege(r.role, c.oid, 'select,insert,update,delete,truncate,references,trigger');
$$;

-- Public functions the API roles can run.
create function pg_temp.api_functions()
returns setof regprocedure
language sql
as $$
  select f.oid::regprocedure
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname = 'public'
    and (has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute'));
$$;

-- Those that break check 3.
create function pg_temp.unlocked_functions()
returns setof regprocedure
language sql
as $$
  select a.fn
  from pg_temp.api_functions() a(fn) join pg_proc f on f.oid = a.fn
  where not (f.prosecdef and coalesce('search_path=""' = any(f.proconfig), false));
$$;

-- Those that break check 4.
create function pg_temp.unguarded_functions()
returns setof regprocedure
language sql
as $$
  select a.fn
  from pg_temp.api_functions() a(fn)
  where not pg_temp.calls_a_guard(a.fn)
    and a.fn not in (select fn from guard_allow_list);
$$;

-- ---------------------------------------------------------------------------
-- The schema as the migrations leave it
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from pg_temp.api_functions()) > 0,
  'Given the public schema, When its callable functions are listed, Then the checks below have functions to inspect');

select is(
  (select coalesce(string_agg(rel::text || ': ' || problem, '; ' order by rel::text, problem), '') from pg_temp.open_portal_relations()),
  '',
  'Given every portal table, When RLS and API rights are inspected, Then RLS is on and the API roles hold no rights');

select is(
  (select coalesce(string_agg(rel::text, ', ' order by rel::text), '') from pg_temp.open_public_relations() rel),
  '',
  'Given the public schema, When its tables and views are inspected, Then the API roles can use none of them');

select is(
  (select coalesce(string_agg(fn::text, ', ' order by fn::text), '') from pg_temp.unlocked_functions() fn),
  '',
  'Given every public function the API can run, When its settings are inspected, Then it is security definer with search_path ''''');

select is(
  (select coalesce(string_agg(fn::text, ', ' order by fn::text), '') from pg_temp.unguarded_functions() fn),
  '',
  'Given every public function the API can run, When its body is inspected, Then it calls a guard or is allow-listed with a reason');

-- ---------------------------------------------------------------------------
-- Each check catches a breach (all rolled back at the end)
-- ---------------------------------------------------------------------------

-- A function with its settings right but no guard: anyone could read the owner's data.
create function public.zz_probe_no_guard()
returns bigint
language sql
security definer
set search_path to ''
as $$ select count(*) from portal.members; $$;
grant execute on function public.zz_probe_no_guard() to anon;

-- A function that checks the owner but leaves search_path open.
create function public.zz_probe_no_search_path()
returns boolean
language sql
security definer
as $$ select portal.is_owner(auth.uid()); $$;
grant execute on function public.zz_probe_no_search_path() to anon;

-- A function whose only mention of a guard is in a comment.
create function public.zz_probe_guard_in_comment()
returns bigint
language sql
security definer
set search_path to ''
as $$
  -- portal.require_life_owner() is called elsewhere
  select count(*) from portal.members;
$$;

-- A portal table without RLS, and a public table the API can read.
create table portal.zz_probe_open (id int);
create table public.zz_probe_exposed (id int);

select is(
  (select array_agg(fn::text order by fn::text) from pg_temp.unguarded_functions() fn),
  array['zz_probe_guard_in_comment()', 'zz_probe_no_guard()'],
  'Given new functions open to the API with no guard call, When the guard check runs, Then it names each of them');

select is(
  (select array_agg(fn::text order by fn::text) from pg_temp.unlocked_functions() fn),
  array['zz_probe_no_search_path()'],
  'Given a new function open to the API with no search_path, When the settings check runs, Then it names it');

select ok(
  exists (select 1 from pg_temp.open_portal_relations() where rel = 'portal.zz_probe_open'::regclass and problem = 'row level security is off')
  and 'public.zz_probe_exposed'::regclass in (select * from pg_temp.open_public_relations()),
  'Given a portal table without RLS and a public table the API can read, When the table checks run, Then they name both');

select * from finish();
rollback;
