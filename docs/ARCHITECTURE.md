# Architecture notes

## The big picture

```
Browser (Next.js) ──sign in──▶ Supabase Auth
       │  Bearer token
       └──HTTP/JSON──▶ FastAPI backend ──▶ Generators ──▶ Providers (mock or real)
                            ├──▶ Repository (one user) ──▶ Supabase Postgres (Row Level Security)
                            └──▶ SupabaseStorage ──▶ private bucket "project-assets"
```

- **Frontend** (`frontend/`): only shows things and sends requests. It never holds API keys.
- **Backend** (`backend/`): saves data, runs generators, records every run as a *generation job*.
- **Providers**: the thing that actually does an AI task. Each service has an interface in
  `app/providers/base.py`. Phase 1 implements every interface with a mock.

### Words used in this project

| Word | Meaning |
| --- | --- |
| Design spec | The structured description of one garment (`DesignSpec` in `app/schemas/design_spec.py`). Every generator reads the same spec. |
| Version | A saved copy of the spec. Saving never edits an old version; it adds a new one. |
| Generator | One "Generate …" button. Defined in `app/generators/registry.py`. |
| Provider | Who does the work behind a generator (mock, the Anthropic API, an image API…). |
| Job | One run of a generator: which version it used, which provider, mock or not, output or error. |
| Stale / out of date | A job whose inputs changed. Each generator lists the spec fields it `depends_on`; if any of those changed since the job's version, the output is flagged. Only that output needs regenerating. |
| Mock | A free stand-in that follows simple rules. Always labelled in the UI. |

## Generators

| id | Service | Provider now | Depends on (spec fields) |
| --- | --- | --- | --- |
| design | idea_understanding | Anthropic API or `mock-keywords` | idea |
| sketch | image_generation | Gemini / OpenAI or `mock-svg` | garment, silhouette, neckline, sleeves, length, colours, embellishments, title, visual description |
| visual_preview | image_generation | Gemini / OpenAI or `mock-svg` | as sketch, plus fit, closures, occasion |
| fabric | fabric_recommendation | Anthropic API or `mock-fabric-rules` | garment, occasion, silhouette, climate, embellishments, skill, budget |
| materials | tools_materials | Anthropic API or `mock-materials-rules` | garment, silhouette, neckline, sleeves, closures, embellishments, preferred fabrics, fabric requirements, idea |
| tailor_sheet | export | `built-in` (plain code, no AI) | almost everything, including `tailor` (notes and references) |
| cost | cost_calculation | `built-in` (plain code, no AI) | garment, preferred fabrics, embellishments, closures, budget |
| variations | design_ideas | Anthropic API or `mock-ideas-rules` | garment, occasion, silhouette, neckline, sleeves, embellishments, colours |
| moodboard | design_ideas | Anthropic API or `mock-ideas-rules` | garment, occasion, climate, colours, embellishments, fabrics, visual description |
| embroidery | design_ideas | Anthropic API or `mock-ideas-rules` | garment, occasion, neckline, sleeves, embellishments, colours, fabrics, skill |
| pattern | pattern_assistance | `built-in` (plain code, conceptual) | garment, silhouette, fit, neckline, sleeves, length, closures, measurements, unit, fabrics |
| tutorial | tutorial_search | `youtube-data-api` or `not connected` | garment, neckline, embellishments, closures, fabrics, skill |
| video | video_generation | `built-in` storyboard (no video provider) | garment, title, neckline, sleeves, length, embellishments, fabrics |

**Complete package** (`GenerationService.run_package`) runs the chosen generators in a fixed
order: design first; its result is saved as a new version so the others all use the same spec.
Unavailable generators are reported as *skipped* with the reason. One failure does not stop the rest.

### Adding a new generator

1. If it needs a new kind of provider, add an interface to `app/providers/base.py` and a mock in `app/providers/mock/`.
2. Add an output model to `app/schemas/outputs.py`.
3. Write a `run` function and add a `GeneratorDefinition` to `GENERATORS` in `app/generators/registry.py`.
4. Add a renderer in `frontend/src/components/outputs/` and a case in `renderOutput` (`OutputCard.tsx`).

