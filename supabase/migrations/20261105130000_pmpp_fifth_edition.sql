-- The first PMPP plan was written from a publisher's contents page, without the
-- book. From Chapter 12 on it had the wrong chapters: it put Merge at 12 and Sorting
-- at 13, listed 25 chapters where the book has 24, and included two that do not exist.
-- The plan now comes from the book, so tasks.ref means something different for those
-- chapters. The renderer's plan also changed, with new text and steps.
--
-- Loading a plan only adds what is missing, so already loaded rows would otherwise
-- keep the old text, and some would sit under the wrong chapter. This runs once, and
-- does nothing if the plans were never loaded.
--
--   1. A unit that has not been touched is removed. Pressing "Add missing" on the
--      Study page brings it back with the new text. "Not touched" is strict: its
--      name, notes, steps and reviews must exactly match what the first plan wrote,
--      and it can have no hours, comments, evidence, finished steps, marked exercises,
--      recall ratings, benchmarks or scheduled times. A due date alone does not count,
--      since setting a pace again restores it.
--   2. A PMPP unit you have worked on keeps everything, and follows its chapter to the
--      right number and name. Its notes and steps stay as they are.
--   3. A unit you have worked on for one of the two chapters that do not exist keeps
--      everything too, but loses its ref, so it becomes an ordinary task.
--
-- Axler's refs and text did not change, so it is left alone.

do $migration$
declare
  v_first_plan boolean;
  v_row record;
  v_section bigint;
