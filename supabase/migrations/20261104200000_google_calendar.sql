-- The owner's Google Calendar connection, for life blocks (lunch, gym and so
-- on) that live in Google Calendar rather than Asana.
--
-- The refresh token is encrypted by the app (AES-256-GCM with GOOGLE_TOKEN_KEY,
-- a Vercel env var) before it reaches the database, so a database leak alone
-- does not give access to the calendar. Like the rest of the `portal` schema,
-- the table is unreachable from the API and the owner-only RPCs below are the
-- only way in:
--
--   set_google_connection(ciphertext, email)  store or replace the connection
--   google_connection()                       read it back (owner only)
--   clear_google_connection()                 forget it

create table portal.google_connections (
  account_id    uuid primary key references portal.members (account_id) on delete cascade,
  refresh_token text not null check (length(refresh_token) between 20 and 4000),
  google_email  text,
  connected_at  timestamptz not null default now()
);
comment on table portal.google_connections is
  'The owner''s Google Calendar refresh token, encrypted by the app. Changed only through the Google RPCs.';

alter table portal.google_connections enable row level security;
revoke all on table portal.google_connections from public, anon, authenticated;

create function public.set_google_connection(p_refresh_token text, p_google_email text)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can connect Google Calendar.' using errcode = '42501';
  end if;

  insert into portal.google_connections (account_id, refresh_token, google_email)
  values (auth.uid(), p_refresh_token, nullif(trim(p_google_email), ''))
  on conflict (account_id) do update
    set refresh_token = excluded.refresh_token,
        google_email  = excluded.google_email,
        connected_at  = now();
end;
$function$;

create function public.google_connection()
returns table (refresh_token text, google_email text, connected_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can read the Google connection.' using errcode = '42501';
  end if;

  return query
    select g.refresh_token, g.google_email, g.connected_at
    from portal.google_connections g
    where g.account_id = auth.uid();
end;
$function$;

create function public.clear_google_connection()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can disconnect Google Calendar.' using errcode = '42501';
  end if;

  delete from portal.google_connections where account_id = auth.uid();
end;
$function$;

revoke all on function public.set_google_connection(text, text) from public, anon;
revoke all on function public.google_connection() from public, anon;
revoke all on function public.clear_google_connection() from public, anon;
grant execute on function public.set_google_connection(text, text) to authenticated, service_role;
grant execute on function public.google_connection() to authenticated, service_role;
grant execute on function public.clear_google_connection() to authenticated, service_role;
