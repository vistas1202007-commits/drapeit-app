-- Phase 6B: private accounts and follow requests, comments, reposts, and safety
-- tools (block, restrict, mute, report).
--
-- Run this AFTER 0001-0006, once, in the Supabase SQL Editor.
--
-- Same set-up as 0004 and 0006: the backend talks to these tables as the
-- "croquis_app" role and sets the signed-in user's id for each request
-- (public.request_user_id(), called "me" in the comments below). Row Level
-- Security decides, row by row, what that user may see or change. The browser
-- never reads these tables directly.
--
-- The big rules, all enforced by the database:
--   * Block: if either person blocked the other, they cannot see each other's
--     posts, comments, reposts or follower lists, cannot follow each other, and
--     cannot comment on or like each other's posts. Someone who blocked you also
--     disappears from your searches and their profile page is "not found".
--   * Private account: only approved followers (and the owner's Close Friends)
--     see the owner's posts, reposts and follower / following lists. Others send
--     a follow request that the owner can accept or decline.
--   * Restrict: comments from a restricted person on your posts wait for your
--     approval. Until then only they and you can see them.
--   * Mute: a personal filter. The backend leaves muted people's posts out of
--     your Home Feed and Explore; nothing else changes and they are not told.


-- ---------------------------------------------------------------------------
-- profiles.is_private: "only approved followers can see my posts".
-- Off (public) for everyone to begin with.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_private boolean not null default false;


-- ---------------------------------------------------------------------------
-- blocks: "A blocked B". Only A can see this row (B is never told).
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);


-- ---------------------------------------------------------------------------
-- restricts: "A restricted B". B's new comments on A's posts need A's approval.
-- Only A can see this row.
-- ---------------------------------------------------------------------------
create table public.restricts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  restricted_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, restricted_id),
  check (owner_id <> restricted_id)
);


-- ---------------------------------------------------------------------------
-- mutes: "A muted B". B's posts are left out of A's feed and Explore.
-- Only A can see this row.
-- ---------------------------------------------------------------------------
create table public.mutes (
  muter_id uuid not null references auth.users(id) on delete cascade,
  muted_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);


-- ---------------------------------------------------------------------------
-- follow_requests: "A asked to follow B" (B has a private account).
-- A and B can both see it. A can cancel it, B can decline it (both delete the
-- row). When B accepts, the backend adds the follow and deletes the request.
-- ---------------------------------------------------------------------------
create table public.follow_requests (
  requester_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);
create index follow_requests_target_idx on public.follow_requests (target_id, created_at desc);


-- ---------------------------------------------------------------------------
-- comments: what people write under a post. A reply points at the comment it
-- answers (parent_id); replies are one level deep (no replies to replies).
-- approved is false while a restricted person's comment waits for the post
-- owner's approval. The database sets it, not the app or the browser.
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  approved boolean not null default true,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_parent_idx on public.comments (parent_id);


-- ---------------------------------------------------------------------------
-- comment_likes: "this person likes this comment".
-- ---------------------------------------------------------------------------
create table public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);


