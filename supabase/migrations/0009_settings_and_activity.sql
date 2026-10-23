-- Phase 6D: full settings. Deactivate / delete account, more privacy controls
-- (hidden words, who can comment, who can mention me), "Your activity"
-- (recently deleted posts, search history, time spent) and "Report a problem".
--
-- Run this AFTER 0001-0008, once, in the Supabase SQL Editor.
--
-- Same set-up as before: the backend talks to these tables as the "croquis_app"
-- role and sets the signed-in user's id for each request
-- (public.request_user_id(), called "me" below). Row Level Security decides,
-- row by row, what that user may see or change. The browser never reads these
-- tables directly.
--
-- The big rules, all enforced by the database:
--   * A deactivated account, or one waiting to be deleted, is hidden from
--     everyone else: profile, posts, comments, and it cannot be messaged.
--   * Comments with one of the post owner's hidden words are only seen by
--     their writer and the post owner.
--   * "Who can comment" and "Who can mention me" are checked when a comment is
--     saved and when a mention notification is written.
--   * Deleted posts wait 30 days in "Recently deleted" (only the author sees
--     them), then the backend removes them for good.


-- ---------------------------------------------------------------------------
-- account_status: one row per person who deactivated their account or asked
-- for it to be deleted. No row = a normal, active account.
--   deactivated_at:      set when you deactivate; cleared when you sign in again.
--   delete_requested_at: set when you ask to delete your account. After 30 days
--                        the backend deletes the account, everything in it and
--                        its files. Cancel any time before that.
-- Only you can see or change your own row.
-- ---------------------------------------------------------------------------
create table public.account_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deactivated_at timestamptz,
  delete_requested_at timestamptz,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- privacy_settings: your extra privacy choices. No row = the defaults.
--   allow_comments_from: everyone / followers / nobody - who may comment on your
--                        posts (you can always comment on your own).
--   allow_mentions_from: everyone / followers / nobody - whose "@you" sends you a
--                        notification.
--   hidden_words:        comments on your posts with any of these words (or
--                        emoji) are hidden from everyone except you and the writer.
-- Only you can see or change your own row.
-- ---------------------------------------------------------------------------
create table public.privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allow_comments_from text not null default 'everyone' check (allow_comments_from in ('everyone', 'followers', 'nobody')),
  allow_mentions_from text not null default 'everyone' check (allow_mentions_from in ('everyone', 'followers', 'nobody')),
  hidden_words text[] not null default '{}' check (cardinality(hidden_words) <= 100),
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- search_history: what you searched for on Explore, newest first, so you can
-- see it and clear it. Only you can see or change your own searches.
-- ---------------------------------------------------------------------------
create table public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (char_length(btrim(query)) between 2 and 60),
  created_at timestamptz not null default now()
);
create unique index search_history_once on public.search_history (user_id, lower(query));
create index search_history_user_idx on public.search_history (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- time_spent: roughly how long you had the app open on each day (in seconds),
-- for "Time spent" in Your activity. The app sends a small "still here" ping
-- about once a minute while the page is visible; each ping adds at most one
-- minute. Only you can see your own.
-- ---------------------------------------------------------------------------
create table public.time_spent (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seconds integer not null default 0 check (seconds between 0 and 86400),
  last_ping_at timestamptz not null default now(),
  primary key (user_id, day)
);


-- ---------------------------------------------------------------------------
-- problem_reports: "Report a problem" from Help. What went wrong, on which
-- page, and an optional screenshot (stored in the private bucket under
-- "problem-reports/<user>/"). Kept for the team to read in Supabase.
-- People can send reports and see their own, but not change or delete them.
-- ---------------------------------------------------------------------------
create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('bug', 'account', 'design_tools', 'social', 'payments', 'other')),
  description text not null check (char_length(btrim(description)) between 5 and 2000),
  page text not null default '' check (char_length(page) <= 300),
  browser text not null default '' check (char_length(browser) <= 300),
  screenshot_path text,
  screenshot_mime text check (screenshot_mime is null or screenshot_mime in ('image/png', 'image/jpeg', 'image/webp')),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index problem_reports_status_idx on public.problem_reports (status, created_at desc);


-- ---------------------------------------------------------------------------
-- posts: "Recently deleted". Deleting a post now moves it here for 30 days
-- (status 'deleted'); only the author can see it, restore it, or delete it for
-- good. status_before_delete remembers where to put it back.
-- ---------------------------------------------------------------------------
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'published', 'archived', 'deleted'));
alter table public.posts
  add column if not exists deleted_at timestamptz,
  add column if not exists status_before_delete text
    check (status_before_delete is null or status_before_delete in ('draft', 'published', 'archived'));
