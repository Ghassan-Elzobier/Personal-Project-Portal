-- GPU MODE's lectures become steps on the PMPP chapters they cover. A plan loaded from
-- now on gets them from src/lib/study/pmpp.ts. This adds them to chapters already
-- loaded, at the end of each chapter's steps, and leaves finished chapters alone.
-- Running it twice adds nothing, because a step already there is skipped.

insert into portal.subtasks (task_gid, name, position)
select t.gid, s.name, coalesce((select max(x.position) from portal.subtasks x where x.task_gid = t.gid), -1) + 1
from (values
  ('pmpp-2', 'Work through GPU MODE lecture 3 in its Colab notebook, which runs on a real NVIDIA GPU'),
  ('pmpp-3', 'Watch GPU MODE lecture 2, a recap of chapters 1 to 3, and note anything you would explain differently'),
  ('pmpp-4', 'Watch GPU MODE lecture 4 on compute and memory architecture, and check it against your notes on warps and scheduling'),
  ('pmpp-5', 'Watch GPU MODE lecture 5, which builds a tiled matrix multiply with shared memory, and compare it with yours'),
  ('pmpp-6', 'Watch GPU MODE lecture 8 on the performance checklist, and match each item to Fig. 6.13'),
  ('pmpp-10', 'Watch GPU MODE lecture 9 on reductions, and compare its kernels with the book''s'),
  ('pmpp-11', 'Watch GPU MODE lectures 20 and 21, where Izzat El Hajj, one of the book''s authors, teaches scan')
) as s(ref, name)
join portal.tasks t on t.project = 'pmpp' and t.ref = s.ref and not t.completed
where not exists (select 1 from portal.subtasks x where x.task_gid = t.gid and x.name = s.name);