-- ---------------------------------------------------------------------------
-- reposts: "A shared B's post on their own profile". The post itself is not
-- copied: it always shows the original designer's name, and people only see a
-- repost if they are allowed to see the original post.
-- Only public posts from public accounts can be reposted.
-- ---------------------------------------------------------------------------
create table public.reposts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index reposts_post_idx on public.reposts (post_id, created_at desc);
create index reposts_user_idx on public.reposts (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- reports: someone reported a post, a comment or a person, with a reason.
-- Kept for a future admin panel (which will use Supabase's own admin access).
-- People can only see their own reports and cannot change them.
-- excerpt is a short copy of what was reported (caption or comment text), so the
-- report still makes sense if the post or comment is deleted later.
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  post_id uuid references public.posts(id) on delete set null,
  comment_id uuid references public.comments(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('spam', 'nudity', 'harassment', 'hate', 'violence', 'scam',
                                         'copied_design', 'false_information', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  excerpt text not null default '' check (char_length(excerpt) <= 300),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Helper checks. "security definer" lets them look at the private lists
-- (blocks, restricts, close friends) but they only ever answer yes/no or counts.
-- ---------------------------------------------------------------------------
create or replace function public.has_blocked(blocker uuid, target uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker_id = blocker and blocked_id = target);
$$;

create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create or replace function public.is_private_account(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from public.profiles where id = uid), false);
$$;

-- May "me" see this person's posts-and-activity (reposts, follower lists)?
-- Yourself always; otherwise not when blocked either way, and for a private
-- account only if you follow them or are on their Close Friends list.
create or replace function public.can_see_activity(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.request_user_id() is not null and (
    uid = public.request_user_id()
    or (not public.is_blocked_between(public.request_user_id(), uid)
        and (not public.is_private_account(uid)
             or public.is_following(public.request_user_id(), uid)
             or public.is_close_friend(uid, public.request_user_id())))
  );
$$;

-- Follower and following totals for a profile (the lists themselves are
-- protected by the follows policy below).
create or replace function public.follow_counts(uid uuid) returns table (followers bigint, following bigint)
  language sql stable security definer set search_path = public as $$
  select (select count(*) from public.follows where following_id = uid),
         (select count(*) from public.follows where follower_id = uid)
  where public.request_user_id() is not null;
$$;

-- The one rule for "may the signed-in user see this post?" (replaces 0006's).
-- New in 0007: blocks either way hide everything, and a private account's
-- Public posts are only for its followers (and Close Friends).
create or replace function public.can_view_post(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and public.request_user_id() is not null
      and (
        p.author_id = public.request_user_id()
        or (p.status = 'published'
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

-- Is the signed-in user the author of this post?
create or replace function public.is_post_author(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts where id = pid and author_id = public.request_user_id());
$$;

-- "May the signed-in user see a comment with these details?" They must be able to
-- see the post, neither of them may have blocked the other, and a comment waiting
-- for approval is only for its writer and the post's owner. (It takes the comment's
-- own columns so it also works for a comment that is being saved right now.)
create or replace function public.comment_is_visible(pid uuid, writer uuid, is_approved boolean) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.can_view_post(pid)
     and not public.is_blocked_between(public.request_user_id(), writer)
     and (is_approved or writer = public.request_user_id() or public.is_post_author(pid));
$$;

-- The same question for a saved comment, by its id.
create or replace function public.can_view_comment(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.comments c
                 where c.id = cid and public.comment_is_visible(c.post_id, c.author_id, c.approved));
$$;

-- May the signed-in user repost this post? Published, Public, from a public
-- account, not their own, and they can see it.
create or replace function public.can_repost(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid and p.status = 'published' and p.visibility = 'public'
      and p.author_id <> public.request_user_id()
      and not public.is_private_account(p.author_id)
      and public.can_view_post(pid)
  );
$$;

-- Like, save and repost totals for a post the user may see (replaces 0006's,
-- which had no repost total). Saves themselves stay private.
drop function if exists public.post_counts(uuid);
create function public.post_counts(pid uuid) returns table (likes bigint, saves bigint, reposts bigint)
  language sql stable security definer set search_path = public as $$
  select (select count(*) from public.post_likes where post_id = pid),
         (select count(*) from public.post_saves where post_id = pid),
         (select count(*) from public.reposts where post_id = pid)
  where public.can_view_post(pid);
$$;

-- Likes + saves in the last 7 days, for Explore's Trending list.
create or replace function public.trending_score(pid uuid) returns bigint
  language sql stable security definer set search_path = public as $$
  select (select count(*) from public.post_likes where post_id = pid and created_at > now() - interval '7 days')
       + (select count(*) from public.post_saves where post_id = pid and created_at > now() - interval '7 days')
  where public.can_view_post(pid);
$$;

-- Before a comment is saved: replies must answer a top-level comment on the same
-- post, and a comment from someone the post owner restricted waits for approval.
create or replace function public.prepare_comment() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  post_author uuid;
begin
  if new.parent_id is not null then
    if not exists (select 1 from public.comments
                   where id = new.parent_id and post_id = new.post_id and parent_id is null) then
      raise exception 'Replies must answer a comment on the same post (one level only).'
        using errcode = 'check_violation';
    end if;
  end if;
  select author_id into post_author from public.posts where id = new.post_id;
  new.approved := new.author_id = post_author
                  or not exists (select 1 from public.restricts
                                 where owner_id = post_author and restricted_id = new.author_id);
  return new;
end;
$$;

create trigger comments_prepare before insert on public.comments
  for each row execute function public.prepare_comment();


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.blocks enable row level security;
alter table public.restricts enable row level security;
alter table public.mutes enable row level security;
alter table public.follow_requests enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.reposts enable row level security;
alter table public.reports enable row level security;

-- Profiles: hidden from people the owner blocked. (If you blocked someone you can
-- still see their name, so you can find them again and unblock.)
drop policy if exists "profiles are visible when signed in" on public.profiles;
create policy "profiles are visible unless they blocked you" on public.profiles for select
  using (public.request_user_id() is not null
         and (not public.has_blocked(id, public.request_user_id()) or public.has_blocked(public.request_user_id(), id)));

-- Follows: you always see your own; other rows only if you may see the activity
-- of one of the two people (private accounts and blocks hide their lists).
drop policy if exists "follows are visible when signed in" on public.follows;
create policy "follows you may see" on public.follows for select
  using (follower_id = public.request_user_id() or following_id = public.request_user_id()
         or public.can_see_activity(follower_id) or public.can_see_activity(following_id));
-- Following: either you follow a public account yourself, or you accept a request
-- someone sent to you. Never across a block.
drop policy if exists "follow as yourself" on public.follows;
create policy "follow a public account or accept a request" on public.follows for insert
  with check (
    not public.is_blocked_between(follower_id, following_id)
    and (
      (follower_id = public.request_user_id() and not public.is_private_account(following_id))
      or (following_id = public.request_user_id()
          and exists (select 1 from public.follow_requests r
                      where r.requester_id = follows.follower_id and r.target_id = follows.following_id))
    )
  );
-- Unfollow someone, or remove one of your followers.
drop policy if exists "unfollow as yourself" on public.follows;
create policy "unfollow or remove a follower" on public.follows for delete
  using (follower_id = public.request_user_id() or following_id = public.request_user_id());

create policy "see your own blocks" on public.blocks for select
  using (blocker_id = public.request_user_id());
create policy "block as yourself" on public.blocks for insert
  with check (blocker_id = public.request_user_id());
create policy "unblock as yourself" on public.blocks for delete
  using (blocker_id = public.request_user_id());

create policy "own restricted list" on public.restricts for all
  using (owner_id = public.request_user_id()) with check (owner_id = public.request_user_id());

create policy "own muted list" on public.mutes for all
  using (muter_id = public.request_user_id()) with check (muter_id = public.request_user_id());

create policy "see requests you sent or received" on public.follow_requests for select
  using (requester_id = public.request_user_id() or target_id = public.request_user_id());
create policy "ask to follow a private account" on public.follow_requests for insert
  with check (requester_id = public.request_user_id()
              and public.is_private_account(target_id)
              and not public.is_blocked_between(requester_id, target_id)
              and not public.is_following(requester_id, target_id));
create policy "cancel or decline a request" on public.follow_requests for delete
  using (requester_id = public.request_user_id() or target_id = public.request_user_id());

create policy "see comments you may see" on public.comments for select
  using (public.comment_is_visible(post_id, author_id, approved));
create policy "comment on published posts you may see" on public.comments for insert
  with check (author_id = public.request_user_id()
              and public.can_view_post(post_id)
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
              and (parent_id is null or public.can_view_comment(parent_id)));
-- Only the post's owner may change a comment, and only its "approved" flag (see grants).
create policy "post owner approves comments" on public.comments for update
  using (public.is_post_author(post_id)) with check (public.is_post_author(post_id));
create policy "delete your comment, or any comment on your post" on public.comments for delete
  using (author_id = public.request_user_id() or public.is_post_author(post_id));

create policy "see likes on comments you may see" on public.comment_likes for select
  using (public.can_view_comment(comment_id));
create policy "like comments you may see" on public.comment_likes for insert
  with check (user_id = public.request_user_id() and public.can_view_comment(comment_id));
create policy "remove your own comment like" on public.comment_likes for delete
  using (user_id = public.request_user_id());

create policy "see reposts you may see" on public.reposts for select
  using (public.can_view_post(post_id) and public.can_see_activity(user_id));
create policy "repost public posts" on public.reposts for insert
  with check (user_id = public.request_user_id() and public.can_repost(post_id));
create policy "undo your own repost" on public.reposts for delete
  using (user_id = public.request_user_id());

create policy "see your own reports" on public.reports for select
  using (reporter_id = public.request_user_id());
create policy "report what you can see" on public.reports for insert
  with check (
    reporter_id = public.request_user_id()
    and status = 'open'
    and (
      (target_type = 'post' and post_id is not null and public.can_view_post(post_id))
      or (target_type = 'comment' and comment_id is not null and public.can_view_comment(comment_id))
      or (target_type = 'user' and reported_user_id is not null and reported_user_id <> public.request_user_id())
    )
  );


-- ---------------------------------------------------------------------------
-- Who may use these tables: only the backend's role, never the browser's
-- Data API roles (anon / authenticated).
-- ---------------------------------------------------------------------------
grant select, insert, delete on
  public.blocks, public.restricts, public.mutes, public.follow_requests, public.comment_likes, public.reposts
  to croquis_app;
grant select, insert, delete on public.comments to croquis_app;
grant update (approved) on public.comments to croquis_app;
grant select, insert on public.reports to croquis_app;
grant execute on function public.has_blocked(uuid, uuid), public.is_blocked_between(uuid, uuid),
  public.is_private_account(uuid), public.can_see_activity(uuid), public.follow_counts(uuid),
  public.can_view_post(uuid), public.is_post_author(uuid), public.comment_is_visible(uuid, uuid, boolean),
  public.can_view_comment(uuid), public.can_repost(uuid),
  public.post_counts(uuid), public.trending_score(uuid) to croquis_app;

revoke all on
  public.blocks, public.restricts, public.mutes, public.follow_requests, public.comments, public.comment_likes,
  public.reposts, public.reports
  from anon, authenticated;
revoke execute on function public.has_blocked(uuid, uuid), public.is_blocked_between(uuid, uuid),
  public.is_private_account(uuid), public.can_see_activity(uuid), public.follow_counts(uuid),
  public.can_view_post(uuid), public.is_post_author(uuid), public.comment_is_visible(uuid, uuid, boolean),
  public.can_view_comment(uuid), public.can_repost(uuid),
  public.post_counts(uuid), public.trending_score(uuid), public.prepare_comment() from public, anon, authenticated;
