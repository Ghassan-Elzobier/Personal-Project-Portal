-- Money, part 1: the bank connection and its balance. The owner's alone: mentors are
-- never granted any of it, and none of it reaches the Claude connector yet (its own
-- RPCs, held to an access level the owner sets, come with the categories).
--
--   money_settings    one row: the buffer, the payday fallback, Claude's access level
--   bank_connections  where bank data comes from: Lunch Flow, or uploaded statements
--   bank_accounts     the accounts picked from the feed, with the last 4 digits only
--   bank_balances     each balance that differs from the one before it
--   bank_sync_runs    one row per sync: why it ran and how it ended, as codes only
--   job_keys          sha256 of the keys that jobs without a browser session use, by scope
--
-- The Lunch Flow key lives in Vercel only, never here. Amounts are signed pence
-- (money out is negative). Nothing here is logged or put into an error message:
-- production errors become public issues.

create table portal.money_settings (
  id            boolean primary key default true check (id),
  buffer_pence  bigint not null default 0 check (buffer_pence between 0 and 10000000),
  buffer_from   date,
  payday_rule   text not null default 'last-working-day'
                  check (payday_rule = 'last-working-day' or payday_rule ~ '^day-([1-9]|[12][0-9]|3[01])$'),
  claude_access text not null default 'setup' check (claude_access in ('off', 'summary', 'plan', 'setup')),
  updated_at    timestamptz not null default now()
);
insert into portal.money_settings (id) values (true);

create table portal.bank_connections (
  id           bigint generated always as identity primary key,
  provider     text not null check (provider in ('lunchflow', 'statement')),
  -- stale: nothing new for 3 days, so the feed may need reconfirming in Lunch Flow.
  status       text not null check (status in ('active', 'stale', 'off')),
  last_data_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index bank_connections_provider_idx on portal.bank_connections (provider);

create table portal.bank_accounts (
  id            bigint generated always as identity primary key,
  connection_id bigint not null references portal.bank_connections (id) on delete cascade,
  provider_uid  text not null unique check (length(provider_uid) between 1 and 200),
  -- The bank's own names carry the sort code and account number, so the portal names
  -- the account by its type and keeps only the last 4 digits.
  name          text not null check (length(trim(name)) between 1 and 60),
  kind          text not null check (kind in ('current', 'savings', 'credit-card', 'other')),
  last4         text check (last4 ~ '^[0-9]{4}$'),
  currency      text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  in_safe       boolean not null default true,
  hidden        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table portal.bank_balances (
  account_id bigint not null references portal.bank_accounts (id) on delete cascade,
  at         timestamptz not null,
  kind       text not null check (kind in ('available', 'booked', 'expected')),
  pence      bigint not null check (abs(pence) < 100000000000),
  primary key (account_id, at, kind)
);

create table portal.bank_sync_runs (
  id            bigint generated always as identity primary key,
  connection_id bigint not null references portal.bank_connections (id) on delete cascade,
  trigger       text not null check (trigger in ('schedule', 'owner', 'connect')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  outcome       text not null default 'running'
                  check (outcome in ('running', 'ok', 'skipped', 'rate-limited', 'failed')),
  error_code    text check (error_code ~ '^[A-Z0-9_]{1,60}$'),
  booked_new    integer not null default 0,
  pending_now   integer not null default 0
);
create unique index bank_sync_runs_running_idx on portal.bank_sync_runs (connection_id) where outcome = 'running';
create index bank_sync_runs_started_idx on portal.bank_sync_runs (started_at desc);

-- Each key has one scope, so a key for one job can never do another's.
create table portal.job_keys (
  key_hash     text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  scope        text not null check (scope in ('bank-sync', 'trolley')),
  label        text not null check (length(label) between 1 and 60),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['money_settings', 'bank_connections', 'bank_accounts', 'bank_balances',
                           'bank_sync_runs', 'job_keys'] loop
    execute format('alter table portal.%I enable row level security', t);
    execute format('revoke all on table portal.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- The owner, from a browser session. It takes no connector token, so the Claude
-- connector can never pass it.
create function portal.require_money_owner()
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(auth.uid()), false) then
    raise exception 'Only the owner can use Money.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_money_owner() from public, anon, authenticated;

-- A job's key for one scope, or with no key the owner's session. The key is hashed
-- here, so a copy of the database holds no usable key.
create function portal.require_job(p_key text, p_scope text)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if p_key is null then
    perform portal.require_money_owner();
    return;
  end if;
  update portal.job_keys
  set last_used_at = now()
  where key_hash = encode(pg_catalog.sha256(convert_to(p_key, 'UTF8')), 'hex') and scope = p_scope;
  if not found then
    raise exception 'That key is not allowed here.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_job(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The owner
-- ---------------------------------------------------------------------------

-- The settings, the Lunch Flow connection and its accounts with their latest
-- balance, and how the syncs are going.
create function public.money_read()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_ok timestamptz;
  v_ok_run bigint;
begin
  perform portal.require_money_owner();
  select max(finished_at), max(id) into v_ok, v_ok_run from portal.bank_sync_runs where outcome = 'ok';
  return jsonb_build_object(
    'settings', (select jsonb_build_object('buffer_pence', buffer_pence, 'buffer_from', buffer_from,
                   'payday_rule', payday_rule, 'claude_access', claude_access) from portal.money_settings where id),
    'connection', (select jsonb_build_object('provider', provider, 'status', status, 'last_data_at', last_data_at,
                     'created_at', created_at) from portal.bank_connections where provider = 'lunchflow'),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'last4', a.last4,
               'currency', a.currency, 'in_safe', a.in_safe, 'hidden', a.hidden,
               'balance', (select jsonb_build_object('pence', b.pence, 'at', b.at, 'kind', b.kind)
                           from portal.bank_balances b where b.account_id = a.id order by b.at desc limit 1))
             order by a.id)
      from portal.bank_accounts a join portal.bank_connections c on c.id = a.connection_id
      where c.provider = 'lunchflow'), '[]'),
    'last_sync', (select jsonb_build_object('trigger', trigger, 'started_at', started_at, 'finished_at', finished_at,
                    'outcome', outcome, 'error_code', error_code)
                  from portal.bank_sync_runs order by started_at desc, id desc limit 1),
    'last_ok', v_ok,
    -- Failures in a row since the last good sync (run ids only ever grow).
    'failures', (select count(*) from portal.bank_sync_runs where outcome = 'failed' and id > coalesce(v_ok_run, 0))
  );
