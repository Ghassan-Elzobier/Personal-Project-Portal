-- Money, part 3: categories, rules, watched merchants, and planning with Claude.
--
--   money_categories  what money is for (rent, groceries, eating out...), each with a
--                     kind and an optional monthly budget
--   money_rules       "this merchant (or these words) is that category", first match
--                     wins; a rule can also watch a merchant, so a new payment to it
--                     raises an alert
--   money_alerts      things that need the owner: a watched merchant paid, and later
--                     bills and the feed
--
-- Categorising happens here, in one place (portal.money_categorise), so a sync, a
-- statement, a new rule and Claude's plan all sort payments the same way. A category
-- the owner sets on a payment is never changed by a rule. The repo ships a generic
-- starter set of categories and a few rules for well-known shops; the owner's own
-- rules and budgets live only in the database.
--
-- Claude reaches Money only through money_claude_*, held to the level the owner sets
-- in the app (off, summary, plan, setup); none of them returns a single payment, the
-- bank connection or the access level itself, and none can erase anything.

create table portal.money_categories (
  id           bigint generated always as identity primary key,
  key          text not null unique check (key ~ '^[a-z0-9-]{1,40}$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  kind         text not null check (kind in ('income', 'bills', 'groceries', 'essentials', 'discretionary',
                                             'savings', 'transfer')),
  budget_pence bigint check (budget_pence is null or budget_pence between 0 and 10000000),
  position     smallint not null default 0
);
insert into portal.money_categories (key, name, kind, position) values
  ('pay', 'Pay', 'income', 10),
  ('other-income', 'Other income', 'income', 11),
  ('rent', 'Rent', 'bills', 20),
  ('energy', 'Energy', 'bills', 21),
  ('broadband-phone', 'Broadband and phone', 'bills', 22),
  ('subscriptions', 'Subscriptions', 'bills', 23),
  ('fitness', 'Gym and fitness', 'bills', 24),
  ('debts', 'Debt repayments', 'bills', 25),
  ('groceries', 'Groceries', 'groceries', 30),
  ('transport', 'Transport', 'essentials', 40),
  ('personal-care', 'Personal care', 'essentials', 41),
  ('household', 'Shopping and household', 'essentials', 42),
  ('eating-out', 'Eating out', 'discretionary', 50),
  ('fun', 'Fun and social', 'discretionary', 51),
  ('cash', 'Cash', 'discretionary', 52),
  ('gifts', 'Gifts and one-offs', 'discretionary', 53),
  ('savings', 'Savings', 'savings', 60),
  ('transfers', 'Transfers', 'transfer', 70);

alter table portal.bank_transactions
  add column category_id bigint references portal.money_categories (id) on delete set null,
  add column category_by text check (category_by in ('rule', 'owner'));
create index bank_transactions_category_idx on portal.bank_transactions (category_id);

create table portal.money_rules (
  id          bigint generated always as identity primary key,
  field       text not null check (field in ('merchant', 'description')),
  pattern     text not null check (length(pattern) between 2 and 80),
  min_pence   bigint,
  max_pence   bigint,
  category_id bigint references portal.money_categories (id) on delete cascade,
  watch       boolean not null default false,
  -- Lower comes first. The owner's rules sit below 1000, the starter set at 1000.
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  check (field = 'description' or pattern ~ '^[a-z0-9-]{2,60}$'),
  check (category_id is not null or watch),
  check (min_pence is null or max_pence is null or min_pence <= max_pence)
);
insert into portal.money_rules (field, pattern, category_id, position)
select 'description', p, (select id from portal.money_categories where key = k), 1000
from (values ('sainsbury', 'groceries'), ('tesco', 'groceries'), ('asda', 'groceries'), ('aldi', 'groceries'),
             ('lidl', 'groceries'), ('morrisons', 'groceries'), ('waitrose', 'groceries'),
             ('tfl travel', 'transport'), ('trainline', 'transport'),
             ('deliveroo', 'eating-out'), ('just eat', 'eating-out'), ('uber eats', 'eating-out'),
             ('netflix', 'subscriptions'), ('spotify', 'subscriptions')) s (p, k);

