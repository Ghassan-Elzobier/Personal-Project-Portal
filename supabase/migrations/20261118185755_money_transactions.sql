-- Money, part 2: transactions, from the feed and from uploaded statements.
--
--   bank_transactions  every booked payment, and the pending set as of the last sync
--   statement_uploads  one row per statement file, so the same file is never added twice
--
-- Booked rows are found again by Lunch Flow's id when it sends one, and always by a
-- fingerprint (a hash of the day, the amount, the text and a count among identical
-- rows), so the overlap between syncs never doubles anything. Pending rows are
-- replaced on every sync. A statement fills days the feed missed; when the feed later
-- brings the same day and amount, its row replaces the statement's and keeps your
-- note. Amounts are signed pence. The text is the owner's own bank data: it stays in
-- the database and never goes into a log or an error message.

create table portal.statement_uploads (
  id          bigint generated always as identity primary key,
  account_id  bigint not null references portal.bank_accounts (id) on delete cascade,
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  covers_from date not null,
  covers_to   date not null check (covers_to >= covers_from),
  added       integer not null default 0,
  skipped     integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create table portal.bank_transactions (
  id            bigint generated always as identity primary key,
  account_id    bigint not null references portal.bank_accounts (id) on delete cascade,
  status        text not null check (status in ('booked', 'pending')),
  source        text not null check (source in ('lunchflow', 'statement')),
  ref           text check (length(ref) between 1 and 200),
  fingerprint   text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  upload_id     bigint references portal.statement_uploads (id) on delete cascade,
  booked_on     date,
  value_on      date,
  made_on       date not null,
  pence         bigint not null check (pence <> 0 and abs(pence) < 100000000000),
  method        text not null default 'other'
                  check (method in ('card', 'direct-debit', 'standing-order', 'transfer', 'cash', 'other')),
  description   text not null check (length(description) between 1 and 300),
  counterparty  text check (length(counterparty) <= 140),
  merchant_key  text check (merchant_key ~ '^[a-z0-9-]{1,60}$'),
  note          text check (length(note) <= 300),
  first_seen_at timestamptz not null default now(),
  check (status = 'booked' or ref is null),
  check (status = 'pending' or booked_on is not null)
);
create unique index bank_transactions_ref_idx on portal.bank_transactions (account_id, ref) where ref is not null;
create unique index bank_transactions_fp_idx on portal.bank_transactions (account_id, fingerprint) where status = 'booked';
create index bank_transactions_day_idx on portal.bank_transactions (made_on desc);
create index bank_transactions_booked_idx on portal.bank_transactions (account_id, booked_on);

do $$
declare t text;
begin
  foreach t in array array['statement_uploads', 'bank_transactions'] loop
    execute format('alter table portal.%I enable row level security', t);
    execute format('revoke all on table portal.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Syncing
-- ---------------------------------------------------------------------------

-- As before, and each account now says the last day the feed booked anything, so
-- the sync asks only for what is new (less a few days, for late bookings).
create or replace function public.money_sync_begin(p_trigger text, p_sync_key text default null)
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
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'uid', a.provider_uid,
               'latest', (select max(t.booked_on) from portal.bank_transactions t
                          where t.account_id = a.id and t.source = 'lunchflow' and t.status = 'booked'))
             order by a.id)
      from portal.bank_accounts a where a.connection_id = v_conn and not a.hidden), '[]')
  );
end;
$function$;