### Adding a real provider (Phase 2 example: the Anthropic API for "Generate Design")

1. Create `app/providers/anthropic_idea.py` with a class that has `info` and `analyse_idea(...)` returning `DesignConceptOutput`. Use structured output so the result validates against the schema.
2. In `app/providers/registry.py`, return it when `LANGUAGE_PROVIDER=anthropic`; read the key from `ANTHROPIC_API_KEY` in `backend/.env`.
3. Set `info.is_mock = False`. The UI then stops showing the MOCK badge automatically.
4. Record estimated cost in `record_usage`.

## Data

Supabase Postgres, created by `supabase/migrations/0001…0005` (run in order): `projects` (with `owner_id`),
`design_versions`, `notebook_messages`, `generation_jobs`, `assets`, `canvas_documents`, `provider_usage`.
Planned tables (`fabric_references`, `user_measurements`, `tailor_sheets`, `saved_tutorials`) exist but are unused.

Specs and outputs are `jsonb`; picture files are in Supabase Storage at
`<owner_id>/<project_id>/<asset_id>.<ext>` with only their metadata in `assets`.
(Phases 1–4 used a local SQLite file and `backend/data/uploads`; `scripts/import_sqlite.py` copies that data once.)

## Design Studio canvas

The drawing is stored as data, not pixels (`frontend/src/lib/canvas/model.ts`): layers that hold
strokes, shapes and images. Undo/redo keeps earlier copies of that data. Each layer is drawn on its
own scratch canvas so the eraser only erases its own layer. Imported pictures and generated sketches
become image shapes on their own layer; they are pictures to trace over, not editable vector art.

## Next.js notes

This is Next.js 16 with **Cache Components** turned on (the default for new apps). Pages that need
the project id from the URL read it inside `<Suspense>` (`app/projects/[id]/layout.tsx`), and
project pages set `export const instant = false` because their data loads in the browser.
The version-specific Next.js docs are in `frontend/node_modules/next/dist/docs/`.

## Safety and reliability already in place

- Pydantic validation on every request and every generator output.
- Upload checks by magic bytes, 5 MB limit, safe file names.
- In-memory rate limit for generators (`GENERATION_RATE_LIMIT_PER_MINUTE`).
- Generator errors are caught, stored on the job and shown with a Retry button; the server never crashes on a provider error.
- User input is kept when a request fails.
- Confirmation before every delete or clear.
- Generated SVG is shown through `<img src="data:…">`, so it can never run scripts.

## Not yet (and why)

- **Shared rate limits**: limits are in memory per server; several servers would need Redis or similar.
- **Real AI**: code is ready (Phase 2); it needs your API accounts and billing before the first live test.
- **Video generation**: no provider; expensive and fast-changing prices. The video generator makes a storyboard (Phase 4).
- **Live price data**: no reliable source is connected, so prices come only from the user (Phase 3).
- **Async job queue**: mock jobs are fast so they run inside the request. Real image generation may need a background queue.

## Phase 2: real providers

```
generator (registry.py) ──> provider interface (providers/base.py)
                              ├─ mock/            free, labelled MOCK
                              ├─ anthropic_provider.py   Anthropic API: design plan, fabric, materials
                              └─ image_providers.py      Gemini or OpenAI: sketches, previews
```

- `providers/registry.py` picks providers from `.env` (`auto` = real only when a key exists).
- `services/image_prompts.py` turns the design spec into the image prompt (saved with each output).
- `services/generation.py` checks the daily budget before paid calls, records estimated cost,
  and saves generated pictures as `generated` assets linked to the job and design version.
- `storage/database.py` upgrades older databases with `PRAGMA user_version`.

## Phase 3: fashion intelligence

```
DesignSpec.tailor (notes + front/back references) ─┐
saved fabric output (lining) ──────────────────────┤
saved materials output (checklist) ────────────────┼─> services/tailor_sheet.py ─> TailorSheetOutput ─> services/tailor_pdf.py ─> A4 PDF
saved design plan (order of work, same garment) ───┤
services/fabric_handling.py (cut / stitch advice) ─┘

saved materials + fabric ─> services/cost_estimate.starter_inputs ─> lines to price (no prices)
user's prices (generator options) ─> services/cost_estimate.estimate_cost ─> CostEstimateOutput
```

