-- Phase 6A: profiles, following, close friends, and published posts (Instagram-like).
--
-- Run this AFTER 0001-0005, once, in the Supabase SQL Editor.
--
-- How access works (same as 0004): the backend talks to these tables as the
-- "croquis_app" role and sets the signed-in user's id for each request
-- (public.request_user_id()). Row Level Security below decides, row by row, what
-- that user may see or change. The browser never reads these tables directly.
--
-- What a post may contain is decided by the backend when publishing: only the
-- pictures, colours, fabric names, caption and tags the author chose. Measurements,
-- budget, notes and other client details are never copied into these tables.


-- ---------------------------------------------------------------------------
-- profiles: one row per person who has set up a public profile.
-- Holds their unique username (used in the address /u/<username>), the name shown
-- on their profile, a short bio, what they do (designer, tailor, ...) and where
-- their profile picture is stored. Every signed-in user can read profiles;
-- only the owner can create or change their own.
-- ---------------------------------------------------------------------------
alter table public.profiles  
  add column if not exists username text,
  add column if not exists bio text not null default '',
  add column if not exists role text not null default 'other',
  add column if not exists avatar_path text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles alter column username set not null;
alter table public.profiles alter column display_name set default '';
update public.profiles set display_name = '' where display_name is null;
alter table public.profiles alter column display_name set not null;

alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_.]{3,30}$'),
  add constraint profiles_display_name_length check (char_length(display_name) <= 60),
  add constraint profiles_bio_length check (char_length(bio) <= 300),
  add constraint profiles_role_choice check (role in ('designer', 'tailor', 'boutique', 'student', 'other'));

create unique index profiles_username_key on public.profiles (username);


-- ---------------------------------------------------------------------------
-- follows: "A follows B". Needed for posts shared with "Followers".
-- Anyone signed in can see who follows whom (for the counts on a profile);
-- you can only add or remove follows where you are the follower.
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on public.follows (following_id);


-- ---------------------------------------------------------------------------
-- close_friends: each person's own private "Close Friends" list.
-- Posts shared with "Close Friends" are shown only to the people on the author's
-- list. Only the list's owner can see or change it (people are never told they
-- were added or removed).
-- ---------------------------------------------------------------------------
create table public.close_friends (
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);


-- ---------------------------------------------------------------------------
-- posts: something an author shares from one of their designs.
-- status:     draft (only the author sees it), published, or archived (hidden
--             again, only the author sees it).
-- visibility: public (every signed-in user), followers, close_friends, or
--             private (only the author).
-- The caption, the three tags, and copies of the chosen colours and fabric names
-- live here. project_id remembers which design it came from (only the author
-- ever gets this); if that design is deleted, the post stays.
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility text not null default 'public' check (visibility in ('public', 'followers', 'close_friends', 'private')),
  caption text not null default '' check (char_length(caption) <= 2200),
  tag_garment text not null default '' check (char_length(tag_garment) <= 60),
  tag_fabric text not null default '' check (char_length(tag_fabric) <= 60),
  tag_occasion text not null default '' check (char_length(tag_occasion) <= 60),
  palette jsonb not null default '[]',   -- [{"name": "Wine", "hex": "#6d1a36"}], empty when not shown
  fabrics jsonb not null default '[]',   -- [{"name": "Velvet", "texture": "pile", "swatch": "#4a1426"}], empty when not shown
  pinned boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_feed_idx on public.posts (published_at desc, id desc) where status = 'published';
create index posts_author_idx on public.posts (author_id, status, published_at desc);


-- ---------------------------------------------------------------------------
-- post_images: the pictures in a post, in order. These are COPIES of the
-- design's sketches / generated pictures, saved under "posts/<author>/<post>/"
-- in the private storage bucket, so the post keeps working even if the design
-- changes. You can see a post's pictures only if you can see the post.
-- ---------------------------------------------------------------------------
create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  position integer not null check (position between 0 and 9),
  kind text not null check (kind in ('sketch', 'generated')),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);


-- ---------------------------------------------------------------------------
-- post_likes: "this person likes this post". Counted on every post; you can
-- like only posts you are allowed to see, and remove only your own like.
-- ---------------------------------------------------------------------------
create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);


