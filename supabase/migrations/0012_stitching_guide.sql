-- Stitching Guide: the sewing library, a cache for tutorial searches, video start times,
-- and the ticks on each person's checklist.
--
-- Run this in the Supabase SQL editor after 0011. It only adds new tables, so nothing that
-- exists is changed. To undo it, drop the tables named below (and the function).
--
-- Search by meaning needs the pgvector extension. Supabase has it; if it is missing on some
-- other PostgreSQL, the tables are still created and the guide simply works without that search.

-- ---------------------------------------------------------------------------
-- The sewing library (written by us, loaded with backend/scripts/seed_sewing_library.py)
-- ---------------------------------------------------------------------------
create table public.sewing_modules (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null,
  phase text not null check (phase in ('prep', 'shaping', 'main_seams', 'openings', 'side_seams', 'hem', 'pressing')),
  step_order integer not null,
  -- The garment features that call for this technique (see backend/app/services/garment_parser.py).
  triggers text[] not null,
  summary text not null,
  steps jsonb not null,
  tips jsonb not null default '[]',
  keywords text[] not null default '{}',
  video_query text not null,
  fabric_notes jsonb not null default '{}',
  -- Fingerprint of the text above; the seed script re-embeds a module only when it changes.
  content_hash text not null,
  embedded_hash text,
  updated_at timestamptz not null default now()
);

create index sewing_modules_triggers_idx on public.sewing_modules using gin (triggers);

create table public.sewing_fabric_rules (
  fabric text primary key,
  title text not null,
  needle text not null,
  thread text not null,
  stitch_length text not null,
  seam_types jsonb not null,
  pressing text not null,
  notes jsonb not null,
  by_phase jsonb not null default '{}',
  by_module jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tutorial videos
-- ---------------------------------------------------------------------------
-- Results of YouTube searches, shared by everyone. A search costs free quota, so the same
-- question is only asked once in a while.
create table public.video_search_cache (
  cache_key text primary key,
  query text not null,
  language text not null,
  results jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Videos an AI has already watched, so each one is only ever watched once (even when it showed nothing).
create table public.video_index_runs (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  model text not null,
  segments_found integer not null default 0,
  indexed_at timestamptz not null default now()
);

-- Where in a video a technique is shown, found by that AI watching.
create table public.video_segments (
  video_id text not null references public.video_index_runs(video_id) on delete cascade,
  -- Not a foreign key: the guide may be using the library files before the seed script has run.
  module_slug text not null check (module_slug ~ '^[a-z0-9][a-z0-9-]*$'),
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer not null check (end_seconds > start_seconds),
  created_at timestamptz not null default now(),
  primary key (video_id, module_slug)
);

-- ---------------------------------------------------------------------------
-- Checklist ticks: one row per ticked step, per design version.
-- ---------------------------------------------------------------------------
create table public.stitch_progress (
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null,
  step_key text not null check (step_key ~ '^[a-z0-9][a-z0-9-]*$'),
  done_at timestamptz not null default now(),
  primary key (project_id, version_number, step_key)
);

-- ---------------------------------------------------------------------------
-- Search by meaning (pgvector), only where the extension is available
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    create schema if not exists extensions;
    create extension if not exists vector with schema extensions;
    alter table public.sewing_modules add column embedding extensions.vector(768);
    create index sewing_modules_embedding_idx on public.sewing_modules
      using hnsw (embedding extensions.vector_cosine_ops);
    -- The closest modules to a question, best first. Similarity runs from 0 (unrelated) to 1 (the same).
    create function public.match_sewing_modules(query_embedding extensions.vector(768), match_count integer default 5,
                                                min_similarity double precision default 0.6)
      returns table (slug text, similarity double precision)
      language sql stable set search_path = public, extensions as $f$
      select m.slug, (1 - (m.embedding <=> query_embedding))::double precision as similarity
      from public.sewing_modules m
      where m.embedding is not null and 1 - (m.embedding <=> query_embedding) >= min_similarity
      order by m.embedding <=> query_embedding
      limit match_count;
    $f$;
    revoke execute on function public.match_sewing_modules(extensions.vector, integer, double precision)
      from public, anon, authenticated;
  else
    raise notice 'pgvector is not available here: the sewing library works, without search by meaning.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The library and the video tables are used only by the backend itself (never directly by a signed-in
-- person), so they have RLS on and no policies: nobody else can read or change them.
alter table public.sewing_modules enable row level security;
alter table public.sewing_fabric_rules enable row level security;
alter table public.video_search_cache enable row level security;
alter table public.video_index_runs enable row level security;
alter table public.video_segments enable row level security;
alter table public.stitch_progress enable row level security;

create policy "own stitch progress" on public.stitch_progress for all
  using (public.owns_project(project_id)) with check (public.owns_project(project_id));

grant select, insert, delete on public.stitch_progress to croquis_app;

revoke all on
  public.sewing_modules, public.sewing_fabric_rules, public.video_search_cache, public.video_index_runs,
  public.video_segments, public.stitch_progress
  from anon, authenticated;