- **Never invented**: prices, fabric lengths, labour charges and cutting dimensions. The tests check
  that the generated cutting / construction / stitching notes contain no "number + unit" text.
- **Fabric factors** (`FabricRecommendation`): comfort, maintenance, weight, `cost_level` (relative
  only), climate / occasion / budget notes, `lining_needed`. New fields have defaults, so Phase 1–2
  outputs still load. The model answers with `FabricAnswer` and its `approximate_cost` is
  always cleared.
- **Checklist tie-in**: every item may carry `linked_to` (which design element needs it) and an
  obvious `quantity_hint`. `based_on` is filled by the registry from the spec, and the job's
  `version_number` is the design version it belongs to. Saving a different fabric marks it stale.
- **Measurement status** on the sheet: `Measured`, `Estimate – verify before cutting`,
  `Missing – measure the wearer`. Required measurements depend on the garment and sleeves.
- **PDF**: `GET /api/projects/{id}/jobs/{job_id}/tailor-sheet.pdf`, built with ReportLab (free,
  local). Reference pictures must belong to the same project; SVGs show a note. Fonts: Arial or
  DejaVu Sans if found, else Helvetica with unsupported characters replaced.
- **Cost estimate**: options are validated with `CostInputs`; empty options produce the starter
  list. Buffer % applies to materials only; labour is a separate subtotal; incomplete lines are
  left out of the total and listed. Regenerating from the UI resends the same typed prices.
- No database change: new spec fields and outputs are stored inside the existing JSON columns.

## Phase 4: learning and advanced generators

```
spec ─> services/tutorials.build_topics ─> TutorialSearchProvider.search (YouTube or not connected)
                                          └─> score_video (reasons from the video's own title/description)
                                          └─> TutorialOutput (steps + real videos + search links)

spec ─> DesignIdeasProvider (Anthropic API or mock) ─> variations / moodboard / embroidery
spec ─> services/pattern.build_pattern (conceptual, built-in)
spec + saved materials/plan/tutorial ─> services/storyboard.build_storyboard (built-in)
```

- **Never fabricated**: `providers/youtube.py` passes on only results whose video id matches the
  11-character YouTube format and whose thumbnail is on `i.ytimg.com`; a result missing from the
  details call (removed or private) is dropped. Watch links are built from the returned id. Without a
  key, `NoTutorialSearch` returns nothing and the guide shows provider search links instead.
- **YouTube cost**: free quota only. `search` = 100 units, `videos` = 1 unit. The provider is
  `paid=False`, so it never touches the daily budget. Friendly messages for quota, bad key, API not
  enabled and network errors.
- **Learning Library**: `GET /api/tutorials/search?q=&language=any|en|hi` (rate limited; 503 when not
  connected).
- **Variations**: each variation fills only the fields it changes. The frontend (`lib/variations.ts`)
  applies it to the current spec and saves a new version, so stale tracking and restore work as usual.
- **Moodboard**: the provider's `image_asset_ids` are always cleared; the registry adds the project's
  own assets (previews, then sketches, then references).
- **Embroidery**: placements come from a fixed list so the UI can shade a front/back diagram.
- **Pattern**: always `conceptual: true` with a disclaimer; drafting steps name measurements and
  relationships only; the cutting layout is drawn NOT TO SCALE by the frontend from piece sizes.
- **Instructional video**: no provider (see "Not yet"). Storyboard scenes come from the design plan's
  order of work when it is for the same garment, otherwise a default order; real tutorial videos are
  attached when a connected tutorial output exists.
- **`provider_usage.paid`** (SQLite "v3" in Phase 4, Supabase `0003`). Spending, paid-call counts and the daily budget use it, so
  free real services (built-in code, YouTube) are no longer counted as paid. Older rows are marked
  paid when they were real and not `built-in`. Supabase: `0003_provider_usage_paid.sql`.
- **Layout**: notebook output views use container queries (`@container`) because the notebook's
  middle column is narrow even on wide screens.

## Phase 5: Supabase, sign-in and deployment

