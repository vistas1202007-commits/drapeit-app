-- Phase 6C: direct messages (chats, message requests, "Seen") and notifications.
--
-- Run this AFTER 0001-0007, once, in the Supabase SQL Editor.
--
-- Same set-up as 0004, 0006 and 0007: the backend talks to these tables as the
-- "croquis_app" role and sets the signed-in user's id for each request
-- (public.request_user_id(), called "me" in the comments below). Row Level
-- Security decides, row by row, what that user may see or change. The browser
-- never reads these tables directly.
--
-- The big rules, all enforced by the database:
--   * Only the two people in a chat can read its messages.
--   * You can only send a message as yourself, never across a block, and only
--     if the other person accepts messages from you (their "Who can message me"
--     setting), or they already accepted the chat, or they follow you.
--   * A chat from someone the receiver does not follow lands in their Requests
--     folder until they accept it (or reply).
--   * You only ever see your own notifications, and only about things you are
--     still allowed to see (a post that became private, a deleted comment or a
--     blocked person drop out on their own).
--   * Live updates (Supabase Realtime) only carry "something changed in chat X"
--     to a private channel that only you can listen to. The message text never
--     travels that way: the app then asks the backend, which checks again.
 

-- ---------------------------------------------------------------------------
-- profiles.allow_messages_from: "Who can message me".
--   everyone  - anyone with a profile can start a chat (it may be a request)
--   followers - only people who follow you can start a chat
--   nobody    - nobody can start a new chat
-- People you follow can always message you, and chats you already accepted
-- keep working whatever you choose here.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists allow_messages_from text not null default 'everyone';
alter table public.profiles add constraint profiles_allow_messages_from_choice
  check (allow_messages_from in ('everyone', 'followers', 'nobody'));


-- ---------------------------------------------------------------------------
-- conversations: one private chat between two people. There is at most one
-- chat for each pair (user_low is always the smaller id, so A-B and B-A are the
-- same row). last_message_at is used to sort the inbox. The backend never
-- creates these directly: it calls start_conversation() below, which checks
-- the rules first.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  started_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (user_low, user_high),
  check (user_low < user_high)
);


-- ---------------------------------------------------------------------------
-- conversation_members: each person's own side of a chat (two rows per chat).
-- status:       'accepted' (in your Chats list) or 'request' (in your Requests
--               folder, because you do not follow the person who wrote first).
-- last_read_at: when you last opened the chat. Messages after this are
--               "unread" for you; the other person sees "Seen" when it is later
--               than their message.
-- cleared_at:   when you deleted the chat. Older messages are hidden for you
--               only; the other person still has them.
-- Both people can see both rows (that is how "Seen" works); you can only change
-- your own row.
-- ---------------------------------------------------------------------------
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'request' check (status in ('accepted', 'request')),
  last_read_at timestamptz,
  cleared_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);


-- ---------------------------------------------------------------------------
-- messages: what people write in a chat.
-- kind 'text':   just words (body).
-- kind 'post':   a shared post (post_id) with optional words. If the post is
--                deleted, post_id becomes empty and the app says so. The
--                receiver only sees the post if they are allowed to see it.
-- kind 'design': a picture from one of the sender's own designs. It is a COPY,
--                saved under "messages/<chat id>/" in the private storage
--                bucket, so it can be shown to the receiver without opening the
--                design itself.
-- Only the two people in the chat can read messages. Only the sender can
-- delete ("unsend") a message, and then it is gone for both.
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'post', 'design')),
  body text not null default '' check (char_length(body) <= 2000),
  post_id uuid references public.posts(id) on delete set null,
  image_path text,
  image_mime text check (image_mime is null or image_mime in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  created_at timestamptz not null default clock_timestamp(),
  check (kind <> 'text' or char_length(btrim(body)) > 0),
  check (kind <> 'design' or (image_path is not null and image_mime is not null))
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_post_idx on public.messages (post_id) where post_id is not null;


-- ---------------------------------------------------------------------------
-- notifications: "something happened that involves you".
-- user_id is who it is for, actor_id is who did it. type is one of:
--   like, comment, reply, follow, follow_request, mention, repost, message.
-- post_id / comment_id / conversation_id say what it is about. read_at stays
-- empty until you read it (the unread dot).
-- They are written by the database itself (triggers below) whenever a like,
-- comment, follow, ... is saved, so nothing can be missed. Undoing a like,
-- repost, follow or follow request removes its notification again. A chat has
-- at most one "message" notification, moved to the top for each new message.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'reply', 'follow', 'follow_request', 'mention', 'repost', 'message')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc, id desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
-- No duplicates: one per like / repost of a post, one per follow / request, one per chat.
create unique index notifications_once_per_post on public.notifications (user_id, actor_id, type, post_id)
  where type in ('like', 'repost');
