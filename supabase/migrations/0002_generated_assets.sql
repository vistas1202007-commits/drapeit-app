-- Phase 2: generated pictures remember which job made them and from which
-- design version, so every sketch/preview stays linked to its version.
alter table public.assets
  add column job_id uuid references public.generation_jobs(id) on delete set null,
  add column generator_id text,
  add column version_number integer,
  add column provider text,
  add column is_mock boolean not null default false;

create index assets_project_version_idx on public.assets(project_id, version_number);