**Request flow**

1. The browser signs in with Supabase Auth (`frontend/src/lib/supabase.ts`, `components/auth/`). Every API call
   sends `Authorization: Bearer <access token>` (`lib/api.ts`).
2. `app/routers/deps.py` → `app/auth.py` checks the token: ES256/RS256 against the project's JWKS
   (`/auth/v1/.well-known/jwks.json`, cached 10 min, refetched on an unknown key id), or HS256 with
   `SUPABASE_JWT_SECRET`. Issuer, audience `authenticated`, expiry and `role` are required.
3. `get_ctx` builds a per-request `Repository(db, user_id)` and `GenerationService` (`Container.repo_for`).
4. `Database.connect(user_id)` runs one transaction: `SET LOCAL ROLE croquis_app` and
   `set_config('request.jwt.claims', …)`. RLS policies use `public.request_user_id()` (migration 0004), so the
   database only shows that user's rows. `connect(None)` (system) keeps the login role and is only used by
   `SystemRepository` (spending totals, usage records) and the import script.
5. Files go through `app/storage/files.py` (Storage REST API with the secret key). `<img>` tags use
   `/api/assets/{id}?mt=<media token>`: `user_id.expiry.HMAC`, 2-hour life, from `GET /api/media-token`.
   PDF and JSON downloads use `fetch` with the bearer token (`api.download…`), not plain links.

**Errors and limits** (`app/main.py`): `RequestGuard` adds a request id and security headers, logs path-only
request lines, and refuses JSON bodies > 5 MB / uploads > `MAX_UPLOAD_MB` with 413 before reading them.
Handlers turn not-found, validation, database and storage problems into plain messages with the request id;
anything unexpected becomes a 500 with a reference id. Uvicorn's access log is filtered to hide `mt=`/key values.

**App start**: `uvicorn app.main:build --factory`. `Settings.check()` lists any missing required setting.

**Tests**: `tests/pg_harness.py` starts a throwaway PostgreSQL (from `backend/.pgtest`, `PG_BIN` or
`TEST_DATABASE_URL`), applies `tests/supabase_shim.sql` (the bits of Supabase our migrations use: `auth.users`,
`auth.uid()`, `anon`/`authenticated` roles, `storage.buckets`) and then the real migrations. `conftest.py` fakes
Supabase's Storage and JWKS over `httpx.MockTransport` and signs test tokens.

**Deployment**: `backend/Dockerfile` (Python 3.13 slim + DejaVu fonts for the PDF, non-root user),
`render.yaml` (Docker web service, health check `/api/health`), Vercel for `frontend/`. See `docs/DEPLOYMENT.md`.
`docker-compose.yml` runs both with Docker on one computer (`frontend/Dockerfile`: Node 22 slim, `next start`).

## Phase 6A: profiles and publishing

**Tables** (`supabase/migrations/0006_profiles_and_posts.sql`, each one has a plain-English comment in the file):
`profiles` gains `username`, `bio`, `role`, `avatar_path`; new `follows`, `close_friends`, `posts`, `post_images`,
`post_likes`, `post_saves`. A post keeps a link to its design (`project_id`, set to null if the design is deleted),
but everything it shows is copied into the post: palette and fabrics as JSON, pictures as Storage copies.

**Visibility** lives in one security-definer function, `can_view_post(post_id)`, used by the RLS policies of
`posts`, `post_images` and `post_likes` (and by the like/save insert checks). Helpers: `is_following`,
`is_close_friend`, `post_counts`. The backend still uses the same `croquis_app` role + per-transaction user id.

**Backend**
- `app/schemas/social.py`: request/response shapes (username is lowercased and a leading `@` removed).
- `app/services/publishing.py`: the publishing allowlist (`publish_options`, `build_content`), suggested caption,
  and `clean_svg_for_post` (removes title text from mock SVGs). The generators are untouched.
- `app/storage/social_repository.py`: all social SQL. One shared post query; keyset pages of 12
  (`cursor` = base64 of `time|id`). Status rules: draft → published → archived → published; archiving unpins; at
  most 3 pins, only on published posts; `published_at` is kept on republish.
