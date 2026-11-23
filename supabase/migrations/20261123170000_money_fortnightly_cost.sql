-- Money, part 12: a regular cost can come every two weeks (a session twice a month).
--
--   money_goals.cadence  gains 'fortnightly', for regular costs only. Bills found in
--                        the bank keep weekly, monthly or yearly (money_bills is
--                        unchanged).
--
-- Expand only: the old code never sends 'fortnightly', and reads one as monthly.

alter table portal.money_goals drop constraint if exists money_goals_cadence_check;
alter table portal.money_goals
  add constraint money_goals_cadence_check
  check (cadence is null or cadence in ('weekly', 'fortnightly', 'monthly', 'yearly'));
