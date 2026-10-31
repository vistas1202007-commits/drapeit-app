-- Additive: existing guide jobs, video caches and checklist ticks remain untouched.
-- Apply after 0012. The application also works before this migration, without the new catalog/check cache.
create table public.video_topic_checks (
  video_id text not null references public.video_index_runs(video_id) on delete cascade,
  module_slug text not null check (module_slug ~ '^[a-z0-9][a-z0-9-]*$'),
  module_revision text not null check (module_revision ~ '^[a-f0-9]{64}$'),
  shown boolean not null,
  start_seconds integer,
  end_seconds integer,
  model text not null,
  checked_at timestamptz not null default now(),
  primary key (video_id, module_slug, module_revision),
  check ((shown and start_seconds is not null and end_seconds is not null and start_seconds >= 0 and end_seconds > start_seconds)
         or (not shown and start_seconds is null and end_seconds is null))
);
create table public.sewing_clips (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.video_topic_checks enable row level security;
alter table public.sewing_clips enable row level security;
revoke all on public.video_topic_checks, public.sewing_clips from public, anon, authenticated, croquis_app;
-- Only the server's privileged connection / offline curator writes these tables. No browser write policy.