-- ---------------------------------------------------------------------------
-- post_saves: "this person saved this post" (their "Saved" page). Private:
-- you only ever see your own saves; others only see the total number.
-- ---------------------------------------------------------------------------
create table public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_saves_user_idx on public.post_saves (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Helper checks. "security definer" lets them look at follows / close friends
-- even though those lists are private, but they only ever answer yes/no.
-- ---------------------------------------------------------------------------
create or replace function public.is_following(viewer uuid, author uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = viewer and following_id = author);
$$;

create or replace function public.is_close_friend(author uuid, viewer uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.close_friends where owner_id = author and friend_id = viewer);
$$;

-- The one rule for "may the signed-in user see this post?"
create or replace function public.can_view_post(pid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and public.request_user_id() is not null
      and (
        p.author_id = public.request_user_id()
        or (p.status = 'published' and (
              p.visibility = 'public'
              or (p.visibility = 'followers' and (public.is_following(public.request_user_id(), p.author_id)
                                                  or public.is_close_friend(p.author_id, public.request_user_id())))
              or (p.visibility = 'close_friends' and public.is_close_friend(p.author_id, public.request_user_id()))
        ))
      )
  );
$$;

-- Like and save totals for a post the user may see (saves themselves stay private).
create or replace function public.post_counts(pid uuid) returns table (likes bigint, saves bigint)
  language sql stable security definer set search_path = public as $$
  select (select count(*) from public.post_likes where post_id = pid),
         (select count(*) from public.post_saves where post_id = pid)
  where public.can_view_post(pid);
$$;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.follows enable row level security;
alter table public.close_friends enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "profiles are visible when signed in" on public.profiles for select
  using (public.request_user_id() is not null);
create policy "create own profile" on public.profiles for insert
  with check (id = public.request_user_id());
create policy "change own profile" on public.profiles for update
  using (id = public.request_user_id()) with check (id = public.request_user_id());
create policy "delete own profile" on public.profiles for delete
  using (id = public.request_user_id());

create policy "follows are visible when signed in" on public.follows for select
  using (public.request_user_id() is not null);
create policy "follow as yourself" on public.follows for insert
  with check (follower_id = public.request_user_id());
create policy "unfollow as yourself" on public.follows for delete
  using (follower_id = public.request_user_id());

create policy "own close friends list" on public.close_friends for all
  using (owner_id = public.request_user_id()) with check (owner_id = public.request_user_id());

create policy "see posts you are allowed to see" on public.posts for select
  using (public.can_view_post(id));
create policy "write your own posts" on public.posts for insert
  with check (author_id = public.request_user_id());
create policy "change your own posts" on public.posts for update
  using (author_id = public.request_user_id()) with check (author_id = public.request_user_id());
create policy "delete your own posts" on public.posts for delete
  using (author_id = public.request_user_id());

create policy "see pictures of posts you may see" on public.post_images for select
  using (public.can_view_post(post_id));
create policy "add pictures to your own posts" on public.post_images for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = public.request_user_id()));
create policy "remove pictures from your own posts" on public.post_images for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = public.request_user_id()));

create policy "see likes on posts you may see" on public.post_likes for select
  using (public.can_view_post(post_id));
create policy "like posts you may see" on public.post_likes for insert
  with check (user_id = public.request_user_id() and public.can_view_post(post_id));
create policy "remove your own like" on public.post_likes for delete
  using (user_id = public.request_user_id());

create policy "see your own saves" on public.post_saves for select
  using (user_id = public.request_user_id());
create policy "save posts you may see" on public.post_saves for insert
  with check (user_id = public.request_user_id() and public.can_view_post(post_id));
create policy "remove your own save" on public.post_saves for delete
  using (user_id = public.request_user_id());


-- ---------------------------------------------------------------------------
-- Who may use these tables: only the backend's role, never the browser's
-- Data API roles (anon / authenticated).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.profiles to croquis_app;
grant select, insert, update, delete on
  public.follows, public.close_friends, public.posts, public.post_images, public.post_likes, public.post_saves
  to croquis_app;
grant execute on function public.is_following(uuid, uuid), public.is_close_friend(uuid, uuid),
  public.can_view_post(uuid), public.post_counts(uuid) to croquis_app;

revoke all on
  public.follows, public.close_friends, public.posts, public.post_images, public.post_likes, public.post_saves
  from anon, authenticated;
revoke execute on function public.is_following(uuid, uuid), public.is_close_friend(uuid, uuid),
  public.can_view_post(uuid), public.post_counts(uuid) from public, anon, authenticated;
