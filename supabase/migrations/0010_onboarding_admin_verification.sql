-- Phase 6E: onboarding, the admin panel (reports queue, warnings, suspensions,
-- action log) and verified badges.
--
-- Run this AFTER 0001-0009, once, in the Supabase SQL Editor.
--
-- How access works (same as before): the backend talks to the database as the
-- "croquis_app" role and sets the signed-in user's id for each request
-- (public.request_user_id(), called "me" below). Row Level Security decides,
-- row by row, what that user may see or change. The browser never reads these
-- tables directly.
--
-- Admin tables (admin_users, admin_actions) are not granted to the app role
-- at all, so normal users can never read them. The backend's admin pages first
-- check is_admin() for the signed-in user, and only then use the database's own
-- login to moderate (that is the only way to act on other people's content).
--
-- MAKE YOURSELF ADMIN (run once in the SQL Editor, with your sign-in email):
--   insert into public.admin_users (user_id, note)
--   select id, 'owner' from auth.users where email = 'you@example.com';
-- Remove an admin:
--   delete from public.admin_users where user_id = (select id from auth.users where email = 'you@example.com');


-- ---------------------------------------------------------------------------
-- admin_users: the people who may open /admin. Added and removed only with SQL
-- (see above). Nobody can read this list through the app.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- admin_actions: a permanent log of every admin action (dismiss a report,
-- remove content, warn, suspend, lift a suspension, approve or reject a
-- verification, ...): who did it, to whom, about what, and a note.
-- Only admins can read it; rows are never changed or deleted by the app.
-- ---------------------------------------------------------------------------
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'dismiss_report', 'resolve_report', 'remove_post', 'remove_comment', 'remove_message', 'warn_user',
    'suspend_user', 'lift_suspension', 'update_problem_report', 'approve_verification', 'reject_verification',
    'remove_verification')),
  target_user_id uuid references auth.users(id) on delete set null,
  report_id uuid,
  target_id uuid,
  note text not null default '' check (char_length(note) <= 1000),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_actions_created_idx on public.admin_actions (created_at desc);


-- ---------------------------------------------------------------------------
-- account_suspensions: an admin stopped this person from posting, commenting,
-- reposting and messaging. ends_at empty = permanent. lifted_at is set when an
-- admin ends it early. The person can see their own suspensions (to show them
-- why), nobody else can.
-- ---------------------------------------------------------------------------
create table public.account_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index account_suspensions_user_idx on public.account_suspensions (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- user_warnings: an admin's warning to a person ("please follow the Community
-- Guidelines because ..."). The person sees it as a banner until they press
-- "I understand" (acknowledged_at). Only they (and admins) can see it.
-- ---------------------------------------------------------------------------
create table public.user_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  report_id uuid references public.reports(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index user_warnings_user_idx on public.user_warnings (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- verified_accounts: people with the verified badge, and where it came from:
-- 'admin' (an approved request) or 'premium' (kept for a later paid plan).
-- Everyone signed in may see who is verified; only the backend's admin pages
-- (or later the payment system) can add or remove a badge.
-- ---------------------------------------------------------------------------
create table public.verified_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null default 'admin' check (source in ('admin', 'premium')),
  verified_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);


-- ---------------------------------------------------------------------------
-- verification_requests: "please verify me", with a reason and a portfolio
-- link. Status pending -> approved or rejected by an admin, with a note. One
-- waiting request per person at a time. You see only your own requests.
-- ---------------------------------------------------------------------------
create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  portfolio_url text not null default '' check (char_length(portfolio_url) <= 300
                                                and (portfolio_url = '' or portfolio_url ~* '^https?://')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '' check (char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index verification_requests_one_pending on public.verification_requests (user_id) where status = 'pending';
create index verification_requests_status_idx on public.verification_requests (status, created_at);


-- ---------------------------------------------------------------------------
-- onboarding_progress: how far a new person got in the welcome steps
-- (profile -> picture -> interests -> people to follow -> tour), their chosen
-- interests (garments, fabrics, styles), and whether they finished or skipped.
-- Only they can see or change it.
-- ---------------------------------------------------------------------------
create table public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  step text not null default 'profile' check (step in ('profile', 'avatar', 'interests', 'follow', 'tour', 'done')),
  interests jsonb not null default '{"garments": [], "fabrics": [], "styles": []}',
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- profiles.verified: a copy of "is this person in verified_accounts", kept
-- up to date by the database (triggers below), so every name on every page can
-- show the badge without extra work. Nobody can set it by editing a profile.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists verified boolean not null default false;

create or replace function public.profiles_keep_verified() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.verified := exists (select 1 from public.verified_accounts where user_id = new.id);
  return new;
end;
$$;

create trigger profiles_keep_verified before insert or update on public.profiles
  for each row execute function public.profiles_keep_verified();

create or replace function public.verified_accounts_sync() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set verified = verified where id = coalesce(new.user_id, old.user_id);  -- the trigger above recomputes it
  return null;
end;
$$;

create trigger verified_accounts_sync after insert or update or delete on public.verified_accounts
  for each row execute function public.verified_accounts_sync();


-- ---------------------------------------------------------------------------
-- reports: chats can be reported too (a single message), and admins record
-- what they decided.
-- ---------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'user', 'message'));
alter table public.reports
  add column if not exists message_id uuid references public.messages(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_note text not null default '' check (char_length(resolution_note) <= 1000);


-- ---------------------------------------------------------------------------
-- Helper checks (security definer, yes/no only).
-- ---------------------------------------------------------------------------

-- Is the signed-in user an admin?
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = public.request_user_id());
$$;

-- Is this person suspended right now?
create or replace function public.is_suspended(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_suspensions
                 where user_id = uid and lifted_at is null and starts_at <= now()
                   and (ends_at is null or ends_at > now()));
$$;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.admin_actions enable row level security;
alter table public.account_suspensions enable row level security;
alter table public.user_warnings enable row level security;
alter table public.verified_accounts enable row level security;
alter table public.verification_requests enable row level security;
alter table public.onboarding_progress enable row level security;

create policy "admins only" on public.admin_users for select using (public.is_admin());
create policy "admins only" on public.admin_actions for select using (public.is_admin());

create policy "see your own suspensions" on public.account_suspensions for select
  using (user_id = public.request_user_id());

create policy "see your own warnings" on public.user_warnings for select
  using (user_id = public.request_user_id());
create policy "acknowledge your own warnings" on public.user_warnings for update
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());

create policy "verified badges are public" on public.verified_accounts for select
  using (public.request_user_id() is not null);

create policy "see your own verification requests" on public.verification_requests for select
  using (user_id = public.request_user_id());
create policy "ask to be verified" on public.verification_requests for insert
  with check (user_id = public.request_user_id() and status = 'pending' and reviewed_by is null
              and not exists (select 1 from public.verified_accounts v where v.user_id = public.request_user_id()));

create policy "own onboarding" on public.onboarding_progress for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());

