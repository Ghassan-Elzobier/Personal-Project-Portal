-- Money, part 4: the weekly amount and safe-to-spend.
--
--   money_settings gains the weekly amount you live on (allowance_pence) and the first
--   payday (first_payday): before it, the pay cycle runs to it, so a month with no
--   pay isn't counted as a payday.
--
-- The sums themselves are worked out in the app (src/lib/money/budget.ts), from one
-- read, money_budget: the balance, the settings, and each category's budget with what
-- it has paid this month and spent this week and last. The page reads it as the owner;
-- Claude reads it at the summary level, for "how am I doing?" and "can I afford it?".
-- Totals only: never a single payment.

alter table portal.money_settings
  add column allowance_pence bigint check (allowance_pence is null or allowance_pence between 0 and 1000000),
  add column first_payday date;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- Applies a settings change from the app or Claude's plan: the buffer and when it
-- starts, the payday rule, the first payday and the weekly amount. A key that is
-- present with null clears what can be cleared.
create function portal.money_apply_settings(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Send the settings as an object.' using errcode = '22023';
  end if;
  if p ? 'claude_access' then
    raise exception 'Claude''s access to Money is set by the owner on the Money page.' using errcode = '42501';
  end if;
  update portal.money_settings
  set buffer_pence = coalesce((p->>'buffer_pence')::bigint, buffer_pence),
      buffer_from = case when p ? 'buffer_from' then (p->>'buffer_from')::date else buffer_from end,
      payday_rule = coalesce(p->>'payday_rule', payday_rule),
      first_payday = case when p ? 'first_payday' then (p->>'first_payday')::date else first_payday end,
      allowance_pence = case when p ? 'allowance_pence' then (p->>'allowance_pence')::bigint else allowance_pence end,
      updated_at = now()
  where id;
end;
$function$;
revoke all on function portal.money_apply_settings(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading the budget (the owner, or Claude at summary)
-- ---------------------------------------------------------------------------

-- The balance of the accounts that count, the settings, and per category: its budget,
-- money out since p_month_start, and money out this week (from p_week_start) and last
-- week. Pending payments count: that money has gone. Plus what isn't sorted yet.
create function public.money_budget(p_month_start date, p_week_start date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_last date := p_week_start - 7;
begin
  perform portal.require_money_claude(p_access_hash, 'summary');
  return jsonb_build_object(
    'balance_pence', (
      select sum(b.pence) from portal.bank_accounts a
      join portal.bank_connections c on c.id = a.connection_id and c.status <> 'off'
      join lateral (select pence from portal.bank_balances where account_id = a.id order by at desc limit 1) b on true
      where a.in_safe and not a.hidden),
    'settings', (select jsonb_build_object('allowance_pence', allowance_pence, 'buffer_pence', buffer_pence,
                   'buffer_from', buffer_from, 'payday_rule', payday_rule, 'first_payday', first_payday)
                 from portal.money_settings where id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'name', c.name, 'kind', c.kind, 'budget_pence', c.budget_pence,
               'paid_month', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                       where t.category_id = c.id and t.pence < 0 and t.made_on >= p_month_start), 0),
               'spent_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                       where t.category_id = c.id and t.pence < 0 and t.made_on >= p_week_start), 0),
               'spent_last_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                            where t.category_id = c.id and t.pence < 0
                                              and t.made_on >= v_last and t.made_on < p_week_start), 0))
             order by c.position, c.id)
      from portal.money_categories c), '[]'),
    'unsorted_week', coalesce((select -sum(pence) from portal.bank_transactions
                               where category_id is null and pence < 0 and made_on >= p_week_start), 0),
    'unsorted_last_week', coalesce((select -sum(pence) from portal.bank_transactions
                                    where category_id is null and pence < 0
                                      and made_on >= v_last and made_on < p_week_start), 0)
  );
end;
$function$;

-- The owner's settings, from the Money page.
create function public.money_save_settings(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  perform portal.money_apply_settings(p);
end;
$function$;

-- As before, and its settings now include the first payday and the weekly amount.
create or replace function public.money_claude_plan(p_changes jsonb, p_access_hash text default null)
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
    perform portal.money_apply_settings(p_changes->'settings');
  end if;

  perform portal.money_categorise();
  return jsonb_build_object('categories', v_cats, 'rules', v_rules,
                            'unsorted_this_month', (select count(*) from portal.bank_transactions
                                                    where category_id is null
                                                      and made_on >= date_trunc('month', current_date)::date));
end;
$function$;

do $$
begin
  execute 'revoke all on function public.money_save_settings(jsonb) from public, anon';
  execute 'grant execute on function public.money_save_settings(jsonb) to authenticated, service_role';
  -- Claude reads the budget at summary: connector calls prove themselves with p_access_hash.
  execute 'revoke all on function public.money_budget(date, date, text) from public';
  execute 'grant execute on function public.money_budget(date, date, text) to anon, authenticated, service_role';
end;
$$;