create table portal.money_alerts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('watched', 'new-bill', 'price-rise', 'missed-bill', 'low-safe')),
  dedupe       text not null unique check (length(dedupe) between 3 and 120),
  subject_id   bigint,
  detail       jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 4096),
  raised_at    timestamptz not null default now(),
  dismissed_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['money_categories', 'money_rules', 'money_alerts'] loop
    execute format('alter table portal.%I enable row level security', t);
    execute format('revoke all on table portal.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- Whether a rule matches a payment: its merchant key (exactly, or as its first
-- words), or words in its text or payee, and the amount range if the rule has one.
create function portal.money_rule_matches(r portal.money_rules, t portal.bank_transactions)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select (case r.field
            when 'merchant' then t.merchant_key = r.pattern or t.merchant_key like r.pattern || '-%'
            else position(lower(r.pattern) in lower(t.description || ' ' || coalesce(t.counterparty, ''))) > 0
          end)
     and (r.min_pence is null or t.pence >= r.min_pence)
     and (r.max_pence is null or t.pence <= r.max_pence);
$function$;
revoke all on function portal.money_rule_matches(portal.money_rules, portal.bank_transactions) from public, anon, authenticated;

-- Sorts every payment the owner hasn't sorted by hand: the first rule that matches
-- sets its category, and one no rule matches any more loses the rule's category.
create function portal.money_categorise()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  update portal.bank_transactions t
  set category_id = m.category_id, category_by = 'rule'
  from (
    select distinct on (t2.id) t2.id, r.category_id
    from portal.bank_transactions t2
    join portal.money_rules r on r.category_id is not null and portal.money_rule_matches(r, t2)
    where t2.category_by is distinct from 'owner'
    order by t2.id, r.position, r.id
  ) m
  where t.id = m.id and (t.category_id is distinct from m.category_id or t.category_by is distinct from 'rule');

  update portal.bank_transactions t
  set category_id = null, category_by = null
  where t.category_by = 'rule'
    and not exists (select 1 from portal.money_rules r
                    where r.category_id is not null and portal.money_rule_matches(r, t));
end;
$function$;
revoke all on function portal.money_categorise() from public, anon, authenticated;

-- A watched merchant paid (booked, in the last week, from p_since_id on): one alert each.
create function portal.money_watch(p_since_id bigint)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  insert into portal.money_alerts (kind, dedupe, subject_id, detail)
  select distinct on (t.id) 'watched', 'watched:' || t.id, t.id, jsonb_build_object('rule', r.id)
  from portal.bank_transactions t
  join portal.money_rules r on r.watch and portal.money_rule_matches(r, t)
  where t.id >= p_since_id and t.status = 'booked' and t.made_on >= current_date - 7
  order by t.id, r.position, r.id
  on conflict (dedupe) do nothing;
$function$;
revoke all on function portal.money_watch(bigint) from public, anon, authenticated;

