-- Money, part 10: the Monday check-in. On Today, early in the week, one line says how
-- last week went and one tap says what happens to it (src/lib/money/checkin.ts).
--
--   money_settings.checkin_week  the week (its Monday) the owner last checked in on
--   money_settings.checkin       what they chose: {week, choice, goal?, pence}
--
-- The choices: "ok" (under or on its amount), "keep" (the plan carries on as it is),
-- "week" (on the autopilot, this week's fixed amount drops by the overspend) and "goal"
-- (a goal kept in the account gives up the overspend, so what's safe to spend rises).

alter table portal.money_settings
  add column checkin_week date,
  add column checkin jsonb check (checkin is null or (jsonb_typeof(checkin) = 'object'
                                                      and pg_column_size(checkin) < 1024));

-- The owner's check-in on the week starting p_week, in one go: the choice is recorded,
-- and "week" or "goal" moves the money. The amount is what the app worked out from the
-- budget as it stands; a goal never goes below nothing, nor this week's amount.
create function public.money_check_in(p_week date, p_choice text, p_goal bigint default null, p_pence bigint default 0)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'Check in on a week by its Monday.' using errcode = '22023';
  end if;
  if p_choice is null or p_choice not in ('ok', 'keep', 'week', 'goal') then
    raise exception 'Pick what happens to last week.' using errcode = '22023';
  end if;
  if p_pence is null or p_pence < 0 or p_pence > 100000000 then
    raise exception 'Send the amount in pence.' using errcode = '22023';
  end if;
  if p_choice = 'goal' then
    update portal.money_goals
    set saved_pence = greatest(0, saved_pence - p_pence), updated_at = now()
    where id = p_goal and held = 'account' and kind <> 'debt' and status = 'active';
    if not found then
      raise exception 'That goal is not kept in the account.';
    end if;
  end if;
  update portal.money_settings
  set checkin_week = p_week,
      checkin = jsonb_build_object('week', p_week, 'choice', p_choice, 'goal', case when p_choice = 'goal' then p_goal end,
                                   'pence', p_pence),
      -- The week after the one checked in on is this week: its amount, if the engine fixed it.
      week_amount_pence = case when p_choice = 'week' and week_amount_of = p_week + 7
                               then greatest(0, week_amount_pence - p_pence) else week_amount_pence end,
      updated_at = now()
  where id;
end;
$function$;

-- As before (part 8), and the check-in goes with the budget's numbers.
create or replace function public.money_budget(p_month_start date, p_week_start date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_claude(p_access_hash, 'summary');
  return portal.money_budget_data(p_month_start, p_week_start,
    p_access_hash is null or exists (select 1 from portal.money_settings where id and claude_access = 'setup'))
    || jsonb_build_object('checkin', (select checkin from portal.money_settings where id));
end;
$function$;

-- As before, and the check-in goes too: it was about the bank's weeks.
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
  delete from portal.money_bills where true;
  delete from portal.bank_connections where true;
  update portal.money_settings set checkin_week = null, checkin = null, updated_at = now() where id;
end;
$function$;

revoke all on function public.money_check_in(date, text, bigint, bigint) from public, anon;
grant execute on function public.money_check_in(date, text, bigint, bigint) to authenticated, service_role;
