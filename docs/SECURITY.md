# Security notes (Phase 5 review, updated for Phases 6A–6E and 8)

What protects users' data, what was checked, and what is still on the owner's to-do list.

## Who can see what

* Everyone must **sign in** (Supabase Auth, email + password). The backend checks every request's token:
  signing keys from the project's JWKS address (ES256/RS256), or the legacy shared secret (HS256) if set.
  Expired, forged, wrong-project or non-user tokens get a clear **401**.
* **Two locks on every project:**
  1. Every query in `backend/app/storage/repository.py` is written for the signed-in user (`owner_id = …`).
  2. The database itself (Row Level Security, `supabase/migrations/0004…`): user requests run as the
     `croquis_app` role with the user's id set for that transaction, so the database only returns that user's
     rows, even if a query in the code were wrong. Tested with raw SQL in `tests/test_phase5.py`.
* Another user's project, picture, job or version is always **"not found" (404)**, never "forbidden", so ids
  cannot be probed.
* The browser never talks to the tables: migration `0004` removes all access for Supabase's public Data API
  roles (`anon`, `authenticated`). Tested.
* Pictures are in a **private** Storage bucket under `<owner>/<project>/…`. Only the backend reads them (with
  the secret key), after checking the picture belongs to the signed-in user. `<img>` tags use a **media token**
  that is signed, tied to one user and expires after 2 hours.

## Posts and profiles (Phase 6A)

