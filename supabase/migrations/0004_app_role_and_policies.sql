-- Phase 5: per-user access through the backend.
--
-- The backend reads and writes user data as the "croquis_app" role, and sets the
-- signed-in user's id for each transaction. Row Level Security then lets each user
-- reach only their own projects, even if a query in the code were wrong.
--
-- The browser never talks to these tables directly (it only uses Supabase for
-- sign-in), so Supabase's public Data API roles (anon, authenticated) get no
-- access to them at all.

-- The signed-in user's id, as set by the backend for the current transaction.
create or replace function public.request_user_id() returns uuid
  language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid;
$$;

create or replace function public.owns_project(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = pid and owner_id = public.request_user_id());
$$;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "own projects" on public.projects;
drop policy if exists "own measurements" on public.user_measurements;
drop policy if exists "own usage (read)" on public.provider_usage;

create policy "own profile" on public.profiles for all
  using (id = public.request_user_id()) with check (id = public.request_user_id());
create policy "own projects" on public.projects for all
  using (owner_id = public.request_user_id()) with check (owner_id = public.request_user_id());
create policy "own measurements" on public.user_measurements for all
  using (owner_id = public.request_user_id()) with check (owner_id = public.request_user_id());
create policy "own usage (read)" on public.provider_usage for select
  using (owner_id = public.request_user_id());
-- The "via project" policies on the child tables call owns_project(), updated above.

-- The role the backend switches to for user requests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'croquis_app') then
    create role croquis_app nologin;
  end if;
end
$$;
grant croquis_app to current_user;  -- lets the backend's database user (postgres) switch to it

grant usage on schema public to croquis_app;
grant select, insert, update, delete on
  public.projects, public.design_versions, public.notebook_messages, public.generation_jobs,
  public.assets, public.canvas_documents
  to croquis_app;
grant select on public.provider_usage to croquis_app;
grant execute on function public.request_user_id(), public.owns_project(uuid) to croquis_app;

-- No direct access from the browser's Data API.
revoke all on
  public.profiles, public.projects, public.design_versions, public.notebook_messages, public.generation_jobs,
  public.assets, public.canvas_documents, public.user_measurements, public.tailor_sheets,
  public.saved_tutorials, public.provider_usage
  from anon, authenticated;
revoke execute on function public.request_user_id(), public.owns_project(uuid) from public, anon, authenticated;

create index if not exists provider_usage_paid_created_idx on public.provider_usage (created_at) where paid;
