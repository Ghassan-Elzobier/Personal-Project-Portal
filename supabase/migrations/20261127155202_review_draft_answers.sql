-- Claude's draft answers for recall cards that have none (src/lib/study/draft-answers.ts),
-- saved when the owner asks on Study. A draft goes only on a card that still has no
-- answer, so the tutor's own words are never written over, and each draft starts with
-- "Claude's draft: " so the card says whose answer it is. Owner only: a mentor can't, and
-- the connector has no route in (no p_access_hash).

create function public.tracker_set_review_answers(p_answers jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_item jsonb;
  v_saved integer := 0;
begin
  perform portal.require_task_owner(null);
  for v_item in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    update portal.reviews r
       set answer = trim(v_item ->> 'answer')
     where r.gid = (v_item ->> 'gid')::bigint
       and r.answer is null
       and r.retired_at is null
       -- A blank or over-long draft is skipped, not an error, so one bad draft
       -- doesn't lose the rest.
       and length(trim(coalesce(v_item ->> 'answer', ''))) between 1 and 1000;
    if found then
      v_saved := v_saved + 1;
    end if;
  end loop;
  return v_saved;
end;
$function$;

revoke all on function public.tracker_set_review_answers(jsonb) from public, anon;
grant execute on function public.tracker_set_review_answers(jsonb) to authenticated;
