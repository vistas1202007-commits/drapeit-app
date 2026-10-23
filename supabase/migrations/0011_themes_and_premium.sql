-- Phase 8: themes (app theme, profile theme, custom theme) and the Premium flag.
--
-- Run this AFTER 0001-0010, once, in the Supabase SQL Editor.
--
-- Same set-up as before: the backend talks to these tables as the "croquis_app"
-- role and sets the signed-in user's id for each request (public.request_user_id(),
-- called "me" below). Row Level Security decides what that user may see or change.
-- Nothing in the existing tables is changed.
--
-- In simple words:
--   * appearance_settings: one row per person with the theme for the app (only
--     they see it), the theme for their public profile, and their own custom
--     colours. Only they can read or change their row.
--   * profile_appearance(): lets visitors of /u/<username> read ONLY the profile
--     theme part of someone's row (never the app theme).
--   * premium_members: who has Premium. People can only see their own row and can
--     never add or change one; that is done with SQL now, and later by payments.
--   * Premium themes (Silk, Velvet, Brocade, Khadi, Chiffon) and custom themes are
--     refused by the database for people without Premium, even if the app had a bug.
--
-- GIVE SOMEONE PREMIUM BY HAND (for testing, run in the SQL Editor):
--   insert into public.premium_members (user_id, source)
--   select id, 'manual' from auth.users where email = 'you@example.com';
-- Take it away again:
--   delete from public.premium_members where user_id = (select id from auth.users where email = 'you@example.com');


-- ---------------------------------------------------------------------------
-- premium_members: people with Premium. ends_at empty = no end date.
-- source 'manual' = added with SQL; 'payment' is kept for the later paid plan.
-- ---------------------------------------------------------------------------
create table public.premium_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'payment')),
  started_at timestamptz not null default now(),
  ends_at timestamptz
);

-- Is this person Premium right now? (security definer: works for anyone's id, says only yes or no.)
create or replace function public.is_premium(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.premium_members m
                 where m.user_id = uid and m.started_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;


-- ---------------------------------------------------------------------------
-- appearance_settings: the chosen themes and the custom theme.
--   app_theme:     'system' (follow the device's light / dark), a fabric theme, or 'custom'
--   profile_theme: 'default' (the visitor's own app theme), a fabric theme, or 'custom'
--   custom_theme:  {"brand", "background", "text": "#rrggbb", "texture", "font", "cover"}
-- ---------------------------------------------------------------------------
create table public.appearance_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_theme text not null default 'system' check (app_theme in (
    'system', 'light', 'dark', 'linen', 'cotton', 'denim', 'silk', 'velvet', 'brocade', 'khadi', 'chiffon', 'custom')),
  profile_theme text not null default 'default' check (profile_theme in (
    'default', 'light', 'dark', 'linen', 'cotton', 'denim', 'silk', 'velvet', 'brocade', 'khadi', 'chiffon', 'custom')),
  custom_theme jsonb check (custom_theme is null or (
    jsonb_typeof(custom_theme) = 'object'
    and custom_theme->>'brand' ~ '^#[0-9a-fA-F]{6}$'
    and custom_theme->>'background' ~ '^#[0-9a-fA-F]{6}$'
    and custom_theme->>'text' ~ '^#[0-9a-fA-F]{6}$'
    and custom_theme->>'texture' in ('none', 'linen', 'cotton', 'denim', 'silk', 'velvet', 'brocade', 'khadi', 'chiffon')
    and custom_theme->>'font' in ('fraunces', 'cormorant', 'playfair', 'inter')
    and custom_theme->>'cover' in ('drape', 'stripes', 'motif', 'plain'))),
  updated_at timestamptz not null default now()
);

-- Premium themes and custom themes need Premium. Checked on every save.
create or replace function public.appearance_check_premium() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  premium_choices text[] := array['silk', 'velvet', 'brocade', 'khadi', 'chiffon', 'custom'];
  is_new boolean := tg_op = 'INSERT';
begin
  -- Only a newly chosen Premium value is refused: keeping one saved earlier (for example after
  -- Premium ended) is fine, so people can still change their other settings.
  if not public.is_premium(new.user_id) and (
       (new.app_theme = any(premium_choices) and (is_new or new.app_theme is distinct from old.app_theme))
    or (new.profile_theme = any(premium_choices) and (is_new or new.profile_theme is distinct from old.profile_theme))
    or (new.custom_theme is not null and (is_new or new.custom_theme is distinct from old.custom_theme))) then
    raise exception 'premium_required' using errcode = 'check_violation',
      hint = 'Premium themes and custom themes need Premium.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger appearance_check_premium before insert or update on public.appearance_settings
  for each row execute function public.appearance_check_premium();

-- What a visitor may know about someone's profile look: the profile theme, the custom
-- theme only when the profile uses it, and whether they are Premium (for the small tag).
create or replace function public.profile_appearance(uid uuid)
  returns table (profile_theme text, custom_theme jsonb, is_premium boolean)
  language sql stable security definer set search_path = public as $$
  select coalesce(a.profile_theme, 'default'),
         case when a.profile_theme = 'custom' then a.custom_theme end,
         public.is_premium(uid)
  from (select 1) one
  left join public.appearance_settings a on a.user_id = uid
  where public.request_user_id() is not null;
$$;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.premium_members enable row level security;
alter table public.appearance_settings enable row level security;

create policy "see your own premium" on public.premium_members for select
  using (user_id = public.request_user_id());

create policy "own appearance" on public.appearance_settings for all
  using (user_id = public.request_user_id()) with check (user_id = public.request_user_id());


-- ---------------------------------------------------------------------------
-- Who may use these tables. premium_members: read only (never insert / update / delete).
-- ---------------------------------------------------------------------------
grant select on public.premium_members to croquis_app;
grant select, insert, update on public.appearance_settings to croquis_app;
grant execute on function public.is_premium(uuid), public.profile_appearance(uuid) to croquis_app;

revoke all on public.premium_members, public.appearance_settings from anon, authenticated;
revoke execute on function public.is_premium(uuid), public.profile_appearance(uuid),
  public.appearance_check_premium() from public, anon, authenticated;