-- Suspended people cannot publish, comment, repost or message (enforced here, not only in the app).
drop policy if exists "write your own posts" on public.posts;
create policy "write your own posts" on public.posts for insert
  with check (author_id = public.request_user_id()
              and (status <> 'published' or not public.is_suspended(public.request_user_id())));
drop policy if exists "change your own posts" on public.posts;
create policy "change your own posts" on public.posts for update
  using (author_id = public.request_user_id())
  with check (author_id = public.request_user_id()
              and (status <> 'published' or not public.is_suspended(public.request_user_id())));

drop policy if exists "comment on published posts you may see" on public.comments;
create policy "comment on published posts you may see" on public.comments for insert
  with check (author_id = public.request_user_id()
              and not public.is_suspended(public.request_user_id())
              and public.can_view_post(post_id)
              and public.comment_allowed(post_id)
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
              and (parent_id is null or public.can_view_comment(parent_id)));

drop policy if exists "repost public posts" on public.reposts;
create policy "repost public posts" on public.reposts for insert
  with check (user_id = public.request_user_id() and not public.is_suspended(public.request_user_id())
              and public.can_repost(post_id));

drop policy if exists "send messages where you may" on public.messages;
create policy "send messages where you may" on public.messages for insert
  with check (
    sender_id = public.request_user_id()
    and not public.is_suspended(public.request_user_id())
    and public.can_send_message(conversation_id)
    and (kind <> 'post' or post_id is not null)
    and (post_id is null or public.can_view_post(post_id))
    and (image_path is null or image_path like 'messages/' || conversation_id::text || '/%')
  );

-- Reports: a message in one of your chats can be reported too.
drop policy if exists "report what you can see" on public.reports;
create policy "report what you can see" on public.reports for insert
  with check (
    reporter_id = public.request_user_id()
    and status = 'open'
    and resolved_by is null
    and (
      (target_type = 'post' and post_id is not null and public.can_view_post(post_id))
      or (target_type = 'comment' and comment_id is not null and public.can_view_comment(comment_id))
      or (target_type = 'user' and reported_user_id is not null and reported_user_id <> public.request_user_id())
      or (target_type = 'message' and message_id is not null
          and exists (select 1 from public.messages m where m.id = message_id and m.sender_id <> public.request_user_id()))
    )
  );


-- ---------------------------------------------------------------------------
-- Who may use these tables. Admin tables: nobody through the app role (the
-- backend's admin pages use the database's own login after checking is_admin()).
-- ---------------------------------------------------------------------------
grant select on public.account_suspensions, public.verified_accounts to croquis_app;
grant select on public.user_warnings to croquis_app;
grant update (acknowledged_at) on public.user_warnings to croquis_app;
grant select, insert on public.verification_requests to croquis_app;
grant select, insert, update on public.onboarding_progress to croquis_app;
grant execute on function public.is_admin(), public.is_suspended(uuid) to croquis_app;

revoke all on public.admin_users, public.admin_actions from croquis_app, anon, authenticated;
revoke all on public.account_suspensions, public.user_warnings, public.verified_accounts,
  public.verification_requests, public.onboarding_progress from anon, authenticated;
revoke execute on function public.is_admin(), public.is_suspended(uuid), public.profiles_keep_verified(),
  public.verified_accounts_sync() from public, anon, authenticated;