-- The owner from a browser session, or a live Claude connector token for the owner
-- while Money's Claude access is at least p_level (summary < plan < setup).
create function portal.require_money_claude(p_access_hash text, p_level text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_levels text[] := array['off', 'summary', 'plan', 'setup'];
  v_access text;
begin
  if p_access_hash is null then
    perform portal.require_money_owner();
    return;
  end if;
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can use Money.' using errcode = '42501';
  end if;
  select claude_access into v_access from portal.money_settings where id;
  if array_position(v_levels, coalesce(v_access, 'off')) < array_position(v_levels, p_level) then
    raise exception 'Claude''s access to Money doesn''t allow this. The owner can change it on the Money page.'
      using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_money_claude(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Syncing and statements now sort what they add
-- ---------------------------------------------------------------------------

create or replace function public.money_ingest_transactions(p_run bigint, p_account bigint, p_booked jsonb,
                                                            p_pending jsonb, p_sync_key text default null)
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
  v_first bigint;
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
      v_first := least(coalesce(v_first, v_id), v_id);
      v_statement := null;
      select id, note into v_statement, v_note from portal.bank_transactions
      where account_id = p_account and source = 'statement' and status = 'booked'
        and booked_on = (v->>'booked_on')::date and pence = (v->>'pence')::bigint
      order by id limit 1;
      if v_statement is not null then
        -- The feed's row takes the statement row's place, keeping what the owner added to it.
        update portal.bank_transactions n
        set note = coalesce(n.note, s.note),
            category_id = case when s.category_by = 'owner' then s.category_id else n.category_id end,
            category_by = case when s.category_by = 'owner' then 'owner' else n.category_by end
        from portal.bank_transactions s
        where n.id = v_id and s.id = v_statement;
        delete from portal.bank_transactions where id = v_statement;
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

  perform portal.money_categorise();
  if v_first is not null then
    perform portal.money_watch(v_first);
  end if;

  update portal.bank_sync_runs
  set booked_new = booked_new + v_new, pending_now = pending_now + jsonb_array_length(coalesce(p_pending, '[]'::jsonb))
  where id = p_run;
  if v_new > 0 then
    update portal.bank_connections set last_data_at = now(), updated_at = now() where id = v_conn;
  end if;
  return v_new;
end;
$function$;

create or replace function public.money_upload_statement(p_account bigint, p_file_sha256 text, p_from date, p_to date,
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
  perform portal.money_categorise();
  return v_added;
end;
$function$;

-- Categorise what is already there, with the starter rules.
select portal.money_categorise();

-- ---------------------------------------------------------------------------
-- The owner
-- ---------------------------------------------------------------------------

-- As before, plus the categories with this month's money out and in, the rules, the
-- open alerts and how many of this month's payments no rule or hand has sorted.
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
  v_month date := date_trunc('month', current_date)::date;
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
                 from portal.job_keys where scope = 'bank-sync' order by created_at desc limit 1),
    'month', v_month,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'key', c.key, 'name', c.name, 'kind', c.kind,
               'budget_pence', c.budget_pence, 'position', c.position,
               'out_pence', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                      where t.category_id = c.id and t.pence < 0 and t.made_on >= v_month), 0),
               'in_pence', coalesce((select sum(t.pence) from portal.bank_transactions t
                                     where t.category_id = c.id and t.pence > 0 and t.made_on >= v_month), 0))
             order by c.position, c.id)
      from portal.money_categories c), '[]'),
    'unsorted', (select count(*) from portal.bank_transactions where category_id is null and made_on >= v_month),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'field', r.field, 'pattern', r.pattern,
               'category', (select key from portal.money_categories where id = r.category_id),
               'watch', r.watch, 'position', r.position) order by r.position, r.id)
      from portal.money_rules r), '[]'),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'raised_at', a.raised_at, 'detail', a.detail,
               'payment', (select jsonb_build_object('made_on', t.made_on, 'pence', t.pence,
                                                     'name', coalesce(t.counterparty, t.description))
                           from portal.bank_transactions t where a.kind = 'watched' and t.id = a.subject_id))
             order by a.raised_at desc)
      from portal.money_alerts a where a.dismissed_at is null), '[]')
  );
end;
$function$;

-- As before, with each payment's category.
create or replace function public.money_transactions(p_since date)
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
             'note', t.note, 'category_id', t.category_id, 'category_by', t.category_by)
           order by t.made_on desc, t.id desc)
    from (select * from portal.bank_transactions
          where made_on >= p_since or status = 'pending'
          order by made_on desc, id desc limit 2000) t), '[]');
end;
$function$;

-- As before, and the alerts go too (they point at payments). Categories, budgets and
-- rules stay: they are the owner's plan, not bank data.
create or replace function public.money_forget_all()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  delete from portal.money_alerts where true;
  delete from portal.bank_connections where true;
end;
$function$;