end;
$function$;

-- Turns the Lunch Flow connection on with the accounts picked from its list:
-- [{uid, name, kind, last4, currency}]. Matched by Lunch Flow's id, so connecting
-- again keeps the history. Accounts not picked this time are hidden, not deleted.
create function public.money_connect(p_accounts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_conn bigint;
  v jsonb;
  v_id bigint;
  v_ids bigint[] := '{}';
begin
  perform portal.require_money_owner();
  if jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts) not between 1 and 10 then
    raise exception 'Pick at least one account.' using errcode = '22023';
  end if;
  insert into portal.bank_connections (provider, status) values ('lunchflow', 'active')
  on conflict (provider) do update set status = 'active', updated_at = now()
  returning id into v_conn;
  for v in select * from jsonb_array_elements(p_accounts) loop
    insert into portal.bank_accounts (connection_id, provider_uid, name, kind, last4, currency)
    values (v_conn, v->>'uid', v->>'name', coalesce(v->>'kind', 'current'), nullif(v->>'last4', ''),
            coalesce(v->>'currency', 'GBP'))
    on conflict (provider_uid) do update
      set connection_id = excluded.connection_id,
          hidden = false,
          last4 = coalesce(excluded.last4, portal.bank_accounts.last4)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  update portal.bank_accounts set hidden = true where connection_id = v_conn and not (id = any (v_ids));
  return to_jsonb(v_ids);
end;
$function$;

-- The connection goes off; the history stays. The key itself is deleted in Lunch Flow.
create function public.money_disconnect()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  update portal.bank_connections set status = 'off', updated_at = now() where provider = 'lunchflow';
end;
$function$;

-- Erase all bank data: connections, accounts, balances and syncs. Settings and job
-- keys stay, as they hold no bank data.
create function public.money_forget_all()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  delete from portal.bank_connections where true;
end;
$function$;