- `app/routers/social.py`: `/api/me/profile`, `/api/me/avatar`, `/api/avatars/{user}`, `/api/profiles/…`
  (search, detail, posts, follow), `/api/me/close-friends`, `/api/projects/{id}/publish-options`, `/api/posts…`
  (create, get, edit, delete, like, save), `/api/me/posts?status=`, `/api/post-images/{id}`, `/api/feed`,
  `/api/me/saved`. A published post needs at least one picture; a draft may have none.

**Frontend**: pages `/feed`, `/saved`, `/u/[username]`, `/p/[id]`, `/p/[id]/edit`, `/projects/[id]/publish`,
`/profile/edit`, `/close-friends`; components in `src/components/social/`; helpers in `src/lib/social.ts`.
`MyProfileProvider` (inside `AuthProvider`) loads the signed-in user's profile once for the sidebar
("Set up profile" until a username exists). Like and Save update at once and roll back if the request fails.
After adding routes, run `npx next typegen` so `PageProps<"/u/[username]">` types exist.

## Phase 6B: social features

**Tables** (`supabase/migrations/0007_social_features.sql`, each with a plain-English comment): `profiles.is_private`;
new `blocks`, `restricts`, `mutes`, `follow_requests`, `comments` (one level of replies via `parent_id`, `approved`
flag), `comment_likes`, `reposts` (a pointer to the original post, never a copy), `reports` (for a later admin panel,
with `status` and a short `excerpt`).

**Rules in the database** (security-definer helpers, all yes/no or counts): `has_blocked`, `is_blocked_between`,
`is_private_account`, `can_see_activity(user)` (yourself, or not blocked and public / followed / close friend),
`follow_counts`, `can_view_post` (replaced: adds blocks and private accounts), `is_post_author`,
`comment_is_visible(post, writer, approved)` + `can_view_comment(id)`, `can_repost`, `post_counts` (adds reposts),
`trending_score` (likes + saves in 7 days). A `before insert` trigger on `comments` sets `approved` (false when the
post owner restricted the writer) and checks replies are one level deep on the same post. The comments SELECT policy
uses the row's own columns (`comment_is_visible`) because a lookup by id cannot see a row that is being inserted with
`RETURNING`. `croquis_app` may only update `comments.approved` (column grant), and may not update or delete `reports`.

Follows: insert is allowed when you follow a public account yourself, or when you accept a request sent to you (the
request row must exist at that moment). Delete: unfollow or remove a follower. Profiles are hidden from people the
owner blocked (you still see people *you* blocked, so you can unblock them).

**Backend**
- `app/storage/social_repository.py`: private accounts (`set_privacy`, going public accepts waiting requests),
  follow requests, follower / following pages (50, offset), block / restrict / mute (`set_safety`; block also deletes
  follows and requests both ways and your close-friend entry), reposts and the profile Reposts tab, the feed (adds a
  lateral join for the latest repost by someone you follow, sorted by `GREATEST(published_at, repost time)`, so each
  post appears once), Explore (`EXPLORE_WHERE`: published, Public, public account, not muted), filters from a fixed
  SQL table (`FILTERS`), trending, filter options and search.
- `app/storage/community_repository.py`: comments (list as a tree, add, delete, approve, like) and reports (the same
  open report is returned instead of a duplicate).
- `app/routers/social.py`: `/api/me/privacy`, `/api/profiles/{u}/followers|following|reposts`,
  `/api/me/followers/{u}` (remove), `/api/me/follow-requests…`, `/api/profiles/{u}/block|restrict|mute`,
  `/api/me/blocked|restricted|muted`, `/api/posts/{id}/repost`.
- `app/routers/community.py`: `/api/posts/{id}/comments`, `/api/comments/{id}` (+ `/approve`, `/like`),
  `/api/reports`, `/api/explore` (+ `/trending`, `/filters`), `/api/search`. FastAPI needs a separate `Query(...)`
  object per parameter (sharing one made all four filters read the same value; found by a test).