-- One account's transactions from a running sync. Booked rows are added once (by
-- Lunch Flow's id or the fingerprint); a feed row replaces a statement row of the same
-- day and amount, keeping its note. The pending set replaces the last one. Returns
-- how many booked rows were new. Each row: {ref, fingerprint, booked_on, value_on,
-- made_on, pence, method, description, counterparty, merchant_key}.
create function public.money_ingest_transactions(p_run bigint, p_account bigint, p_booked jsonb, p_pending jsonb,
                                                 p_sync_key text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_conn bigint;
  v jsonb;
  v_id bigint;
  v_statement bigint;
  v_note text;
  v_new integer := 0;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  select connection_id into v_conn from portal.bank_sync_runs where id = p_run and outcome = 'running';
  if v_conn is null then
    raise exception 'That sync is not running.' using errcode = '22023';
  end if;
  if not exists (select 1 from portal.bank_accounts where id = p_account and connection_id = v_conn) then
    raise exception 'That account is not on this connection.' using errcode = '22023';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p_booked, '[]'::jsonb)) loop
    v_id := null;
    insert into portal.bank_transactions (account_id, status, source, ref, fingerprint, booked_on, value_on, made_on,
                                          pence, method, description, counterparty, merchant_key)
    values (p_account, 'booked', 'lunchflow', nullif(v->>'ref', ''), v->>'fingerprint', (v->>'booked_on')::date,
            nullif(v->>'value_on', '')::date, coalesce(nullif(v->>'made_on', '')::date, (v->>'booked_on')::date),
            (v->>'pence')::bigint, coalesce(v->>'method', 'other'), v->>'description',
            nullif(v->>'counterparty', ''), nullif(v->>'merchant_key', ''))
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      v_new := v_new + 1;
      select id, note into v_statement, v_note from portal.bank_transactions
      where account_id = p_account and source = 'statement' and status = 'booked'
        and booked_on = (v->>'booked_on')::date and pence = (v->>'pence')::bigint
      order by id limit 1;
      if v_statement is not null then
        delete from portal.bank_transactions where id = v_statement;
        update portal.bank_transactions set note = coalesce(note, v_note) where id = v_id;
      end if;
    end if;
  end loop;

  delete from portal.bank_transactions where account_id = p_account and status = 'pending';
  insert into portal.bank_transactions (account_id, status, source, fingerprint, made_on, pence, method,
                                        description, counterparty, merchant_key)
  select p_account, 'pending', 'lunchflow', p->>'fingerprint', (p->>'made_on')::date, (p->>'pence')::bigint,
         coalesce(p->>'method', 'other'), p->>'description', nullif(p->>'counterparty', ''),
         nullif(p->>'merchant_key', '')
  from jsonb_array_elements(coalesce(p_pending, '[]'::jsonb)) p;

  update portal.bank_sync_runs
  set booked_new = booked_new + v_new, pending_now = pending_now + jsonb_array_length(coalesce(p_pending, '[]'::jsonb))
  where id = p_run;
  if v_new > 0 then
    update portal.bank_connections set last_data_at = now(), updated_at = now() where id = v_conn;
  end if;
  return v_new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The owner
-- ---------------------------------------------------------------------------

-- Transactions from p_since on (and every pending one), newest first.
create function public.money_transactions(p_since date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'account_id', t.account_id, 'status', t.status, 'source', t.source,
             'booked_on', t.booked_on, 'made_on', t.made_on, 'pence', t.pence, 'method', t.method,
             'description', t.description, 'counterparty', t.counterparty, 'merchant_key', t.merchant_key,
             'note', t.note)
           order by t.made_on desc, t.id desc)
    from (select * from portal.bank_transactions
          where made_on >= p_since or status = 'pending'
          order by made_on desc, id desc limit 2000) t), '[]');
end;
$function$;

-- A statement's new rows (the app has already left out those the feed has), once per
-- file. Each row: {fingerprint, booked_on, pence, method, description, counterparty,
-- merchant_key}. Returns how many were added.
create function public.money_upload_statement(p_account bigint, p_file_sha256 text, p_from date, p_to date,
                                              p_rows jsonb, p_skipped integer)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_upload bigint;
  v_added integer;
begin
  perform portal.require_money_owner();
  if not exists (select 1 from portal.bank_accounts where id = p_account) then
    raise exception 'Connect the account before uploading its statement.';
  end if;
  if exists (select 1 from portal.statement_uploads where file_sha256 = p_file_sha256) then
    raise exception 'That statement is in already.';
  end if;
  insert into portal.statement_uploads (account_id, file_sha256, covers_from, covers_to, skipped)
  values (p_account, p_file_sha256, p_from, p_to, greatest(0, coalesce(p_skipped, 0)))
  returning id into v_upload;
  with added as (
    insert into portal.bank_transactions (account_id, status, source, fingerprint, upload_id, booked_on, made_on,
                                          pence, method, description, counterparty, merchant_key)
    select p_account, 'booked', 'statement', v->>'fingerprint', v_upload, (v->>'booked_on')::date,
           (v->>'booked_on')::date, (v->>'pence')::bigint, coalesce(v->>'method', 'other'), v->>'description',
           nullif(v->>'counterparty', ''), nullif(v->>'merchant_key', '')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) v
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from added;
  update portal.statement_uploads set added = v_added where id = v_upload;
  return v_added;
end;
$function$;

-- As before, plus the scheduled sync's key: when it was registered and last used.
create or replace function public.money_read()
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
    'failures', (select count(*) from portal.bank_sync_runs where outcome = 'failed' and id > coalesce(v_ok_run, 0)),
    'sync_key', (select jsonb_build_object('created_at', created_at, 'last_used_at', last_used_at)
                 from portal.job_keys where scope = 'bank-sync' order by created_at desc limit 1)
  );
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array['money_transactions(date)', 'money_upload_statement(bigint, text, date, date, jsonb, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.money_ingest_transactions(bigint, bigint, jsonb, jsonb, text) from public';
  execute 'grant execute on function public.money_ingest_transactions(bigint, bigint, jsonb, jsonb, text) to anon, authenticated, service_role';
end;
$$;
