-- TEST ONLY. The small parts of a Supabase database that our migrations use,
-- so the real migration files can run on a plain local PostgreSQL in tests.
-- (On Supabase these already exist and this file is never used.)

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$$;
-- Supabase gives these roles access to new public tables by default; copy that,
-- so the tests prove that migration 0004 takes it away again.
alter default privileges in schema public grant all on tables to anon, authenticated;
grant usage on schema public to anon, authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);

-- Supabase Realtime: just the parts migration 0008 uses. realtime.send() here
-- only records each broadcast in realtime.messages, so tests can check who was
-- told about what.
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key, topic text not null, extension text not null, event text,
  payload jsonb, private boolean default false, inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
  returns void language sql as $$
  insert into realtime.messages (topic, extension, event, payload, private) values (topic, 'broadcast', event, payload, private)
$$;
