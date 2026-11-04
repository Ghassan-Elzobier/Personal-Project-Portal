-- Who may use the portal, and which Asana projects each mentor may read.
--
-- Asana is the source of truth for study and project data, so the database
-- holds access only. It lives in its own schema, `portal`, which the Data API
-- does not expose and which grants nothing to the API roles, so its tables
-- cannot be read or written directly. SECURITY DEFINER functions in `public`
-- are the only way in, each checking the caller:
--
--   my_portal_access()                    the caller's own role and projects
--   portal_members()                      everyone with access (owner only)
--   grant_portal_mentor(email, name, ks)  make an account a mentor (owner only)
--   revoke_portal_member(id)              remove access; never the last owner
--
-- Roles are a fixed set. A new one is a new migration, because a role only
-- means something once code checks it. Project keys match lib/projects.ts.
-- Mentor names and emails live here, in the database, never in the repo.

create schema portal;
comment on schema portal is
  'Portal access. Not exposed by the Data API; reached only through the public portal RPCs.';
revoke all on schema portal from public, anon, authenticated;

create type portal.member_role as enum (
  'owner',   -- logs sessions, posts status updates, manages mentors
  'mentor'   -- reads progress for the projects granted to them
);

create type portal.project_key as enum (
  'pmpp',
  'axler',
  'rendering',
  'weekly-log'
);

create table portal.members (
  account_id   uuid primary key references auth.users (id) on delete cascade,
  role         portal.member_role not null,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  granted_by   uuid references auth.users (id) on delete set null,
  granted_at   timestamptz not null default now()
);
comment on table portal.members is
  'One row per account with portal access. Changed only through the portal RPCs, or by SQL for the first owner.';

create table portal.mentor_projects (
  account_id  uuid not null references portal.members (account_id) on delete cascade,
  project     portal.project_key not null,
  primary key (account_id, project)
);
comment on table portal.mentor_projects is
  'Projects a mentor may read. Owners read every project and need no rows here.';

alter table portal.members enable row level security;
alter table portal.mentor_projects enable row level security;
revoke all on table portal.members from public, anon, authenticated;
revoke all on table portal.mentor_projects from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

create function portal.is_owner(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from portal.members
    where account_id = p_account and role = 'owner'
  );
$function$;

revoke all on function portal.is_owner(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- The caller's role and readable projects. No row for anyone without access.
create function public.my_portal_access()
returns table (role text, display_name text, projects text[])
language sql
stable
security definer
set search_path to ''
as $function$
  select m.role::text,
         m.display_name,
         case
           when m.role = 'owner' then
             (select array_agg(k::text order by k) from unnest(enum_range(null::portal.project_key)) k)
           else
             coalesce(
               (select array_agg(p.project::text order by p.project)
                from portal.mentor_projects p
                where p.account_id = m.account_id),
               '{}')
         end
  from portal.members m
  where m.account_id = auth.uid();
$function$;

-- Everyone with access, for the owner only.
create function public.portal_members()
returns table (account_id uuid, email text, display_name text, role text, projects text[], since timestamptz)
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
    select m.account_id,
           u.email::text,
           m.display_name,
           m.role::text,
           coalesce(
             (select array_agg(p.project::text order by p.project)
              from portal.mentor_projects p
              where p.account_id = m.account_id),
             '{}'),
           m.granted_at
    from portal.members m
    join auth.users u on u.id = m.account_id
    order by m.role, lower(m.display_name);
end;
$function$;

-- Makes the account with this email a mentor for exactly these projects.
-- Calling it again for the same mentor replaces their name and projects.
-- Returns the account id.
create function public.grant_portal_mentor(p_email text, p_display_name text, p_projects text[])
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_account uuid;
  v_key     text;
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can change access.' using errcode = '42501';
  end if;

  if p_display_name is null or length(trim(p_display_name)) not between 1 and 80 then
    raise exception 'A name of 1 to 80 characters is required.' using errcode = '22023';
  end if;

  if p_projects is null or cardinality(p_projects) = 0 then
    raise exception 'Choose at least one project.' using errcode = '22023';
  end if;

  foreach v_key in array p_projects loop
    if v_key is null or v_key not in (select unnest(enum_range(null::portal.project_key))::text) then
      raise exception 'Unknown project: %', coalesce(v_key, 'null') using errcode = '22023';
    end if;
  end loop;

  select id into v_account
  from auth.users
  where lower(email) = lower(trim(p_email));
  if v_account is null then
    raise exception 'No account uses that email. Invite them from the Supabase dashboard first.' using errcode = 'P0002';
  end if;

  if portal.is_owner(v_account) then
    raise exception 'That account is the owner.' using errcode = 'P0001';
  end if;

  insert into portal.members (account_id, role, display_name, granted_by)
  values (v_account, 'mentor', trim(p_display_name), auth.uid())
  on conflict (account_id) do update
    set display_name = excluded.display_name;

  delete from portal.mentor_projects where account_id = v_account;
  insert into portal.mentor_projects (account_id, project)
  select v_account, k::portal.project_key
  from (select distinct unnest(p_projects) as k) s;

  return v_account;
end;
$function$;

-- Removes an account's access. The last owner cannot be removed, so the
-- portal can never be locked out of managing access.
create function public.revoke_portal_member(p_account_id uuid)
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

  if portal.is_owner(p_account_id)
     and (select count(*) from portal.members where role = 'owner') = 1 then
    raise exception 'This is the last owner.' using errcode = 'P0001';
  end if;

  delete from portal.members where account_id = p_account_id;
end;
$function$;

revoke all on function public.my_portal_access() from public, anon;
revoke all on function public.portal_members() from public, anon;
revoke all on function public.grant_portal_mentor(text, text, text[]) from public, anon;
revoke all on function public.revoke_portal_member(uuid) from public, anon;
grant execute on function public.my_portal_access() to authenticated, service_role;
grant execute on function public.portal_members() to authenticated, service_role;
grant execute on function public.grant_portal_mentor(text, text, text[]) to authenticated, service_role;
grant execute on function public.revoke_portal_member(uuid) to authenticated, service_role;