begin
  create temporary table first_plan (project text, ref text, name_md5 text, notes_md5 text, steps_md5 text, reviews_md5 text) on commit drop;
  insert into first_plan values
    ('pmpp', 'pmpp-setup', 'e9f56b8f6473d61e72390aba4d7e5f0a', '90cfc91a7c34e017033dc63556fdbd11', '186cb47ae82769c7c3a43351a664fe8a', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('pmpp', 'pmpp-1', '3336c81d53494458a3b8f37dbd85ca3f', '544b3a51d16f20b2a322e4b0fd769a87', 'cd56811638ffa01b2d003fd57b61bee4', '2c7436b2b55c49a28cd2e12ae3839136'),
    ('pmpp', 'pmpp-2', '882d243f8feac81d6c7de4e9064cf4e1', '72ba1951e9aa99b0ec025b7e1f026ce7', '0369af3ff8c9f11ee5434b9d450fab96', 'fe97e84d9a95d1e7fb4ce0b48586814c'),
    ('pmpp', 'pmpp-3', '6dd0dbb8abafc4ad474fe02faca0df34', 'b335af9398594188c8efb331bf33532e', '0369af3ff8c9f11ee5434b9d450fab96', 'cfa14278d299765cfe8a629e543f1a37'),
    ('pmpp', 'pmpp-4', '1c94b53c6f79d0256de308406b4899bc', '67d3fcd49cf755e3afc373f26aa2f514', '0369af3ff8c9f11ee5434b9d450fab96', '71bda87164608e1d770896848a48f480'),
    ('pmpp', 'pmpp-5', '58963f0466b102fb7e56725cb118f20e', 'a4e6a78aac42710af4147ea004956bfd', '0369af3ff8c9f11ee5434b9d450fab96', 'ebe69f6d6b7977d24b5298e4f54c5d94'),
    ('pmpp', 'pmpp-6', '89d5a26202a0fee446bb1a247c706b4e', '6280710f74902358cc42d2a7b43d1091', '0369af3ff8c9f11ee5434b9d450fab96', '8cd18210992320493dfa6762230b29a0'),
    ('pmpp', 'pmpp-7', '6963111ccc80e3ab36d301812aa16bd8', 'd98f1cf6e86c390f8cdd4f9252224d4a', '0369af3ff8c9f11ee5434b9d450fab96', '3e0c92233535f5be266182387e17a9cf'),
    ('pmpp', 'pmpp-8', 'a48f853cf5fc7a570d9dcfb9b2443d67', '23b90c7585a6948f59650d02812936b6', '0369af3ff8c9f11ee5434b9d450fab96', 'afd0a1773e340607968daa3d5941f9d5'),
    ('pmpp', 'pmpp-9', '61d9363a5060784f31bb423d060823c1', '2194c335cc428803d5c1e42730cb9cb7', '0369af3ff8c9f11ee5434b9d450fab96', 'f3f7814f048d5eb39df01e67b096b5a5'),
    ('pmpp', 'pmpp-10', '5e458be5fa0373a985af060f4bdb044b', 'f97f361da4a37f7f866f1e284f6d6807', '0369af3ff8c9f11ee5434b9d450fab96', '77b2f0a073e2279b6ee10a7d7957b0b3'),
    ('pmpp', 'pmpp-11', '4973fb0de9057924bfd9dcc619492054', 'f0ab6d06ad504393d34594c6454d5e6f', '0369af3ff8c9f11ee5434b9d450fab96', 'cb1020839243597545eb7f26c5fd3964'),
    ('pmpp', 'pmpp-12', '333fc24d9674cb61291d2ae22208cbba', 'f6af37aba8f01c913a4be6cff7e33966', '0369af3ff8c9f11ee5434b9d450fab96', '09022ef50f3b6590c8f1635f2faf2f8b'),
    ('pmpp', 'pmpp-13', '30a7f6a9275949e7b44c42981661962c', '3ecd2b438833676b5a5642fb98c675f7', '0369af3ff8c9f11ee5434b9d450fab96', 'c6e7558d3e01b292667df82a71c24cb8'),
    ('pmpp', 'pmpp-14', '5b0f49ed8df388fadad048ffb61296fd', 'f91f7f70d3fd2fdfa501c10c0a818378', '0369af3ff8c9f11ee5434b9d450fab96', '39df3c94d07c7d4edcb4628d7fbe67b5'),
    ('pmpp', 'pmpp-15', 'e63bfebf2d579a79665f949b30a0b80c', 'f6569d85bc5819fc8a67081c44f50aa4', '0369af3ff8c9f11ee5434b9d450fab96', '4e2918094bddac022e31ffeb3418f68d'),
    ('pmpp', 'pmpp-16', '171fbd9d0b29f3331d2ee1b9c1992e08', 'eead988fe46b3f7baf7aee1dbd3f0baf', '0369af3ff8c9f11ee5434b9d450fab96', '5b9a0128e65b7234b6d7a1531d2bfedd'),
    ('pmpp', 'pmpp-17', '6e766983713f15030aa3ea43f2684eb5', '050a4822a590dcdb08c68b0fecbe5b0d', '0369af3ff8c9f11ee5434b9d450fab96', '917b5754986e23bd518cc06f2536c83b'),
    ('pmpp', 'pmpp-18', '0b8e3ce0157f7af69c939e4717243c30', 'b08a61f5af9839ce362b9188db51415d', '0369af3ff8c9f11ee5434b9d450fab96', '6d35ab725af586f0c25dfd1550ea792b'),
    ('pmpp', 'pmpp-19', '6f1fce742c75a706bca94d570c171db7', '7f1394a16cb2d5ffb7547e9ab96ca463', '0369af3ff8c9f11ee5434b9d450fab96', 'e257532c5672a1c0393a70e929677aa4'),
    ('pmpp', 'pmpp-20', '8e9ea970e796689deb9f1548368657bd', 'ff874a2d16d02359ddac52d88924f7f7', '0369af3ff8c9f11ee5434b9d450fab96', 'a8c87821a00bcefc7da45f18b6e158ac'),
    ('pmpp', 'pmpp-21', 'b2db551440d1d80e43e1c1d3a1608dbb', '84e1daced24bbb2fa69188b626f88c6c', 'cd56811638ffa01b2d003fd57b61bee4', '49864d0d83e4c27d35be8978672b805f'),
    ('pmpp', 'pmpp-22', 'ddc8da97f055cfbd76985af283e7fb38', '3329da2921abe6c7946cb30768f32879', 'cd56811638ffa01b2d003fd57b61bee4', '9ef6f2f0b512b7761cea74f3856bbf3e'),
    ('pmpp', 'pmpp-23', '3c98b3feaa7c91fc1f91b04cfaa4cf21', 'c1757930cbeafb9e3dc3bd2fa4304d7e', '0369af3ff8c9f11ee5434b9d450fab96', '50f721aef8905aa1af40565bd39a1799'),
    ('pmpp', 'pmpp-24', '472d474935afc36097f8cc80d93dd66c', '1f6a681e44a9e6e1705dc40444bab619', 'cd56811638ffa01b2d003fd57b61bee4', '70636561dc6977b1814917a90a1d2eae'),
    ('pmpp', 'pmpp-25', '241064b2f7227b43525651e5963a9fe3', '453048b187391a65dd5ddd2d070b498f', 'cd56811638ffa01b2d003fd57b61bee4', '2c22479076e2d8485a431ceeae86b881'),
    ('pmpp', 'pmpp-app-a', '659954153dc9131f834cc3d14a4c1601', 'a288e33e81b43e699b0cc17d62da1eb9', 'cd56811638ffa01b2d003fd57b61bee4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('pmpp', 'pmpp-app-b', 'e2a7ad4a046cf10ab51a9d5ff2414f0a', '56a766a00439746d230e0eea182b7d51', 'cd56811638ffa01b2d003fd57b61bee4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('pmpp', 'pmpp-app-c', '07eb847dc221998565bec767c579bcf4', 'adabfb8c2e51c00c469f781ec518bb50', 'cd56811638ffa01b2d003fd57b61bee4', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-baseline', '68fb525975f975a079e3f9257a5284ab', '80e6253ac64a007fbba230473f1a2be8', '3f2c6e53be80940da41f35ce29a01d3e', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-structure', 'dcda5a3a717c3977b71318ebe685c29c', 'dde29797e3109ccd36d63ae833904463', 'dd384f856e2eb35f0b1d1c800226defb', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-reference', '954c7bbb8dfa6c9290873c8c9e708ec9', '7946269b554da3320c410590e82a3854', '88ce7e93766301afeda7d67586eed505', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-camera', '1ba838412be29c6ed638bd28045aa30d', '16cf152cee2dbedc7b05cf336d06c9ff', '7be34f7425dadfb8f50fe8b5d999d8e7', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-scene-buffer', 'c9b2f2919fe9aef8644f74b9684605fe', 'f6f9fe3fa0eaaca74808bb4244c47adf', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-materials', 'f3f99743c52ce951fec890c57bb4baa4', '9bf8ba9b4ec0ffe9c51b16a8e3021a57', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-triangles', '93120a0125eed1167153e235eaac7d2d', 'd22c877e19e48f0b736b79b1b3109904', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-bvh-cpu', '58ed304ba9f3018fa872af5fafdb7d49', 'dd9b29f462d924304239b403e60d2877', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-bvh-traverse', '06610628848e6a9f17cd834b7b360750', '62d9646832524aeccda3a6ce14df4c92', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-bvh-quality', 'b2b42fd288acdb317eb2eb30d4a21b9e', '3c158716d4451a0aa7f895d2dd3a238c', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-lbvh-cpu', '48f722b374cc87f2e7d5f8beb7ccc1e6', '1291823619a247ba65152e5fd9ce9af7', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gpu-sort', 'e64ca05c20c50277681f39bde511a0f9', '5ff64a554d2e2503d880ec32575b0d9e', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-lbvh-gpu', 'c334933575cce53302f25fc2a9540a98', 'eaf8bfefc0280c0d1ecee004bca7ab0a', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-hw-rt', 'eaeaa76c1ed24824f7478d4a76f57c11', '2c4f7feebd34da8e741eadb028e06eec', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-wide-bvh', 'be4a3b85e4b32d84d97e77024fa71ff2', '1797d46a61eeb3065f2b0d30cc11ece5', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-paper', 'de1432387268c54b660c9bb978da5c2c', '467386d79f2582cd8a4a976e6ee20029', '27aba3c12635b017fc52953a33ba7abb', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-load', '103bc2ca88969dd84443cec4be55f651', '52818b05c6689d55c13f47c95c1efd2b', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-raster', '9452b627b9b1cb4d7128034fee1ba625', '6feb9a59a173cb034328a8a681caa809', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-sort', '069d3f341fe9e0638a19ed6b3eaf1f82', '8d0367f172464c4897a6b8d46a72e408', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-quality', '07b0d78c32d91e95e8bad79854efe5db', 'adfcd213c638e29ac19c0b29aab81fe3', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-gs-train', '1e2f059c98cba6a7c391733c78141c8d', 'a10c15a6b7294bec72ce5fcec3939796', '493c5112b2691e6fcde72d8d1697610d', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-nerf-paper', 'f9d2bb04a203f2b765a5646567d4c9bb', '4e5bc3d4789fa1b88a0b515059afa93f', '27aba3c12635b017fc52953a33ba7abb', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-nerf-tiny', '622a86736c8155747d9a7a7a689337ad', '115e0c215fe15c01aba2961b1356ff3f', 'c49bf568128484ce1bc3da548ca593d3', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('rendering', 'r-neural-direction', '79787610bfac084b5ca4286576b126de', '0bacdd3320adb15b7d2d935b8f3506e2', '493c5112b2691e6fcde72d8d1697610d', 'd41d8cd98f00b204e9800998ecf8427e');

  -- Only the first plan has these. Checked before anything is removed, and so that a
  -- database already holding the new plan is not renumbered.
  select exists (
    select 1 from portal.tasks t
    where t.project = 'pmpp'
      and (t.ref = 'pmpp-25'
        or t.name in ('Ch 12 Merge', 'Ch 13 Sorting', 'Ch 14 Filtering', 'Ch 15 Sparse matrix computation', 'Ch 17 Graph traversal', 'Ch 18 Deep learning', 'Ch 19 Multi-GPU API'))
  ) into v_first_plan;

  -- 1. Untouched units go, and come back with the new text when the plan is loaded.
  delete from portal.tasks t
  using first_plan f
  where t.project = f.project::portal.project_key
    and t.ref = f.ref
    and not t.completed
    and t.stage = 'Not started'
    and t.hours = 0
    and coalesce(t.evidence, '') = ''
    and t.start_on is null
    and t.start_at is null
    and t.due_at is null
    and md5(t.name) = f.name_md5
    and md5(t.notes) = f.notes_md5
    and f.steps_md5 = md5(coalesce((select string_agg(s.name, E'\n' order by s.position, s.gid) from portal.subtasks s where s.task_gid = t.gid), ''))
    and f.reviews_md5 = md5(coalesce((select string_agg(r.prompt, E'\n' order by r.gid) from portal.reviews r where r.task_gid = t.gid), ''))
    and not exists (select 1 from portal.subtasks s where s.task_gid = t.gid and s.done)
    and not exists (select 1 from portal.reviews r where r.task_gid = t.gid and r.last_reviewed_at is not null)
    and not exists (select 1 from portal.task_exercises e where e.task_gid = t.gid)
    and not exists (select 1 from portal.task_comments c where c.task_gid = t.gid)
    and not exists (select 1 from portal.benchmarks b where b.task_gid = t.gid);

  if v_first_plan then
    -- 3. Chapters that do not exist. Done first, because 22 and 24 are about to be reused.
    update portal.tasks t set ref = null where t.project = 'pmpp' and t.ref in ('pmpp-22', 'pmpp-24');

    -- 2. Everything left follows its chapter. In two passes, since the refs swap around.
    update portal.tasks t
       set ref = 'moving:' || m.new_ref
      from (values
        ('pmpp-12', 'pmpp-13'), ('pmpp-13', 'pmpp-14'), ('pmpp-14', 'pmpp-12'),
        ('pmpp-15', 'pmpp-17'), ('pmpp-17', 'pmpp-18'), ('pmpp-18', 'pmpp-19'),
        ('pmpp-19', 'pmpp-23'), ('pmpp-20', 'pmpp-21'), ('pmpp-21', 'pmpp-22'),
        ('pmpp-23', 'pmpp-15'), ('pmpp-25', 'pmpp-24')
      ) m (old_ref, new_ref)
     where t.project = 'pmpp' and t.ref = m.old_ref;
    update portal.tasks t set ref = substr(t.ref, 8) where t.project = 'pmpp' and t.ref like 'moving:%';

    -- A name you changed stays yours.
    update portal.tasks t
       set name = m.new_name
      from (values
        ('Get set up on LeetGPU', 'Set up your three places to run kernels'),
        ('Ch 2 Heterogeneous data parallel computing', 'Ch 2 Heterogeneous data-parallel computing'),
        ('Ch 8 Stencil', 'Ch 8 Stencil computation'),
        ('Ch 9 Parallel histogram', 'Ch 9 Histogram'),
        ('Ch 11 Prefix sum (scan)', 'Ch 11 Scan'),
        ('Ch 12 Merge', 'Ch 13 Merge'),
        ('Ch 13 Sorting', 'Ch 14 Sorting'),
        ('Ch 14 Filtering', 'Ch 12 Filter'),
        ('Ch 15 Sparse matrix computation', 'Ch 17 Sparse matrix computation'),
        ('Ch 16 Wavefront algorithms', 'Ch 16 Dynamic programming and wavefront parallelism'),
        ('Ch 17 Graph traversal', 'Ch 18 Graph traversal'),
        ('Ch 18 Deep learning', 'Ch 19 Convolutional neural networks'),
        ('Ch 19 Multi-GPU API', 'Ch 23 Multi-GPU programming'),
        ('Ch 20 Electrostatic potential map', 'Ch 21 Electrostatic potential map'),
        ('Ch 21 Parallel programming and computational thinking', 'Ch 22 Algorithm selection, problem decomposition, and problem formulation'),
        ('Ch 23 Advanced optimizations for matrix multiplication', 'Ch 15 Advanced optimizations for matrix multiplication'),
        ('Ch 25 Conclusion and outlook', 'Ch 24 Conclusion and future outlook'),
        ('Appendix C CUDA memories, address spaces and pointers', 'Appendix C CUDA memories, address spaces, and pointers')
      ) m (old_name, new_name)
     where t.project = 'pmpp' and t.ref is not null and t.name = m.old_name;

    -- Recall prompts start with their chapter number.
    update portal.reviews r
       set prompt = 'PMPP ' || m.new_n || substr(r.prompt, length('PMPP ' || m.old_n) + 1)
      from portal.tasks t,
           (values (12, 13), (13, 14), (14, 12), (15, 17), (17, 18), (18, 19), (19, 23), (20, 21), (21, 22), (23, 15), (25, 24)) m (old_n, new_n)
     where r.task_gid = t.gid
       and t.project = 'pmpp'
       and t.ref = 'pmpp-' || m.new_n
       and r.prompt like 'PMPP ' || m.old_n || ':%';

    -- The first plan never counted PMPP's exercises. A count you set stays yours.
    update portal.tasks t
       set exercise_count = m.n
      from (values
        ('pmpp-2', 10), ('pmpp-4', 9), ('pmpp-5', 12), ('pmpp-6', 5), ('pmpp-7', 11), ('pmpp-8', 2),
        ('pmpp-9', 5), ('pmpp-10', 6), ('pmpp-11', 7), ('pmpp-12', 4), ('pmpp-13', 4), ('pmpp-14', 4),
        ('pmpp-15', 3), ('pmpp-16', 6), ('pmpp-17', 5), ('pmpp-18', 3), ('pmpp-19', 4), ('pmpp-21', 5),
        ('pmpp-23', 3), ('pmpp-app-a', 5)
      ) m (ref, n)
     where t.project = 'pmpp' and t.ref = m.ref and t.exercise_count is null;

    -- Each one moves to the section the plan now has it in.
    for v_row in
      select t.gid, m.section
      from portal.tasks t
      join (values
        ('pmpp-setup', 'Before you start'), ('pmpp-1', 'Before you start'),
        ('pmpp-2', 'Part 1: Fundamental concepts'), ('pmpp-3', 'Part 1: Fundamental concepts'), ('pmpp-4', 'Part 1: Fundamental concepts'),
        ('pmpp-5', 'Part 1: Fundamental concepts'), ('pmpp-6', 'Part 1: Fundamental concepts'),
        ('pmpp-7', 'Part 2: Parallel patterns'), ('pmpp-8', 'Part 2: Parallel patterns'), ('pmpp-9', 'Part 2: Parallel patterns'),
        ('pmpp-10', 'Part 2: Parallel patterns'), ('pmpp-11', 'Part 2: Parallel patterns'), ('pmpp-12', 'Part 2: Parallel patterns'),
        ('pmpp-13', 'Part 2: Parallel patterns'), ('pmpp-14', 'Part 2: Parallel patterns'), ('pmpp-15', 'Part 2: Parallel patterns'),
        ('pmpp-16', 'Part 3: Advanced patterns and applications'), ('pmpp-17', 'Part 3: Advanced patterns and applications'),
        ('pmpp-18', 'Part 3: Advanced patterns and applications'), ('pmpp-19', 'Part 3: Advanced patterns and applications'),
        ('pmpp-21', 'Part 3: Advanced patterns and applications'), ('pmpp-22', 'Part 3: Advanced patterns and applications'),
        ('pmpp-23', 'Part 3: Advanced patterns and applications'), ('pmpp-app-b', 'Part 3: Advanced patterns and applications'),
        ('pmpp-24', 'Conclusion'),
        ('pmpp-app-a', 'Appendices (dip in when needed)'), ('pmpp-app-c', 'Appendices (dip in when needed)')
      ) m (ref, section) on m.ref = t.ref
      where t.project = 'pmpp'
    loop
      select s.gid into v_section from portal.sections s where s.project = 'pmpp' and s.name = v_row.section order by s.gid limit 1;
      if v_section is null then
        insert into portal.sections (project, name, position)
        values ('pmpp', v_row.section, (select coalesce(max(s.position), 0) + 1 from portal.sections s where s.project = 'pmpp'))
        returning gid into v_section;
      end if;
      update portal.tasks t set section_gid = v_section where t.gid = v_row.gid;
    end loop;
  end if;

  -- Sections the first plans made and nothing is left in, so that loading again
  -- creates them in the new order.
  delete from portal.sections s
   where not exists (select 1 from portal.tasks t where t.section_gid = s.gid)
     and (
       (s.project = 'pmpp' and s.name in ('Before you start', 'Introduction', 'Part I: Fundamental Concepts', 'Part II: Parallel Patterns', 'Part III: Advanced Patterns and Applications', 'Part IV: Advanced Practices', 'Appendices (for reference)'))
       or (s.project = 'rendering' and s.name in ('Foundations: make progress measurable', 'Scene data: from spheres to meshes', 'BVH traversal', 'Gaussian splatting', 'Neural rendering'))
     );

  -- A project with no sections left starts as a new one does.
  insert into portal.sections (project, name)
  select k::portal.project_key, 'To do'
  from unnest(array['pmpp', 'rendering']) k
  where not exists (select 1 from portal.sections s where s.project = k::portal.project_key);
end;
$migration$;