create unique index notifications_once_per_person on public.notifications (user_id, actor_id, type)
  where type in ('follow', 'follow_request');
create unique index notifications_once_per_comment on public.notifications (user_id, comment_id, type)
  where comment_id is not null;
create unique index notifications_once_per_chat on public.notifications (user_id, conversation_id)
  where type = 'message';


-- ---------------------------------------------------------------------------
-- notification_settings: which kinds of notification each person wants.
-- No row means "everything on". Only the owner can see or change their row.
-- ---------------------------------------------------------------------------
create table public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  likes boolean not null default true,
  comments boolean not null default true,
  replies boolean not null default true,
  follows boolean not null default true,
  follow_requests boolean not null default true,
  mentions boolean not null default true,
  reposts boolean not null default true,
  messages boolean not null default true,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Helper checks. "security definer" lets them look at both sides of a chat and
-- the private block / follow lists, but they only ever answer yes/no or an id.
-- ---------------------------------------------------------------------------

-- Is "me" one of the two people in this chat?
create or replace function public.is_conversation_member(conv uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
                 where conversation_id = conv and user_id = public.request_user_id());
$$;

-- May "me" see a message with these details? Members only, and not one from
-- before the moment they deleted the chat. (It takes the message's own columns
-- so it also works for a message that is being saved right now.)
create or replace function public.message_is_visible(conv uuid, sent_at timestamptz) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
                 where conversation_id = conv and user_id = public.request_user_id()
                   and (cleared_at is null or sent_at > cleared_at));
$$;

