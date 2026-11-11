-- The book library: the owner's PMPP PDF as searchable pages, for the Book page
-- and the Claude connector. scripts/load-book.mjs reads the owner's own copy and
-- loads it straight into these tables, so none of the book's text is in this repo.
-- Only the owner can read it, from the browser or with a live connector token.
-- Mentors and anon get nothing.
--
-- Every page keeps its chapter and section, and the search index weights those
-- headings above the page text, so a page about coalescing is found by its
-- section title even when the page itself says "coalesced" once.
--
--   library_search(book, groups, chapter, limit, access_hash)   ranked pages with excerpts
--   library_read(book, page, section, count, access_hash)       full text of a few pages
--   library_outline(book, access_hash)                          chapters and sections with pages
--
-- The PDF itself sits in the private `library` bucket. Pages open it through
-- short-lived signed links, made with the owner's own session.

create table portal.book_pages (
  book    text not null check (book ~ '^[a-z0-9-]{1,40}$'),
  page    integer not null check (page between 1 and 100000),
  kind    text not null check (kind in ('front', 'body', 'figure')),
  chapter text check (chapter ~ '^([0-9]{1,2}|[A-Z])$'),
  section text check (section ~ '^([0-9]{1,2}|[A-Z])\.[0-9]{1,2}$'),
  heading text not null check (length(heading) between 1 and 300),
  figure  text check (length(figure) <= 20),
  body    text not null check (length(body) between 1 and 20000),
  search  tsvector generated always as (
    setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', body), 'D')
  ) stored,
  primary key (book, page)
);
comment on table portal.book_pages is
  'Pages of the owner''s books, loaded from their own PDF by scripts/load-book.mjs. Owner only.';

create index book_pages_search on portal.book_pages using gin (search);

-- Chapters (number '6') and their sections (number '6.1'), with the pages each spans.
create table portal.book_sections (
  book       text not null check (book ~ '^[a-z0-9-]{1,40}$'),
  number     text not null check (number ~ '^([0-9]{1,2}|[A-Z])(\.[0-9]{1,2})?$'),
  chapter    text not null check (chapter ~ '^([0-9]{1,2}|[A-Z])$'),
  title      text not null check (length(title) <= 200),
  first_page integer not null,
  last_page  integer not null check (last_page >= first_page),
  primary key (book, number)
);

alter table portal.book_pages enable row level security;
alter table portal.book_sections enable row level security;
revoke all on table portal.book_pages from public, anon, authenticated;
revoke all on table portal.book_sections from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- The owner, from the browser or with a live connector token. Nobody else.
create function portal.require_library_owner(p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can read the library.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_library_owner(text) from public, anon, authenticated;

-- p_groups is what the caller asked for, one group per idea, each with the
-- words that can stand for it: [["subgroup", "warp"], ["ballot"]]. The query
-- code in src/lib/library/query.ts adds the CUDA words the book uses for Vulkan
-- ones. Pages that match every group come first; when there are too few, pages
-- that match some of them follow, so a long question still finds something.
create function public.library_search(
  p_book text,
  p_groups jsonb,
  p_chapter text default null,
  p_limit integer default 6,
  p_access_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_group jsonb;
  v_alt jsonb;
  v_term tsquery;
  v_any tsquery;
  v_all tsquery;
  v_every tsquery;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 12);
  v_results jsonb;
  v_full integer;
begin
  perform portal.require_library_owner(p_access_hash);

  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 12 then
    raise exception 'Give between 1 and 12 search terms.' using errcode = '22023';
  end if;

  for v_group in select value from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_group) <> 'array' or jsonb_array_length(v_group) not between 1 and 8 then
      raise exception 'Each search term needs 1 to 8 ways of saying it.' using errcode = '22023';
    end if;
    v_any := null;
    for v_alt in select value from jsonb_array_elements(v_group) loop
      if jsonb_typeof(v_alt) <> 'string' or length(v_alt #>> '{}') not between 1 and 80 then
        raise exception 'Search words must be text of up to 80 characters.' using errcode = '22023';
      end if;
      v_term := phraseto_tsquery('english', v_alt #>> '{}');
      if numnode(v_term) > 0 then
        v_any := case when v_any is null then v_term else v_any || v_term end;
      end if;
    end loop;
    -- A group of only stop words ("the", "how") drops out.
    if v_any is not null then
      v_all := case when v_all is null then v_any else v_all && v_any end;
      v_every := case when v_every is null then v_any else v_every || v_any end;
    end if;
  end loop;

  if v_all is null then
    return jsonb_build_object('results', '[]'::jsonb, 'matched_every_term', 0);
  end if;

  -- A page's own score, plus how much of its section is about the same thing,
  -- so the section that teaches an idea outranks pages that mention it in
  -- passing. At most three pages per section, so results reach further.
  with hits as (
    select p.page, p.kind, p.chapter, p.section, p.heading, p.figure, p.body,
           p.search @@ v_all as full_match,
           coalesce(p.section, coalesce(p.chapter, '') || ':' || p.kind) as grp,
           ts_rank_cd(p.search, v_every, 1)
             * case p.kind when 'body' then 1.0 when 'figure' then 0.6 else 0.4 end as rank
      from portal.book_pages p
     where p.book = p_book
       and p.search @@ v_every
       and (p_chapter is null or p.chapter = p_chapter)
  ),
  grouped as (
    select h.*, sum(h.rank) over (partition by h.grp) as grp_rank,
           row_number() over (partition by h.grp order by h.full_match desc, h.rank desc, h.page) as nth
      from hits h
  ),
  scored as (
    select g.*, g.rank + g.grp_rank / nullif(max(g.grp_rank) over (), 0) as score
      from grouped g
     where g.nth <= 3
  ),
  top as (
    select * from scored order by full_match desc, score desc, page limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'page', t.page,
           'kind', t.kind,
           'chapter', t.chapter,
           'section', t.section,
           'heading', t.heading,
           'figure', t.figure,
           'matched_every_term', t.full_match,
           -- Two short passages around the matches, marked with control characters
           -- the caller turns into highlights. The page text is never HTML.
           'excerpt', ts_headline('english', t.body, v_every,
             'MaxFragments=2, MinWords=14, MaxWords=40, FragmentDelimiter=" … ", StartSel=' || chr(1) || ', StopSel=' || chr(2))
         ) order by t.full_match desc, t.score desc, t.page), '[]'::jsonb),
         count(*) filter (where t.full_match)
    into v_results, v_full
    from top t;

  return jsonb_build_object('results', v_results, 'matched_every_term', v_full);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- A few pages in full, from a page number or from the start of a section.
