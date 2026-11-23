-- Money, part 10: subscriptions in one place, with a keep-or-cancel check.
--
--   money_categories  gains 'learning' (learning and mentoring), a kind of bill
--   money_bills       gains the owner's last answer to "do you still want this?"
--                     (verdict: keep or cancel) and the day it was given (reviewed_on)
--
-- The owner can now sort a bill into a category from the page (money_set_bill's
-- p_category), so a bill no longer keeps the first category it was found with; the
-- engine still never changes a category once a bill has one. Cancel only records the
-- decision: the bill keeps counting until its payments stop, and the engine marks it
-- ended then. Claude's views are unchanged: the answer goes only to readers who see
-- bills by name (the owner, and Claude at setup).

insert into portal.money_categories (key, name, kind, position)
values ('learning', 'Learning and mentoring', 'bills', 26)
on conflict (key) do nothing;

alter table portal.money_bills
  add column reviewed_on date,
  add column verdict text check (verdict in ('keep', 'cancel'));

-- As before, plus the owner's answer and its day, for readers who see bills by name.
create or replace function portal.money_bill_json(b portal.money_bills, p_named boolean)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', b.id, 'ident', case when p_named then b.ident end, 'merchant_key', case when p_named then b.merchant_key end,
    'band_pence', b.band_pence, 'name', case when p_named then b.name end, 'cadence', b.cadence,
    'anchor_on', b.anchor_on, 'expected_pence', b.expected_pence, 'variable', b.variable,
    'category', (select key from portal.money_categories where id = b.category_id),
    'status', b.status, 'added_by', b.added_by, 'created_at', b.created_at,
    'last_paid_on', l.made_on, 'last_pence', -l.pence,
    'reviewed_on', case when p_named then b.reviewed_on end, 'verdict', case when p_named then b.verdict end)
  from (select null) x
  left join lateral (select t.made_on, t.pence from portal.bank_transactions t
                     where portal.money_bill_matches(b, t)
                     order by t.made_on desc, t.id desc limit 1) l on true;
$function$;
revoke all on function portal.money_bill_json(portal.money_bills, boolean) from public, anon, authenticated;

-- As before (ignore or take back, rename), and now also sort it into a category (by
-- key) and answer "do you still want this?" (keep or cancel, dated today). Replaced
-- rather than overloaded, so a call by name has one function to match: the old
-- three arguments still mean what they meant.
drop function public.money_set_bill(bigint, text, text);
create function public.money_set_bill(p_id bigint, p_status text default null, p_name text default null,
                                      p_category text default null, p_verdict text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_category bigint;
begin
  perform portal.require_money_owner();
  if p_status is not null and p_status not in ('active', 'ignored') then
    raise exception 'A bill is active or ignored.' using errcode = '22023';
  end if;
  if p_verdict is not null and p_verdict not in ('keep', 'cancel') then
    raise exception 'A bill is kept or cancelled.' using errcode = '22023';
  end if;
  if p_category is not null then
    select id into v_category from portal.money_categories where key = p_category;
    if v_category is null then
      raise exception 'There is no category %.', p_category using errcode = '22023';
    end if;
  end if;
  update portal.money_bills
  set status = coalesce(p_status, status),
      name = coalesce(nullif(trim(p_name), ''), name),
      name_by = case when nullif(trim(p_name), '') is null then name_by else 'owner' end,
      category_id = coalesce(v_category, category_id),
      verdict = coalesce(p_verdict, verdict),
      reviewed_on = case when p_verdict is null then reviewed_on else current_date end,
      updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'There is no bill %.', p_id;
  end if;
end;
$function$;
revoke all on function public.money_set_bill(bigint, text, text, text, text) from public, anon;
grant execute on function public.money_set_bill(bigint, text, text, text, text) to authenticated, service_role;