-- May "sender" start a chat with "recipient"? Never across a block, both need a
-- profile, and the recipient's "Who can message me" setting must allow it
-- (people the recipient follows are always allowed).
create or replace function public.messaging_allowed(sender uuid, recipient uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select sender is not null and recipient is not null and sender <> recipient
     and not public.is_blocked_between(sender, recipient)
     and exists (select 1 from public.profiles where id = sender)
     and exists (select 1 from public.profiles where id = recipient)
     and (public.is_following(recipient, sender)
          or coalesce((select allow_messages_from from public.profiles where id = recipient), 'everyone') = 'everyone'
          or (coalesce((select allow_messages_from from public.profiles where id = recipient), 'everyone') = 'followers'
              and public.is_following(sender, recipient)));
$$;

-- May "me" send a message in this chat right now? Members only, never across a
-- block, and the other person must have accepted the chat or still accept
-- messages from "me".
create or replace function public.can_send_message(conv uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_conversation_member(conv) and exists (
    select 1 from public.conversation_members o
    where o.conversation_id = conv and o.user_id <> public.request_user_id()
      and not public.is_blocked_between(public.request_user_id(), o.user_id)
      and exists (select 1 from public.profiles where id = public.request_user_id())
      and exists (select 1 from public.profiles where id = o.user_id)
      and (o.status = 'accepted' or public.messaging_allowed(public.request_user_id(), o.user_id))
  );
$$;

-- Find the chat between "me" and another person, or start it if the rules allow.
-- The receiver's side starts in their Requests folder unless they follow "me".
create or replace function public.start_conversation(other uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.request_user_id();
  lo uuid;
  hi uuid;
  conv uuid;
begin
  if me is null then
    raise exception 'Please sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if other is null or other = me then
    raise exception 'You cannot send messages to yourself.' using errcode = 'check_violation';
  end if;
  lo := least(me, other);
  hi := greatest(me, other);
  select id into conv from public.conversations where user_low = lo and user_high = hi;
  if conv is not null then
    return conv;
  end if;
  if not public.messaging_allowed(me, other) then
    raise exception 'This person is not accepting messages from you.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.conversations (user_low, user_high, started_by) values (lo, hi, me)
    on conflict (user_low, user_high) do nothing returning id into conv;
  if conv is null then  -- the other person started the same chat at the same moment
    select id into conv from public.conversations where user_low = lo and user_high = hi;
    return conv;
  end if;
  insert into public.conversation_members (conversation_id, user_id, status) values
    (conv, me, 'accepted'),
    (conv, other, case when public.is_following(other, me) then 'accepted' else 'request' end);
  return conv;
end;
$$;

-- Does this person want this kind of notification? (No settings row = yes.)
create or replace function public.wants_notification(uid uuid, kind text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select case kind
             when 'like' then s.likes when 'comment' then s.comments when 'reply' then s.replies
             when 'follow' then s.follows when 'follow_request' then s.follow_requests
             when 'mention' then s.mentions when 'repost' then s.reposts when 'message' then s.messages
             else true end
    from public.notification_settings s where s.user_id = uid), true);
$$;

-- Tell one person's open app (over Supabase Realtime) that something changed.
-- Only the event name and a chat id are sent, never message text. On a
-- database without Realtime (the tests) this does nothing, and a Realtime
-- problem never stops a message or notification from being saved.
create or replace function public.broadcast_to_user(uid uuid, event text, conv uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if uid is null or to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    return;
  end if;
  execute 'select realtime.send($1, $2, $3, true)'
    using jsonb_build_object('conversation_id', conv), event, 'user:' || uid::text;
exception when others then
  return;
end;
$$;

-- Write one notification (if the person wants it), then ping their open app.
create or replace function public.notify(recipient uuid, actor uuid, kind text, post uuid default null,
                                         comment uuid default null, conv uuid default null) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if recipient is null or actor is null or recipient = actor then
    return;
  end if;
  if public.is_blocked_between(recipient, actor) or not public.wants_notification(recipient, kind) then
    return;
  end if;
  if kind = 'message' then
    insert into public.notifications (user_id, actor_id, type, conversation_id)
      values (recipient, actor, 'message', conv)
      on conflict (user_id, conversation_id) where type = 'message'
      do update set actor_id = excluded.actor_id, created_at = clock_timestamp(), read_at = null;
  else
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
      values (recipient, actor, kind, post, comment)
      on conflict do nothing;
  end if;
  perform public.broadcast_to_user(recipient, 'notification', conv);
end;
$$;

-- "@username" mentions in a text (at most 10 people), except the people in skip.
create or replace function public.notify_mentions(content text, actor uuid, post uuid, comment uuid, skip uuid[])
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  mentioned uuid;
begin
  for mentioned in
    select pr.id from public.profiles pr
    where pr.username in (
      select distinct rtrim(lower(m[1]), '.')
      from regexp_matches(coalesce(content, ''), '(?:^|[^a-z0-9_.@])@([a-z0-9_.]{3,30})', 'gi') as m
      limit 10)
  loop
    if not (mentioned = any(coalesce(skip, '{}'))) then
      perform public.notify(mentioned, actor, 'mention', post, comment, null);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- Triggers: chats
-- ---------------------------------------------------------------------------

-- After a message is saved: move the chat up the inbox, mark it read and
-- accepted for the sender (replying accepts a request), move it out of the
-- receiver's Requests if they follow the sender now, notify the receiver, and
-- ping both people's open apps.
create or replace function public.after_message_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_members
     set status = 'accepted', last_read_at = greatest(coalesce(last_read_at, new.created_at), new.created_at)
   where conversation_id = new.conversation_id and user_id = new.sender_id;
  select user_id into other from public.conversation_members
   where conversation_id = new.conversation_id and user_id <> new.sender_id;
  update public.conversation_members set status = 'accepted'
   where conversation_id = new.conversation_id and user_id = other and status = 'request'
     and public.is_following(other, new.sender_id);
  perform public.notify(other, new.sender_id, 'message', null, null, new.conversation_id);
  perform public.broadcast_to_user(other, 'message', new.conversation_id);
  perform public.broadcast_to_user(new.sender_id, 'message', new.conversation_id);
  return null;
end;
$$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public.after_message_insert();

-- After a message is unsent: ping both people so it disappears for them too.
create or replace function public.after_message_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  member uuid;
begin
  for member in select user_id from public.conversation_members where conversation_id = old.conversation_id loop
    perform public.broadcast_to_user(member, 'message', old.conversation_id);
  end loop;
  return null;
end;
$$;

create trigger messages_after_delete after delete on public.messages
  for each row execute function public.after_message_delete();

-- After someone reads a chat: ping the other person, so "Seen" shows at once.
create or replace function public.after_chat_read() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  select user_id into other from public.conversation_members
   where conversation_id = new.conversation_id and user_id <> new.user_id;
  perform public.broadcast_to_user(other, 'seen', new.conversation_id);
  return null;
end;
$$;

create trigger conversation_members_after_read after update of last_read_at on public.conversation_members
  for each row when (new.last_read_at is distinct from old.last_read_at)
  execute function public.after_chat_read();


-- ---------------------------------------------------------------------------
-- Triggers: notifications for likes, reposts, follows, follow requests,
-- comments, replies and mentions
-- ---------------------------------------------------------------------------

create or replace function public.notify_post_reaction() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  kind text := case tg_table_name when 'post_likes' then 'like' else 'repost' end;
begin
  if tg_op = 'INSERT' then
    perform public.notify((select author_id from public.posts where id = new.post_id), new.user_id, kind, new.post_id);
  else
    delete from public.notifications where type = kind and actor_id = old.user_id and post_id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger post_likes_notify after insert or delete on public.post_likes
  for each row execute function public.notify_post_reaction();
create trigger reposts_notify after insert or delete on public.reposts
  for each row execute function public.notify_post_reaction();

-- A new follower. (Accepting a follow request also adds a follow, but then the
-- person who accepted does not need to be told about it.)
create or replace function public.notify_follow() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.follow_requests
                   where requester_id = new.follower_id and target_id = new.following_id) then
      perform public.notify(new.following_id, new.follower_id, 'follow');
    end if;
  else
    delete from public.notifications
     where type = 'follow' and user_id = old.following_id and actor_id = old.follower_id;
  end if;
  return null;
end;
$$;

create trigger follows_notify after insert or delete on public.follows
  for each row execute function public.notify_follow();

-- A follow request (removed again when it is accepted, declined or cancelled).
create or replace function public.notify_follow_request() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(new.target_id, new.requester_id, 'follow_request');
  else
    delete from public.notifications
     where type = 'follow_request' and user_id = old.target_id and actor_id = old.requester_id;
  end if;
  return null;
end;
$$;

create trigger follow_requests_notify after insert or delete on public.follow_requests
  for each row execute function public.notify_follow_request();

-- A comment tells the post's owner; a reply also tells the person it answers;
-- "@username" in it tells the people mentioned (once each).
create or replace function public.notify_comment() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  post_author uuid;
  parent_author uuid;
begin
  select author_id into post_author from public.posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into parent_author from public.comments where id = new.parent_id;
    perform public.notify(parent_author, new.author_id, 'reply', new.post_id, new.id);
  end if;
  if post_author is distinct from parent_author then
    perform public.notify(post_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  perform public.notify_mentions(new.body, new.author_id, new.post_id, new.id,
                                 array_remove(array[post_author, parent_author], null));
  return null;
end;
$$;

create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

-- "@username" in a caption tells the people mentioned when the post is published.
create or replace function public.notify_post_mentions() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.notify_mentions(new.caption, new.author_id, new.id, null, null);
  end if;
  return null;
end;
$$;

create trigger posts_notify_mentions after insert or update of status on public.posts
  for each row execute function public.notify_post_mentions();


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;

-- Chats are only visible to their two members. New chats are only made by
-- start_conversation() (no insert policy), and nobody may delete one.
create policy "see your own chats" on public.conversations for select
  using (public.is_conversation_member(id));

create policy "see both sides of your chats" on public.conversation_members for select
  using (public.is_conversation_member(conversation_id));
-- Your own side only: accept a request, mark as read, delete for yourself (see grants).
create policy "change your own side of a chat" on public.conversation_members for update
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());

create policy "read messages in your chats" on public.messages for select
  using (public.message_is_visible(conversation_id, created_at));
create policy "send messages where you may" on public.messages for insert
  with check (
    sender_id = public.request_user_id()
    and public.can_send_message(conversation_id)
    and (kind <> 'post' or post_id is not null)
    and (post_id is null or public.can_view_post(post_id))
    and (image_path is null or image_path like 'messages/' || conversation_id::text || '/%')
  );
create policy "unsend your own messages" on public.messages for delete
  using (sender_id = public.request_user_id());

-- Your own notifications, about things you may still see.
create policy "see your own notifications" on public.notifications for select
  using (
    user_id = public.request_user_id()
    and (actor_id is null or not public.is_blocked_between(user_id, actor_id))
    and (post_id is null or public.can_view_post(post_id))
    and (comment_id is null or public.can_view_comment(comment_id))
  );
create policy "mark your own notifications read" on public.notifications for update
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());

create policy "own notification settings" on public.notification_settings for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());