create index posts_deleted_idx on public.posts (deleted_at) where status = 'deleted';


-- ---------------------------------------------------------------------------
-- Helper checks (security definer: they may read the private settings above,
-- but only ever answer yes/no).
-- ---------------------------------------------------------------------------

-- Is this account deactivated or waiting to be deleted (hidden from others)?
create or replace function public.is_hidden_account(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.account_status
                 where user_id = uid and (deactivated_at is not null or delete_requested_at is not null));
$$;

-- "everyone" / "followers" / "nobody" check: may "who" do this to "owner"?
-- The owner may always act on their own things.
create or replace function public.audience_allows(owner uuid, who uuid, setting text) returns boolean
  language sql stable security definer set search_path = public as $$
  select owner = who
      or coalesce(setting, 'everyone') = 'everyone'
      or (setting = 'followers' and public.is_following(who, owner));
$$;

-- May "me" comment on this post (the author's "Who can comment")?
create or replace function public.comment_allowed(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    left join public.privacy_settings s on s.user_id = p.author_id
    where p.id = pid and public.audience_allows(p.author_id, public.request_user_id(), s.allow_comments_from)
  );
$$;

-- Does this comment text contain one of the post owner's hidden words?
create or replace function public.has_hidden_word(pid uuid, content text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.privacy_settings s on s.user_id = p.author_id
    cross join unnest(s.hidden_words) w
    where p.id = pid and btrim(w) <> '' and position(lower(btrim(w)) in lower(content)) > 0
  );
$$;

-- The one rule for "may the signed-in user see this post?" (replaces 0007's).
-- New in 0009: the author's account must not be deactivated or waiting to be
-- deleted. ('deleted' posts are not 'published', so only their author sees them.)
create or replace function public.can_view_post(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and public.request_user_id() is not null
      and (
        p.author_id = public.request_user_id()
        or (p.status = 'published'
            and not public.is_hidden_account(p.author_id)
            and not public.is_blocked_between(public.request_user_id(), p.author_id)
            and (
              (p.visibility = 'public' and (not public.is_private_account(p.author_id)
                                            or public.is_following(public.request_user_id(), p.author_id)
                                            or public.is_close_friend(p.author_id, public.request_user_id())))
              or (p.visibility = 'followers' and (public.is_following(public.request_user_id(), p.author_id)
                                                  or public.is_close_friend(p.author_id, public.request_user_id())))
              or (p.visibility = 'close_friends' and public.is_close_friend(p.author_id, public.request_user_id()))
            ))
      )
  );
$$;

-- "May the signed-in user see a comment with these details?" (replaces 0007's
-- comment_is_visible in the comments policy). On top of 0007's rules: hidden
-- accounts' comments are hidden, and so are comments with the post owner's
-- hidden words, except for their writer and the post owner.
create or replace function public.comment_row_visible(pid uuid, writer uuid, is_approved boolean, content text)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select public.comment_is_visible(pid, writer, is_approved)
     and (writer = public.request_user_id() or not public.is_hidden_account(writer))
     and (writer = public.request_user_id() or public.is_post_author(pid) or not public.has_hidden_word(pid, content));
$$;

create or replace function public.can_view_comment(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.comments c
                 where c.id = cid and public.comment_row_visible(c.post_id, c.author_id, c.approved, c.body));
$$;

-- May "sender" start a chat with "recipient"? (replaces 0008's: hidden accounts cannot be messaged)
create or replace function public.messaging_allowed(sender uuid, recipient uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select sender is not null and recipient is not null and sender <> recipient
     and not public.is_blocked_between(sender, recipient)
     and not public.is_hidden_account(recipient)
     and exists (select 1 from public.profiles where id = sender)
     and exists (select 1 from public.profiles where id = recipient)
     and (public.is_following(recipient, sender)
          or coalesce((select allow_messages_from from public.profiles where id = recipient), 'everyone') = 'everyone'
          or (coalesce((select allow_messages_from from public.profiles where id = recipient), 'everyone') = 'followers'
              and public.is_following(sender, recipient)));
$$;

-- May "me" send in this chat now? (replaces 0008's: not to a hidden account)
create or replace function public.can_send_message(conv uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_conversation_member(conv) and exists (
    select 1 from public.conversation_members o
    where o.conversation_id = conv and o.user_id <> public.request_user_id()
      and not public.is_blocked_between(public.request_user_id(), o.user_id)
      and not public.is_hidden_account(o.user_id)
      and exists (select 1 from public.profiles where id = public.request_user_id())
      and exists (select 1 from public.profiles where id = o.user_id)
      and (o.status = 'accepted' or public.messaging_allowed(public.request_user_id(), o.user_id))
  );
$$;

-- "@username" mentions (replaces 0008's): only people whose "Who can mention
-- me" allows the writer get a notification.
create or replace function public.notify_mentions(content text, actor uuid, post uuid, comment uuid, skip uuid[])
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  mentioned uuid;
begin
  for mentioned in
    select pr.id from public.profiles pr
    left join public.privacy_settings s on s.user_id = pr.id
    where pr.username in (
      select distinct rtrim(lower(m[1]), '.')
      from regexp_matches(coalesce(content, ''), '(?:^|[^a-z0-9_.@])@([a-z0-9_.]{3,30})', 'gi') as m
      limit 10)
      and public.audience_allows(pr.id, actor, s.allow_mentions_from)
      and pr.id <> actor
  loop
    if not (mentioned = any(coalesce(skip, '{}'))) then
      perform public.notify(mentioned, actor, 'mention', post, comment, null);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.account_status enable row level security;
alter table public.privacy_settings enable row level security;
alter table public.search_history enable row level security;
alter table public.time_spent enable row level security;
alter table public.problem_reports enable row level security;

create policy "own account status" on public.account_status for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());
create policy "own privacy settings" on public.privacy_settings for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());
create policy "own search history" on public.search_history for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());
create policy "own time spent" on public.time_spent for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());
create policy "see your own problem reports" on public.problem_reports for select
  using (user_id = public.request_user_id());
create policy "send a problem report" on public.problem_reports for insert
  with check (user_id = public.request_user_id() and status = 'open'
              and (screenshot_path is null
                   or screenshot_path like 'problem-reports/' || public.request_user_id()::text || '/%'));

-- Profiles: also hidden while the account is deactivated or waiting to be deleted
-- (you always see your own).
drop policy if exists "profiles are visible unless they blocked you" on public.profiles;
create policy "profiles are visible unless hidden or they blocked you" on public.profiles for select
  using (public.request_user_id() is not null
         and (id = public.request_user_id()
              or (not public.is_hidden_account(id)
                  and (not public.has_blocked(id, public.request_user_id())
                       or public.has_blocked(public.request_user_id(), id)))));

-- Comments: the new visibility rule, and "Who can comment".
drop policy if exists "see comments you may see" on public.comments;
create policy "see comments you may see" on public.comments for select
  using (public.comment_row_visible(post_id, author_id, approved, body));
drop policy if exists "comment on published posts you may see" on public.comments;
create policy "comment on published posts you may see" on public.comments for insert
  with check (author_id = public.request_user_id()
              and public.can_view_post(post_id)
              and public.comment_allowed(post_id)
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
              and (parent_id is null or public.can_view_comment(parent_id)));

-- Notifications: also leave out people whose account is hidden.
drop policy if exists "see your own notifications" on public.notifications;
create policy "see your own notifications" on public.notifications for select
  using (
    user_id = public.request_user_id()
    and (actor_id is null or (not public.is_blocked_between(user_id, actor_id)
                              and not public.is_hidden_account(actor_id)))
    and (post_id is null or public.can_view_post(post_id))
    and (comment_id is null or public.can_view_comment(comment_id))
  );


-- ---------------------------------------------------------------------------
-- Who may use these tables: only the backend's role, never the browser's
-- Data API roles (anon / authenticated).
-- ---------------------------------------------------------------------------
grant select, insert, update on public.account_status, public.privacy_settings, public.time_spent to croquis_app;
grant select, insert, update, delete on public.search_history to croquis_app;
grant select, insert on public.problem_reports to croquis_app;
grant execute on function public.is_hidden_account(uuid), public.audience_allows(uuid, uuid, text),
  public.comment_allowed(uuid), public.has_hidden_word(uuid, text),
  public.comment_row_visible(uuid, uuid, boolean, text) to croquis_app;

revoke all on public.account_status, public.privacy_settings, public.search_history, public.time_spent,
  public.problem_reports from anon, authenticated;
revoke execute on function public.is_hidden_account(uuid), public.audience_allows(uuid, uuid, text),
  public.comment_allowed(uuid), public.has_hidden_word(uuid, text),
  public.comment_row_visible(uuid, uuid, boolean, text) from public, anon, authenticated;