-- Sorts one payment by hand (null: back to the rules). With p_always and a merchant,
-- it also becomes a rule for that merchant, ahead of the others, applied to the past too.
create function public.money_set_category(p_txn bigint, p_category bigint, p_always boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_merchant text;
begin
  perform portal.require_money_owner();
  select merchant_key into v_merchant from portal.bank_transactions where id = p_txn;
  if not found then
    raise exception 'That payment is not here any more.';
  end if;
  if p_category is not null and not exists (select 1 from portal.money_categories where id = p_category) then
    raise exception 'That category is not here any more.';
  end if;
  if p_always and p_category is not null and v_merchant is not null then
    delete from portal.money_rules where field = 'merchant' and pattern = v_merchant and not watch;
    insert into portal.money_rules (field, pattern, category_id, position)
    values ('merchant', v_merchant, p_category,
            least(0, coalesce((select min(position) from portal.money_rules), 0) - 1));
  end if;
  update portal.bank_transactions
  set category_id = p_category, category_by = case when p_category is null then null else 'owner' end
  where id = p_txn;
  perform portal.money_categorise();
end;
$function$;

create function public.money_dismiss_alert(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  update portal.money_alerts set dismissed_at = now() where id = p_id and dismissed_at is null;
end;
$function$;

-- What Claude may do with Money. The app only: no Claude RPC can change it.
create function public.money_set_claude_access(p_level text)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_level is null or p_level not in ('off', 'summary', 'plan', 'setup') then
    raise exception 'Pick off, summary, plan or setup.' using errcode = '22023';
  end if;
  update portal.money_settings set claude_access = p_level, updated_at = now() where id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Planning with Claude (setup level)
-- ---------------------------------------------------------------------------

-- Up to 12 months of totals: by month and category, the merchants money went to most
-- (name, monthly average, how many payments), the merchants nothing sorts yet, and
-- the categories, rules and settings as they are. Totals only: never a single payment.
create function public.money_claude_history(p_months integer default 6, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_months integer := least(12, greatest(1, coalesce(p_months, 6)));
  v_from date;
begin
  perform portal.require_money_claude(p_access_hash, 'setup');
  v_from := (date_trunc('month', current_date) - make_interval(months => v_months - 1))::date;
  return jsonb_build_object(
    'from', v_from,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
               'month', to_char(mo.m, 'YYYY-MM'),
               'out_pence', mo.out_p,
               'in_pence', mo.in_p,
               'by_category', (
                 select jsonb_agg(jsonb_build_object('category', bc.key, 'out_pence', bc.out_p, 'in_pence', bc.in_p,
                          'count', bc.n) order by bc.pos)
                 from (select coalesce(c.key, 'unsorted') as key, coalesce(c.position, 999) as pos,
                              -coalesce(sum(t2.pence) filter (where t2.pence < 0), 0) as out_p,
                              coalesce(sum(t2.pence) filter (where t2.pence > 0), 0) as in_p, count(*) as n
                       from portal.bank_transactions t2
                       left join portal.money_categories c on c.id = t2.category_id
                       where t2.status = 'booked' and date_trunc('month', t2.made_on) = mo.m
                       group by 1, 2) bc))
             order by mo.m)
      from (select date_trunc('month', made_on) as m,
                   -coalesce(sum(pence) filter (where pence < 0), 0) as out_p,
                   coalesce(sum(pence) filter (where pence > 0), 0) as in_p
            from portal.bank_transactions
            where status = 'booked' and made_on >= v_from
            group by 1) mo), '[]'),
    'merchants', coalesce((
      select jsonb_agg(jsonb_build_object('merchant', g.merchant, 'name', g.name, 'category', g.category,
               'monthly_avg_pence', round(g.total / v_months), 'count', g.n, 'last_on', g.last_on)
             order by g.total desc)
      from (
        select coalesce(t.merchant_key, left(lower(t.description), 40)) as merchant,
               max(left(coalesce(t.counterparty, t.description), 60)) as name,
               max(c.key) as category, -sum(t.pence) as total, count(*) as n, max(t.made_on) as last_on
        from portal.bank_transactions t left join portal.money_categories c on c.id = t.category_id
        where t.status = 'booked' and t.pence < 0 and t.made_on >= v_from
        group by 1
        order by -sum(t.pence) desc
        limit 80) g), '[]'),
    'income', coalesce((
      select jsonb_agg(jsonb_build_object('merchant', g.merchant, 'name', g.name, 'category', g.category,
               'total_pence', g.total, 'count', g.n, 'last_on', g.last_on) order by g.total desc)
      from (
        select coalesce(t.merchant_key, left(lower(t.description), 40)) as merchant,
               max(left(coalesce(t.counterparty, t.description), 60)) as name,
               max(c.key) as category, sum(t.pence) as total, count(*) as n, max(t.made_on) as last_on
        from portal.bank_transactions t left join portal.money_categories c on c.id = t.category_id
        where t.status = 'booked' and t.pence > 0 and t.made_on >= v_from
        group by 1
        order by sum(t.pence) desc
        limit 20) g), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'kind', kind,
                                              'budget_pence', budget_pence) order by position, id)
                            from portal.money_categories), '[]'),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'field', r.field, 'pattern', r.pattern,
                                         'category', c.key, 'watch', r.watch, 'starter', r.position >= 1000)
                                       order by r.position, r.id)
                       from portal.money_rules r left join portal.money_categories c on c.id = r.category_id), '[]'),
    'settings', (select jsonb_build_object('buffer_pence', buffer_pence, 'buffer_from', buffer_from,
                   'payday_rule', payday_rule) from portal.money_settings where id)
  );
