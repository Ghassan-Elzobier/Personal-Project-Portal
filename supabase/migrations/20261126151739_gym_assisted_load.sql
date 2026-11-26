-- Assisted bodyweight moves: an assisted pull-up or dip machine takes weight off,
-- so such a set is logged as negative kg (35 kg of help is -35). Until now the
-- check on portal.gym_sets.kg stopped at 0, and help could only be stored as
-- weight added on a belt. This widens the check; the app allows a weight below 0
-- only on bodyweight moves.
--
-- Expand only: the previous deployment never writes a negative weight, so it works
-- with the wider check too.

alter table portal.gym_sets drop constraint gym_sets_kg_check;

alter table portal.gym_sets
  add constraint gym_sets_kg_check check (kg is null or kg between -200 and 500);