-- Adds or replaces the key for a scope: its sha256, worked out on the server.
create function public.job_key_set(p_hash text, p_scope text, p_label text)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'That is not a key hash.' using errcode = '22023';
  end if;
  delete from portal.job_keys where scope = p_scope;
  insert into portal.job_keys (key_hash, scope, label) values (p_hash, p_scope, p_label);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Syncing: the owner's Refresh, or a job with the bank-sync key
-- ---------------------------------------------------------------------------

-- Starts a sync, or returns null when there is nothing to do: no connection, one
-- already running, or Lunch Flow asked to slow down within the hour. A run left
-- running over 10 minutes (a function that timed out) is closed as failed first.
-- Returns the run and the accounts to fetch.
create function public.money_sync_begin(p_trigger text, p_sync_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_conn bigint;
  v_run bigint;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  select id into v_conn from portal.bank_connections where provider = 'lunchflow' and status <> 'off';
  if v_conn is null then
    return null;
  end if;
  update portal.bank_sync_runs
  set outcome = 'failed', error_code = 'TIMED_OUT', finished_at = now()
  where connection_id = v_conn and outcome = 'running' and started_at < now() - interval '10 minutes';
  if exists (select 1 from portal.bank_sync_runs
             where connection_id = v_conn and outcome = 'rate-limited' and started_at > now() - interval '1 hour') then
    return null;
  end if;
  insert into portal.bank_sync_runs (connection_id, trigger) values (v_conn, p_trigger)
  on conflict (connection_id) where outcome = 'running' do nothing
  returning id into v_run;
  if v_run is null then
    return null;
  end if;
  return jsonb_build_object(
    'run', v_run,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'uid', provider_uid) order by id)
                          from portal.bank_accounts where connection_id = v_conn and not hidden), '[]')
  );
end;
$function$;

-- One account's balances from a running sync: [{kind, pence}]. A balance is kept only
-- when it differs from the last one, and a new one counts as fresh data.
create function public.money_ingest(p_run bigint, p_account bigint, p_balances jsonb, p_sync_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_conn bigint;
  v jsonb;
  v_last bigint;
  v_new boolean := false;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  select connection_id into v_conn from portal.bank_sync_runs where id = p_run and outcome = 'running';
  if v_conn is null then
    raise exception 'That sync is not running.' using errcode = '22023';
  end if;
  if not exists (select 1 from portal.bank_accounts where id = p_account and connection_id = v_conn) then
    raise exception 'That account is not on this connection.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_balances, '[]'::jsonb)) loop
    select pence into v_last from portal.bank_balances
    where account_id = p_account and kind = v->>'kind' order by at desc limit 1;
    if v_last is distinct from (v->>'pence')::bigint then
      insert into portal.bank_balances (account_id, at, kind, pence)
      values (p_account, now(), v->>'kind', (v->>'pence')::bigint)
      on conflict do nothing;
      v_new := true;
    end if;
  end loop;
  if v_new then
    update portal.bank_connections set last_data_at = now(), updated_at = now() where id = v_conn;
  end if;
end;
$function$;

-- Closes a run with its outcome and, on failure, a code (never a message). The
-- connection turns stale after 3 days with nothing new, and active again after.
create function public.money_sync_end(p_run bigint, p_outcome text, p_error_code text default null,
                                      p_sync_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_conn bigint;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  if p_outcome is null or p_outcome not in ('ok', 'skipped', 'rate-limited', 'failed') then
    raise exception 'Unknown sync outcome.' using errcode = '22023';
  end if;
  update portal.bank_sync_runs
  set outcome = p_outcome, error_code = p_error_code, finished_at = now()
  where id = p_run and outcome = 'running'
  returning connection_id into v_conn;
  if v_conn is null then
    return;
  end if;
  update portal.bank_connections
  set status = case when coalesce(last_data_at, created_at) < now() - interval '3 days' then 'stale' else 'active' end,
      updated_at = now()
  where id = v_conn and status <> 'off';
end;
$function$;

-- Owner RPCs need a session. The sync RPCs also take a job's key, which the
-- scheduled sync sends with the anon client.
do $$
declare f text;
begin
  foreach f in array array[
    'money_read()',
    'money_connect(jsonb)',
    'money_disconnect()',
    'money_forget_all()',
    'job_key_set(text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'money_sync_begin(text, text)',
    'money_ingest(bigint, bigint, jsonb, text)',
    'money_sync_end(bigint, text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