* **Who sees a post** is decided by the database (migration `0006`, function `can_view_post`), not only the code:
  the author always; everyone else only if the post is **published** and its visibility allows it:
  *Public* = any signed-in user, *Followers* = people who follow the author (and the author's close friends),
  *Close Friends* = people on the author's list, *Private* = nobody else. Drafts and archived posts are author-only.
  The same rule guards post pictures, like counts and liking. Tested in the API and with raw SQL as another user.
* A post you may not see is **404**, the same as a post that does not exist.
* **Publishing is an allowlist** (`app/services/publishing.py`): only the chosen sketch / generated pictures, the
  colour palette, fabric names, caption and tags are copied into the post. Measurements, budget, notes, tailor
  notes, the design title and idea, and uploaded reference photos are never copied. A test checks the saved row, the
  post JSON and the copied picture bytes for a client name, measurements and budget.
* Mock SVG sketches print the design title inside the picture. The copy made for a post has its title, description
  and any text other than the MOCK label removed, and files with DOCTYPE/ENTITY are refused.
* Post pictures are **copies** in `posts/<author>/<post>/…`, so deleting or changing the design never exposes or
  breaks a post, and deleting the post deletes its copies. Avatars live in `avatars/<user>/…`. Both are served by
  the backend after the visibility check, with the same 2-hour media token.
* Saves are private: only you can see what you saved. The Close Friends list is only visible to its owner.
* Likes, saves and follows are limited per user (`SOCIAL_RATE_LIMIT_PER_MINUTE`, default 120); avatar uploads and
  creating posts use the upload limit.

## Themes and Premium (Phase 8)

* `appearance_settings` (migration `0011`) holds the app theme, the profile theme and the custom theme. Row Level
  Security lets people read and change **only their own row**, so nobody can see someone else's app theme (tested).
* Visitors of a profile get only what `profile_appearance(uid)` returns: the profile theme, the custom colours **only
  while the profile uses them**, and whether the owner is Premium.
* **Premium** is a row in `premium_members`. The app role may only read its own row; insert, update and delete are not
  granted, so nobody can make themselves Premium through the app (tested with raw SQL). Rows are added with SQL now,
  later by the payment system.
* A trigger refuses a newly chosen Premium theme or custom theme when the person is not Premium, even if the API had a
  bug (tested). The API checks first and answers 403 with "coming soon".
* Custom colours are checked in three places: the API (`#rrggbb`, known textures, fonts and covers), a database check
  constraint, and the browser, which builds the CSS from those checked values only (no free text reaches a style).
* The theme is applied before the first paint by a tiny inline script in `app/layout.tsx` that only copies saved CSS
  variables from this browser's local storage onto `<html>`. If a strict Content-Security-Policy is added later, this
  script needs a nonce or hash.

## Admin, suspensions and verification (Phase 6E)

* **Admins** are rows in `admin_users`, added only with SQL. `admin_users` and `admin_actions` are not granted to the
  app role at all, so no normal request can read them (tested). Every `/api/admin/*` route first runs `is_admin()` in the
  person's own session and answers 404 otherwise; only then does it use the system connection, which is needed to act on
  other people's content. Every admin change writes an `admin_actions` row in the same transaction.
* **Suspensions** are enforced by the database: the insert / update policies on `posts` (publishing), `comments`,
  `reposts` and `messages` check `is_suspended()`; the API checks first to give a clear message. People can read only
  their own suspensions and warnings, and can only set `acknowledged_at` on their own warnings.
* **Verified badge**: `verified_accounts` is written only by the admin pages; `profiles.verified` is recomputed by a
  trigger on every profile write, so nobody can set it on their own profile (tested).
* **Reports of chat messages** can only be made by the other person in the chat (the policy checks the message is
  visible and not your own); the excerpt is copied so admins do not need to open the chat.

## Settings and account (Phase 6D)

Enforced by Row Level Security (migration `0009`) and tested with raw SQL in `tests/test_phase6d.py`:

* **Deactivated / deleting accounts** are hidden by the database: their profile, posts (`can_view_post`), comments
  (`comment_row_visible`) and notifications disappear for others, and they cannot be messaged.
* **Delete account** needs the username (or email) typed exactly. After 30 days `app/services/cleanup.py` deletes every
  Storage file the person owns and then the sign-in account through Supabase's admin API with the secret key; all
  database rows go with it (`on delete cascade`).
* **Change password** checks the current password first; **change email** uses Supabase's confirmation emails.
* **Who can comment** is checked by the comments insert policy (`comment_allowed`); **who can mention me** by the
  mention trigger; **hidden words** by the comments select policy (only the writer and post owner see such comments).
* `account_status`, `privacy_settings`, `search_history`, `time_spent`: only the owner's own row(s).
  `problem_reports`: send and read your own; nobody can change or delete them; screenshots are checked by magic bytes
  and stored under `problem-reports/<user>/` in the private bucket.
* Download my data runs in the user's own database session, so it only contains what Row Level Security lets them see
  (their own rows; messages only from their own chats).

## Chats and notifications (Phase 6C)

Enforced by Row Level Security (migration `0008`) as well as by the backend, and tested with raw SQL as another user in
`tests/test_phase6c.py`:

* **Only the two people in a chat** can read its messages or see that it exists. Sending checks, in the database, that
  you are a member, that neither person blocked the other, and that the other person accepted the chat, follows you,
  or allows messages from you ("Who can message me"). New chats can only be started through `start_conversation()`,
  which applies the same rules; the backend role cannot insert chats or other people's chat rows directly.
* Only the sender can unsend a message; nobody can edit one. You can only change your own side of a chat (accept,
  mark read, delete for yourself).
* **Design pictures** sent in chats are copies under `messages/<chat>/` in the private bucket, served only to the two
  members. Only sketches and generated pictures can be sent (never uploaded reference photos), and mock SVGs have the
  design's name removed, as for posts.
* **Notifications** are written only by database triggers. You only see your own, and only about things you may still
  see (a hidden post, a deleted or waiting comment, or a blocked person drops out).
* **Realtime** carries only `{conversation_id}` and an event name ("message", "seen", "notification") to the private
  channel `user:<id>`; a policy on `realtime.messages` lets each signed-in person listen to their own channel only. The
  app then asks the backend for the data, which checks again. Message text never goes through Realtime.

## Social safety (Phase 6B)

All of these are enforced by Row Level Security (migration `0007`) as well as by the backend, and tested with raw SQL
as another user in `tests/test_phase6b.py`:

* **Block**: if either person blocked the other, neither sees the other's posts, comments, reposts or follower lists,
  neither can follow, comment on or like the other's posts, and the blocker's profile is "not found" for the blocked
  person (also missing from search). Blocking deletes follows and follow requests both ways. The blocked person is
  never told; they cannot read the `blocks` table.
* **Private account**: Public and Followers posts are only for approved followers and Close Friends; reposts and
  follower / following lists likewise. A follow can only be created by the person themselves on a public account, or
  by the account owner accepting a request that exists. Profiles (name, picture, bio) stay visible.
* **Restrict**: the database, not the request, decides whether a new comment needs approval (trigger). Until approved,
  only the writer and the post owner can see it, and only the post owner can approve (column-level grant on
  `approved` only; nobody can rewrite a comment's text).
* **Mute** is a personal filter (feed and Explore); the muted person is not told.
* **Reports** can be created for things you can see, cannot be changed or deleted by users, and are only readable by
  their reporter (the reported person cannot see them). An admin will read them with Supabase's own admin access.
* **Reposts** only point at the original post; a viewer only sees a repost if they may see the original.
* **Share** copies the address `/p/<id>`; opening it still needs sign-in and the same visibility check.
* Comments, likes, reposts, requests, blocks and reports share the per-user social rate limit
  (`SOCIAL_RATE_LIMIT_PER_MINUTE`, default 120). Comments are 1–1000 characters; report details up to 500.
* Direct messages do not exist yet. When they are built they must check `is_blocked_between`.

## Secrets

* All keys (database, Supabase secret key, AI keys, YouTube key, media-token secret) live only in the backend's
  environment (`backend/.env` locally, Render's Environment page in production). `.env` files are git-ignored
  and kept out of the Docker image (`.dockerignore`).
* The website only gets `NEXT_PUBLIC_…` values: the API address, the Supabase URL and the **publishable** key,
  which are public by design. A scan of the production build found no secret values (only setting names in
  help text and the Supabase library's own code).
* Settings hide secrets from their printed form (`repr`), and the AI Providers page only shows whether a key
  is *set*, never the key.

## Input and uploads

* Every request body is validated (Pydantic); ids must be real UUIDs (anything else is 404, never a database
  error); empty names and notes are refused with a plain message.
* Request size: JSON bodies over **5 MB** and uploads over the limit (`MAX_UPLOAD_MB`, default 5 MB) are
  refused **before they are read** (413), so a huge body cannot tie up the server.
* Uploads: the real type is checked from the file's first bytes (PNG, JPEG, WebP only), file names are cleaned,
  and the Storage bucket itself only accepts those image types and at most 10 MB.
* Generated SVGs are served with a sandboxing Content-Security-Policy.

## Rate limits

* Per signed-in user, per minute: generator runs (`GENERATION_RATE_LIMIT_PER_MINUTE`, default 30) and uploads
  (`UPLOAD_RATE_LIMIT_PER_MINUTE`, default 20). One user hitting the limit does not affect others.
* Paid AI also stops for the day at `DAILY_BUDGET_USD` (all users together).
* Limits are kept in memory, so they are per server. That is fine for one Render instance; with several
  instances, move them to a shared store (for example Redis).

## Logging

* Each request is logged as method, path (**no query string**), status, time, the first 8 characters of the
  user id and a request id. Request bodies and the Authorization header are never logged.
* Uvicorn's access log is filtered so `mt=`, `token=`, `key=` and `apikey=` values show as `[hidden]` (tested).
* `httpx` request logging is turned down, and the YouTube key is sent in a header instead of the URL, so it
  cannot appear in any logged URL (this was a real leak risk before Phase 5).
* Unexpected errors are logged with the full trace on the server, but the user only sees a plain message with
  a short reference id (no stack traces, no internal details).

## Browser protection

* Website: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy`, and a
  `Permissions-Policy` that blocks camera, microphone and location. No `dangerouslySetInnerHTML` or `eval`.
* API: CORS only allows the address(es) in `FRONTEND_ORIGIN`; responses carry `nosniff`, `DENY` and
  `no-referrer`.
* Sign-in uses a bearer token, not cookies, so cross-site request forgery does not apply. The Supabase session
  is kept in the browser's local storage (Supabase's default); the protections above limit script injection.

## The owner's to-do list

- [ ] Keep the GitHub repository **private**; never commit `.env` files.
- [ ] If a key is ever exposed, create a new one at the provider, update Render, and delete the old one.
- [ ] For real customers: set up SMTP for sign-up emails (see DEPLOYMENT.md), and consider Supabase Pro for
      daily backups.
- [ ] In Supabase → Authentication, consider a stronger minimum password length and turning on
      leaked-password protection if your plan offers it.
- [ ] Review who has access to the Supabase, Render and Vercel dashboards (they can see all data).