-- next_page says where to carry on.
create function public.library_read(
  p_book text,
  p_page integer default null,
  p_section text default null,
  p_count integer default 3,
  p_access_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_from integer := p_page;
  v_to integer;
  v_count integer := least(greatest(coalesce(p_count, 3), 1), 8);
  v_section portal.book_sections;
  v_last integer;
begin
  perform portal.require_library_owner(p_access_hash);

  if p_section is not null then
    select * into v_section from portal.book_sections s where s.book = p_book and s.number = p_section;
    if v_section.number is null then
      raise exception 'There is no section % in this book. library_outline lists them.', p_section using errcode = 'P0002';
    end if;
    v_from := coalesce(p_page, v_section.first_page);
  end if;
  if v_from is null then
    raise exception 'Give a page or a section.' using errcode = '22023';
  end if;

  v_to := v_from + v_count - 1;
  select max(page) into v_last from portal.book_pages where book = p_book;

  return jsonb_build_object(
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('page', p.page, 'kind', p.kind, 'heading', p.heading, 'text', p.body) order by p.page)
        from portal.book_pages p
       where p.book = p_book and p.page between v_from and v_to
    ), '[]'::jsonb),
    'section', case when v_section.number is null then null else jsonb_build_object(
      'number', v_section.number, 'title', v_section.title, 'first_page', v_section.first_page, 'last_page', v_section.last_page) end,
    'next_page', case when v_to < coalesce(v_last, 0) then v_to + 1 else null end,
    'last_page', v_last
  );
end;
$function$;

create function public.library_outline(p_book text, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_library_owner(p_access_hash);
  return jsonb_build_object(
    'pages', (select count(*) from portal.book_pages p where p.book = p_book),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('number', s.number, 'chapter', s.chapter, 'title', s.title, 'first_page', s.first_page, 'last_page', s.last_page)
             order by s.first_page, length(s.number), s.number)
        from portal.book_sections s
       where s.book = p_book
    ), '[]'::jsonb)
  );
end;
$function$;

do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.library_search(text, jsonb, text, integer, text)',
    'public.library_read(text, integer, text, integer, text)',
    'public.library_outline(text, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    -- anon too: connector calls have no session and prove themselves with p_access_hash.
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;
end;
$grants$;

-- ---------------------------------------------------------------------------
-- The PDF
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Storage checks its policies as the signed-in user, who cannot reach the portal
-- schema, so they ask through this one narrow question.
create function public.portal_owner_signed_in()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(portal.is_owner(auth.uid()), false);
$function$;
revoke all on function public.portal_owner_signed_in() from public, anon;
grant execute on function public.portal_owner_signed_in() to authenticated, service_role;

create policy "Owner reads the library" on storage.objects
  for select to authenticated
  using (bucket_id = 'library' and public.portal_owner_signed_in());

create policy "Owner adds to the library" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library' and public.portal_owner_signed_in());

create policy "Owner replaces in the library" on storage.objects
  for update to authenticated
  using (bucket_id = 'library' and public.portal_owner_signed_in())
  with check (bucket_id = 'library' and public.portal_owner_signed_in());

create policy "Owner removes from the library" on storage.objects
  for delete to authenticated
  using (bucket_id = 'library' and public.portal_owner_signed_in());