-- ---------------------------------------------------------------------------
-- Who may use these tables: only the backend's role, never the browser's
-- Data API roles (anon / authenticated).
-- ---------------------------------------------------------------------------
grant select on public.conversations, public.conversation_members to croquis_app;
grant update (status, last_read_at, cleared_at) on public.conversation_members to croquis_app;
grant select, insert, delete on public.messages to croquis_app;
grant select on public.notifications to croquis_app;
grant update (read_at) on public.notifications to croquis_app;
grant select, insert, update on public.notification_settings to croquis_app;
grant execute on function public.is_conversation_member(uuid), public.message_is_visible(uuid, timestamptz),
  public.messaging_allowed(uuid, uuid), public.can_send_message(uuid), public.start_conversation(uuid)
  to croquis_app;

revoke all on public.conversations, public.conversation_members, public.messages, public.notifications,
  public.notification_settings from anon, authenticated;
revoke execute on function public.is_conversation_member(uuid), public.message_is_visible(uuid, timestamptz),
  public.messaging_allowed(uuid, uuid), public.can_send_message(uuid), public.start_conversation(uuid),
  public.wants_notification(uuid, text), public.broadcast_to_user(uuid, text, uuid),
  public.notify(uuid, uuid, text, uuid, uuid, uuid), public.notify_mentions(text, uuid, uuid, uuid, uuid[]),
  public.after_message_insert(), public.after_message_delete(), public.after_chat_read(),
  public.notify_post_reaction(), public.notify_follow(), public.notify_follow_request(), public.notify_comment(),
  public.notify_post_mentions()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Supabase Realtime: each signed-in person may listen to their own private
-- channel "user:<their id>" and nobody else's. (Only on Supabase; skipped on a
-- plain PostgreSQL.) The app subscribes with { private: true }.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "croquis: listen to your own channel" on realtime.messages';
    execute $policy$
      create policy "croquis: listen to your own channel" on realtime.messages for select to authenticated
        using (realtime.messages.extension = 'broadcast'
               and realtime.topic() = 'user:' || (select auth.uid())::text)
    $policy$;
  end if;
end
$$;