**Frontend**: pages `/explore`, `/requests`, `/settings/privacy`, `/u/[username]/followers`, `/u/[username]/following`;
components `Comments`, `ReportDialog` (`useReport()`), `MoreMenu` (the ⋯ menu), `PeopleList` (person rows, follower
lists, follow requests), `PrivacySettings`, `Explore`. `PostCard` gains Comment, Repost, Share and Report, and a
"Reposted by" strip. `ProfileView` gains follow states (Follow / Request to follow / Requested / Following), the
safety menu, a Reposts tab, and the private / blocked screens. Unfollow, remove follower, block, unblock, making the
account public and deleting a comment all ask first (`useConfirm`).

## Phase 6C: chats and notifications

**Tables** (`supabase/migrations/0008_chats_and_notifications.sql`, each with a plain-English comment):
`profiles.allow_messages_from` (everyone / followers / nobody); `conversations` (one per pair, `user_low < user_high`);
`conversation_members` (each person's side: `status` accepted / request, `last_read_at`, `cleared_at`); `messages`
(`kind` text / post / design, `post_id`, `image_path`); `notifications` (`type`, `actor_id`, `post_id`, `comment_id`,
`conversation_id`, `read_at`; partial unique indexes so each like / repost / follow / request and each chat appears
once); `notification_settings` (on/off switches, no row = all on).

**Rules in the database**: `is_conversation_member`, `message_is_visible(conv, sent_at)` (row columns, so `RETURNING`
works), `messaging_allowed(sender, recipient)`, `can_send_message(conv)`, `start_conversation(other)` (security
definer: finds or creates the chat; the receiver's side is a request unless they follow the sender). Triggers:
`after_message_insert` (moves the chat up, accepts and reads for the sender, accepts for a receiver who now follows,
notifies, pings both), `after_message_delete`, `after_chat_read` ("seen" ping), and notification triggers on
`post_likes`, `reposts`, `follows` (skipped when it comes from accepting a request), `follow_requests`, `comments`
(comment, reply, `@mentions`) and `posts` (caption mentions when published). Undoing a like / repost / follow / request
deletes its notification. `notify()` checks blocks and `wants_notification()`.

**Realtime**: `broadcast_to_user(uid, event, conv)` calls `realtime.send(payload, event, 'user:<uid>', true)` when that
function exists (Supabase), inside an exception block so it can never stop a write. The payload is only
`{"conversation_id": ...}`. A policy on `realtime.messages` lets `authenticated` read only topic `user:<auth.uid()>`.
The test shim adds a small `realtime` schema whose `send()` records rows, so tests check who was pinged.

**Backend**: `app/schemas/chat.py`; `app/storage/chat_repository.py` (start, inbox / requests, detail with
`cannot_send_reason` and `seen_message_id`, keyset pages of 40, send, unsend, mark read, accept, delete for me, the
messaging setting); `app/storage/notification_repository.py` (pages of 30, mark read, badges, settings);
`app/routers/chats.py`: `/api/chats` (+ `?folder=requests`), `/api/chats/{id}` (+ `/messages`, `/design`, `/read`,
`/accept`, DELETE), `/api/posts/{id}/send`, `/api/messages/{id}` (unsend) and `/image`, `/api/notifications` (+ `/read`,
`/{id}/read`), `/api/me/badges`, `/api/me/messaging`, `/api/me/notification-settings`. `ProfileDetail.can_message`.

**Frontend**: `components/chat/LiveUpdates.tsx` (`LiveProvider` inside `MyProfileProvider`: private channel
`user:<id>`, badges, `useLiveEvents`; polls every 15 s when Realtime is not connected), `Inbox`, `ChatView` (day lines,
Seen / Sent, unsend, request banner, ⋯ menu, composer with Enter to send), `Notifications` (+ settings page),
`SendDialogs` (`Modal`, people picker, `NewChatDialog`, `SendPostDialog`, `SendDesignDialog`); helpers in
`lib/chat.ts`. Pages `/messages`, `/messages/[id]`, `/notifications`, `/settings/notifications`. Menu items Messages
and Notifications with numbers (bell and chat icons with a dot in the phone's top bar); Send on posts; Send in chat on
designs; Message on profiles; "Who can message me" on the privacy page.

## Phase 6D: full settings

**Tables** (`supabase/migrations/0009_settings_and_activity.sql`, plain-English comments in the file): `account_status`
(`deactivated_at`, `delete_requested_at`; no row = active), `privacy_settings` (`allow_comments_from`,
`allow_mentions_from`, `hidden_words`), `search_history`, `time_spent` (seconds per day, `last_ping_at`),
`problem_reports`. `posts` gains status `deleted`, `deleted_at` and `status_before_delete`.

**Rules**: `is_hidden_account`, `audience_allows(owner, who, setting)`, `comment_allowed(post)`,
`has_hidden_word(post, text)`, `comment_row_visible(post, writer, approved, body)` (new comments select policy);
`can_view_post`, `can_view_comment`, `messaging_allowed`, `can_send_message` and `notify_mentions` are replaced with
versions that know about hidden accounts and the new settings. The profiles, comments (select + insert) and
notifications policies are replaced.

**Backend**: `app/schemas/account.py`, `app/storage/account_repository.py`, `app/routers/account.py` (`/api/me/account`,
`/api/me/deactivate|reactivate`, `/api/me/delete` POST / DELETE, `/api/me/export`, `/api/me/privacy-settings`,
`/api/me/search-history`, `/api/me/time`, `/api/me/comments`, `/api/problem-reports`), plus `/api/me/liked`,
`/api/posts/{id}/restore` and `DELETE /api/posts/{id}?permanent=true` in `routers/social.py`. A plain DELETE now moves a
post to Recently deleted. `app/services/cleanup.py` (`purge_due`) runs from the app's lifespan in a daemon thread every
`PURGE_INTERVAL_HOURS` (0 turns it off; the tests use 0 and call it directly).

**Frontend**: `components/settings/` (`SettingsHome` with search over `SECTIONS`, `AccountSettings`, `PrivacyExtras`,
`ActivityView`, `LanguageSettings`, `HelpView`, `LegalPage`), `components/i18n/LanguageProvider.tsx` + `lib/i18n.ts`
(dictionaries; missing keys fall back to English; choice in localStorage `croquis-language`),
`components/layout/AccountBanner.tsx` (deactivated / deletion banner, `useTimeTracker`), `lib/activity.ts`. Pages
`/settings`, `/settings/account`, `/settings/activity`, `/settings/language`, `/settings/ai-providers`, `/help`,
`/legal/terms|privacy|guidelines` (public). Signing in calls `/api/me/reactivate`. Explore saves a search 1.5 s after
typing stops and opens `?q=` from Search history.

## Phase 6E: onboarding, admin panel, verified badge

**Tables** (`supabase/migrations/0010_onboarding_admin_verification.sql`): `admin_users`, `admin_actions` (log),
`account_suspensions` (`ends_at` null = permanent, `lifted_at`), `user_warnings` (`acknowledged_at`),
`verified_accounts` (`source` admin / premium), `verification_requests` (one pending per person),
`onboarding_progress` (`step`, `interests` JSON, `completed_at`, `skipped_at`). `profiles.verified` is kept in sync by
triggers. `reports` gains `message` targets (`message_id`) and `resolved_at` / `resolved_by` / `resolution_note`.
Functions `is_admin()`, `is_suspended(uid)`; policies on posts / comments / reposts / messages / reports replaced.

Make an admin:

```sql
insert into public.admin_users (user_id, note)
select id, 'owner' from auth.users where email = 'you@example.com';
```

**Backend**: `app/schemas/admin.py`; `app/storage/member_repository.py` (own onboarding, suggestions, verification,
warnings, active suspension, `suspension_message`); `app/storage/admin_repository.py` (system connection, logs every
change; removing content closes other open reports about it *before* deleting, because the report links are
`on delete set null`); `app/routers/members.py` (`/api/me/onboarding` + `/skip`, `/api/onboarding/suggestions`,
`/api/me/verification`, `/api/me/warnings/{id}/ack`, and `check_not_suspended` used by the publish, comment, repost and
chat routes); `app/routers/admin.py` (`/api/admin/stats`, `/reports` + `/dismiss|resolve|remove`, `/users/{id}/warn|suspend`,
`/suspensions` + `/lift`, `/problem-reports` (+ status, screenshot), `/verification-requests` + `/approve|reject`,
`/verified/{user}`, `/actions`). `/api/me/account` adds `is_admin`, `suspension`, `warnings`. Every person JSON has
`verified`.

**Frontend**: `components/onboarding/Welcome.tsx` (`/welcome`), `lib/onboarding.ts`, `components/admin/AdminPanel.tsx`
(`/admin`), `components/settings/VerificationSettings.tsx` (`/settings/verification`), `components/social/VerifiedBadge.tsx`.
`layout/AccountBanner.tsx` now holds `AccountStatusProvider` (used for the Admin menu item) and the suspension, warning,
deactivation and onboarding strips; brand-new people are sent to `/welcome` once per browser session.

## Phase 8: Drapeit redesign and themes

**Design tokens** live in `frontend/src/app/globals.css` (`@theme static`): colours (`paper`, `surface`, `sunken`,
`ink`, `muted`, `faint`, `line`, `line-strong`, `wine`, `wine-dark`, `wine-soft`, `on-wine`, `gold`, `gold-soft`,
`gold-ink`, status colours, `canvas` for pictures, `overlay`), fonts (`--font-sans` Inter, `--font-display` Fraunces;
Cormorant and Playfair for some themes), radii, shadows (`shadow-card` for cards) and motion (`animate-rise`,
`animate-fade`; everything is switched off by `prefers-reduced-motion`). Components use only these tokens
(`bg-paper`, `text-wine`, `text-on-wine`, ...), never fixed colours; the exceptions are real design colours (fabric
swatches, sketch canvas, drawing palette). Helpers: `eyebrow` (small gold uppercase label), `.stitch-divider` (gold
running stitch with a diamond), `.cover-banner`, `.theme-scope`.

**Themes** (`frontend/src/lib/themes.ts`): every theme is a full palette + a CSS-only texture + a heading font + a
cover pattern. `themeVars()` turns a theme into CSS variables; setting them on `<html>` changes the whole app, setting
them on one element (`themeStyle()`) changes only that part (the profile page, the preview cards). `globals.css` holds
Light (Ivory) as the default and Dark (Midnight) under `prefers-color-scheme: dark` for "System"; a test keeps them
equal to `THEMES.light` / `THEMES.dark`. `buildCustomTheme()` turns three colours into a palette and nudges any colour
that fails WCAG AA (`lib/color.ts`); `lib/themes.test.ts` checks every text pair (`TEXT_PAIRS`) in every theme.

**Applying the app theme**: `components/theme/ThemeProvider.tsx` applies the choice to `<html>` and stores the choice
plus the ready variables in localStorage (`drapeit-theme`); `THEME_BOOT_SCRIPT` (inline in `<head>`) copies them onto
`<html>` before the first paint, so there is no flash. After sign-in `ThemeSync` loads `/api/me/appearance`; the
account's choice wins. A Premium theme without Premium falls back to "System".

**Database** (`supabase/migrations/0011_themes_and_premium.sql`): `appearance_settings` (`app_theme`, `profile_theme`,
`custom_theme` JSON; own row only), `premium_members` (read own row only; written with SQL / later payments),
`is_premium(uid)`, `profile_appearance(uid)` (what visitors may see) and the trigger `appearance_check_premium`
(refuses newly chosen Premium themes without Premium). No existing table changed.

**Backend**: `app/schemas/appearance.py`; `app/storage/appearance_repository.py` (UPDATE first, then INSERT: an
`INSERT ... ON CONFLICT` fires the insert trigger, which would treat a kept Premium theme as newly chosen);
`app/routers/members.py` (`GET` / `PUT /api/me/appearance`, 403 for Premium choices without Premium). `ProfileDetail`
gains `appearance` (profile theme, custom theme when used, `is_premium`). The data export includes `appearance`.

**Frontend**: `/settings/theme` (`components/settings/ThemeSettings.tsx`, previews in `components/theme/ThemePreview.tsx`),
`components/ui/Logo.tsx` (text logo, "by Vistas Atelier", tagline), the profile page wraps itself in the owner's
profile theme with a cover banner and a Premium tag. The tailor sheet always shows in the Light theme (it is a paper
document).

