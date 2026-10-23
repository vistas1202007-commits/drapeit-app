-- Croquis by Vistas Atelier: Supabase / PostgreSQL schema.
--
-- Run the files in this folder in order (0001, 0002, ...) in the Supabase SQL
-- editor. Row Level Security (RLS) makes sure each user can only see their own
-- projects. gen_random_uuid() is built into PostgreSQL 13+, so no extension is needed.

-- Supabase Auth already provides auth.users. We keep a small public profile.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  garment_category text not null default '',
  current_version integer not null default 1,
  thumbnail_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every saved design spec is a new, never-edited row (version history).
create table public.design_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null,
  spec jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create table public.notebook_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  is_mock boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  generator_id text not null,
  version_number integer not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  provider text not null,
  is_mock boolean not null,
  options jsonb not null default '{}',
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Files live in Supabase Storage; this table stores their metadata only.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('upload', 'sketch', 'generated')),
  filename text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.projects
  add constraint projects_thumbnail_fk foreign key (thumbnail_asset_id) references public.assets(id) on delete set null;

create table public.canvas_documents (
  project_id uuid primary key references public.projects(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Planned tables (Phases 3-4). Kept here so the design is visible.
create table public.fabric_references (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  properties jsonb not null default '{}',
  source text,                       -- where the data came from
  created_at timestamptz not null default now()
);

create table public.user_measurements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,               -- e.g. "Meera"
  unit text not null check (unit in ('cm', 'in')),
  measurements jsonb not null,
  created_at timestamptz not null default now()
);

create table public.tailor_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  version_number integer not null,
  pdf_asset_id uuid references public.assets(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.saved_tutorials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,            -- e.g. 'youtube'
  external_id text not null,         -- id returned by the real provider
  title text not null,
  url text not null,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  unique (project_id, provider, external_id)
);

create table public.provider_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.generation_jobs(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  service text not null,
  provider text not null,
  is_mock boolean not null,
  success boolean not null,
  duration_ms integer not null,
  estimated_cost_usd numeric(10, 5) not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index on public.projects (owner_id, updated_at desc);
create index on public.design_versions (project_id, version_number desc);
create index on public.generation_jobs (project_id, created_at desc);
create index on public.notebook_messages (project_id, created_at);
create index on public.assets (project_id, created_at desc);

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.design_versions enable row level security;
alter table public.notebook_messages enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.assets enable row level security;
alter table public.canvas_documents enable row level security;
alter table public.user_measurements enable row level security;
alter table public.tailor_sheets enable row level security;
alter table public.saved_tutorials enable row level security;
alter table public.provider_usage enable row level security;
alter table public.fabric_references enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own projects" on public.projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own measurements" on public.user_measurements for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own usage (read)" on public.provider_usage for select using (owner_id = auth.uid());
create policy "fabric references are public" on public.fabric_references for select using (true);

-- Child tables: allowed when the parent project belongs to the user.
create function public.owns_project(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = pid and owner_id = auth.uid());
$$;

create policy "via project" on public.design_versions for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.notebook_messages for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.generation_jobs for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.assets for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.canvas_documents for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.tailor_sheets for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy "via project" on public.saved_tutorials for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

-- Storage: create a PRIVATE bucket named "project-assets" and store files at
-- "<owner_id>/<project_id>/<asset_id>.<ext>". Then:
-- create policy "own files" on storage.objects for all
--   using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text)
--   with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text);
