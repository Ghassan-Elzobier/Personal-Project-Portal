-- The Claude connector: lets the owner's Claude app (claude.ai, desktop and
-- phone) read and change the portal through the MCP endpoint at /api/mcp.
--
-- Claude signs in with OAuth 2.1 and PKCE. The owner approves on
-- /oauth/authorize while signed in to the portal; that page stores a one-time
-- code, Claude swaps it for an access token (1 hour) and a refresh token
-- (30 days, rotated on every use). Only SHA-256 hashes of codes and tokens are
-- stored, so a database leak gives no working token.
--
-- The token endpoint and the MCP endpoint have no Supabase session (Claude
-- calls them, not the browser), so the redeem, refresh and session RPCs are
-- callable by anon. Each one needs the secret behind a stored hash, and the
-- account it acts for must still be the owner.
--
--   create_mcp_code(...)        owner, on the approve page
--   redeem_mcp_code(...)        anon, token endpoint: code + PKCE -> tokens
--   refresh_mcp_token(...)      anon, token endpoint: rotate tokens
--   mcp_session(access_hash)    anon, MCP endpoint: who is calling
--   mcp_connections()           owner: list connected apps
--   revoke_mcp_connections()    owner: disconnect every app

create table portal.mcp_codes (
  code_hash      text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  account_id     uuid not null references portal.members (account_id) on delete cascade,
  client_id      text not null check (length(client_id) between 1 and 200),
  client_name    text check (length(client_name) <= 200),
  redirect_uri   text not null check (length(redirect_uri) between 1 and 2000),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at     timestamptz not null default now() + interval '5 minutes'
);
comment on table portal.mcp_codes is
  'One-time OAuth codes for the Claude connector, hashed. Five minutes, single use.';

create table portal.mcp_tokens (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references portal.members (account_id) on delete cascade,
  client_id          text not null,
  client_name        text,
  access_hash        text not null unique check (access_hash ~ '^[0-9a-f]{64}$'),
  access_expires_at  timestamptz not null,
  refresh_hash       text not null unique check (refresh_hash ~ '^[0-9a-f]{64}$'),
  refresh_expires_at timestamptz not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);
comment on table portal.mcp_tokens is
  'Claude connector tokens, hashed. One row per connected app; refresh rotates both hashes.';

alter table portal.mcp_codes enable row level security;
alter table portal.mcp_tokens enable row level security;
revoke all on table portal.mcp_codes from public, anon, authenticated;
revoke all on table portal.mcp_tokens from public, anon, authenticated;

create function public.create_mcp_code(
  p_code_hash text,
  p_client_id text,
  p_client_name text,
  p_redirect_uri text,
  p_code_challenge text
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can connect Claude.' using errcode = '42501';
  end if;

  delete from portal.mcp_codes where expires_at < now();
  insert into portal.mcp_codes (code_hash, account_id, client_id, client_name, redirect_uri, code_challenge)
  values (p_code_hash, auth.uid(), p_client_id, nullif(trim(p_client_name), ''), p_redirect_uri, p_code_challenge);
end;
$function$;

-- PKCE S256: base64url(sha256(verifier)) must equal the stored challenge.
create function portal.pkce_matches(p_verifier text, p_challenge text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'
     and rtrim(translate(encode(pg_catalog.sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '+/', '-_'), '=')
         = p_challenge;
$function$;
revoke all on function portal.pkce_matches(text, text) from public, anon, authenticated;

create function public.redeem_mcp_code(
  p_code_hash text,
  p_code_verifier text,
  p_client_id text,
  p_redirect_uri text,
  p_access_hash text,
  p_refresh_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_code portal.mcp_codes;
begin
  -- Single use: the code is gone whether or not the rest checks out.
  delete from portal.mcp_codes where code_hash = p_code_hash returning * into v_code;

  if v_code.code_hash is null
     or v_code.expires_at < now()
     or v_code.client_id <> p_client_id
     or v_code.redirect_uri <> p_redirect_uri
     or not portal.pkce_matches(p_code_verifier, v_code.code_challenge)
     or not portal.is_owner(v_code.account_id) then
    return false;
  end if;

  insert into portal.mcp_tokens (
    account_id, client_id, client_name, access_hash, access_expires_at, refresh_hash, refresh_expires_at
  ) values (
    v_code.account_id, v_code.client_id, v_code.client_name,
    p_access_hash, now() + interval '1 hour', p_refresh_hash, now() + interval '30 days'
  );
  return true;
end;
$function$;

create function public.refresh_mcp_token(
  p_refresh_hash text,
  p_client_id text,
  p_access_hash text,
  p_new_refresh_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  update portal.mcp_tokens t
     set access_hash        = p_access_hash,
         access_expires_at  = now() + interval '1 hour',
         refresh_hash       = p_new_refresh_hash,
         refresh_expires_at = now() + interval '30 days'
   where t.refresh_hash = p_refresh_hash
     and t.client_id = p_client_id
     and t.refresh_expires_at > now()
     and portal.is_owner(t.account_id)
  returning t.id into v_id;
  return v_id is not null;
end;
$function$;

-- The caller behind an access token, with the Google connection the tools
-- need (the ciphertext only; the key is an app env var).
create function public.mcp_session(p_access_hash text)
returns table (account_id uuid, google_refresh_token text, google_email text, google_connected_at timestamptz)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_account uuid;
begin
  update portal.mcp_tokens t
     set last_used_at = now()
   where t.access_hash = p_access_hash
     and t.access_expires_at > now()
     and portal.is_owner(t.account_id)
  returning t.account_id into v_account;

  if v_account is null then
    return;
  end if;

  return query
    select v_account, g.refresh_token, g.google_email, g.connected_at
    from (select 1) one
    left join portal.google_connections g on g.account_id = v_account;
end;
$function$;

create function public.mcp_connections()
returns table (id uuid, client_name text, created_at timestamptz, last_used_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can see connected apps.' using errcode = '42501';
  end if;

  return query
    select t.id, t.client_name, t.created_at, t.last_used_at
    from portal.mcp_tokens t
    where t.account_id = auth.uid() and t.refresh_expires_at > now()
    order by t.created_at desc;
end;
$function$;

create function public.revoke_mcp_connections()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if not portal.is_owner(auth.uid()) then
    raise exception 'Only the owner can disconnect apps.' using errcode = '42501';
  end if;

  delete from portal.mcp_tokens where account_id = auth.uid();
  delete from portal.mcp_codes where account_id = auth.uid();
end;
$function$;

revoke all on function public.create_mcp_code(text, text, text, text, text) from public, anon;
revoke all on function public.redeem_mcp_code(text, text, text, text, text, text) from public;
revoke all on function public.refresh_mcp_token(text, text, text, text) from public;
revoke all on function public.mcp_session(text) from public;
revoke all on function public.mcp_connections() from public, anon;
revoke all on function public.revoke_mcp_connections() from public, anon;

grant execute on function public.create_mcp_code(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.redeem_mcp_code(text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.refresh_mcp_token(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.mcp_session(text) to anon, authenticated, service_role;
grant execute on function public.mcp_connections() to authenticated, service_role;
grant execute on function public.revoke_mcp_connections() to authenticated, service_role;