end;
$function$;

-- Changes the plan in one go: categories (add, rename, budget, kind), rules (add,
-- remove, watch) and settings (buffer, payday rule), then sorts the payments again.
-- {categories: [{key, name?, kind?, budget_pence?}], remove_categories: [key],
--  rules: [{field, pattern, category?, watch?, min_pence?, max_pence?}], remove_rules: [id],
--  settings: {buffer_pence?, buffer_from?, payday_rule?}}
-- Never the access level, the connection or erasing anything.
create function public.money_claude_plan(p_changes jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
  v_cat bigint;
  v_cats integer := 0;
  v_rules integer := 0;
begin
  perform portal.require_money_claude(p_access_hash, 'setup');
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Send the changes as an object.' using errcode = '22023';
  end if;
  if p_changes->'settings' ? 'claude_access' then
    raise exception 'Claude''s access to Money is set by the owner in the app.' using errcode = '42501';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p_changes->'categories', '[]'::jsonb)) loop
    if exists (select 1 from portal.money_categories where key = v->>'key') then
      update portal.money_categories
      set name = coalesce(v->>'name', name),
          kind = coalesce(v->>'kind', kind),
          budget_pence = case when v ? 'budget_pence' then (v->>'budget_pence')::bigint else budget_pence end
      where key = v->>'key';
    else
      if v->>'kind' is null then
        raise exception 'A new category needs a kind.';
      end if;
      insert into portal.money_categories (key, name, kind, budget_pence, position)
      values (v->>'key', coalesce(v->>'name', v->>'key'), v->>'kind', (v->>'budget_pence')::bigint,
              coalesce((select max(position) from portal.money_categories where kind = v->>'kind'), 90) + 1);
    end if;
    v_cats := v_cats + 1;
  end loop;
  delete from portal.money_categories
  where key in (select jsonb_array_elements_text(coalesce(p_changes->'remove_categories', '[]'::jsonb)));

  for v in select * from jsonb_array_elements(coalesce(p_changes->'rules', '[]'::jsonb)) loop
    v_cat := null;
    if v->>'category' is not null then
      select id into v_cat from portal.money_categories where key = v->>'category';
      if v_cat is null then
        raise exception 'There is no category "%". Add it first.', v->>'category';
      end if;
    end if;
    insert into portal.money_rules (field, pattern, min_pence, max_pence, category_id, watch, position)
    values (coalesce(v->>'field', 'merchant'), v->>'pattern', (v->>'min_pence')::bigint, (v->>'max_pence')::bigint,
            v_cat, coalesce((v->>'watch')::boolean, false),
            least(0, coalesce((select min(position) from portal.money_rules), 0) - 1));
    v_rules := v_rules + 1;
  end loop;
  delete from portal.money_rules
  where id in (select (jsonb_array_elements_text(coalesce(p_changes->'remove_rules', '[]'::jsonb)))::bigint);

  if p_changes ? 'settings' then
    update portal.money_settings
    set buffer_pence = coalesce((p_changes->'settings'->>'buffer_pence')::bigint, buffer_pence),
        buffer_from = case when p_changes->'settings' ? 'buffer_from'
                           then (p_changes->'settings'->>'buffer_from')::date else buffer_from end,
        payday_rule = coalesce(p_changes->'settings'->>'payday_rule', payday_rule),
        updated_at = now()
    where id;
  end if;

  perform portal.money_categorise();
  return jsonb_build_object('categories', v_cats, 'rules', v_rules,
                            'unsorted_this_month', (select count(*) from portal.bank_transactions
                                                    where category_id is null
                                                      and made_on >= date_trunc('month', current_date)::date));
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array['money_set_category(bigint, bigint, boolean)', 'money_dismiss_alert(bigint)',
                           'money_set_claude_access(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Claude's RPCs: connector calls have no session and prove themselves with p_access_hash.
  foreach f in array array['money_claude_history(integer, text)', 'money_claude_plan(jsonb, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
