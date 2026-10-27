# Development log

## 2026-10-21 – Phase 1 foundation

**Environment found:** empty folder (new project). Node 22.22, npm 10.9, Python 3.13, git 2.43. No blockers.

**Decisions**
- Next.js 16.4 (App Router, TypeScript, Tailwind CSS 4) created with `create-next-app`, keeping its defaults (Cache Components on).
- FastAPI 0.159 + Pydantic 2 backend. SQLite for local saving so nothing extra needs installing; Supabase schema written but not connected.
- Every AI service behind an interface, with mock providers clearly labelled in the API (`is_mock`) and UI (MOCK badge).
- The tailor sheet is plain code (no AI) and never invents measurements; missing ones are listed.
- Fabric "approximate cost" is always empty until a real price source exists.
- Plain HTML canvas instead of a drawing library, to keep dependencies small and the code readable.

**Built**
- Backend: projects, versions (never overwritten, restore = new version), notes, canvas, uploads, generation jobs, retry, apply concept, complete package, stale detection per generator, provider usage records, rate limit, export JSON.
- Frontend: dashboard, notebook (ideas, references, outputs, generators, spec editor, history), design studio, fabric studio, tailor workspace, my designs, learning library placeholder, provider status page, backend-offline banner.

**Checks actually run**
- `pytest`: 17 passed.
- `vitest`: 5 passed (canvas model).
- `eslint`, `tsc --noEmit`, `next build`: all clean.
- Scripted browser walkthrough (Playwright, Chromium) of the full flow: create project → generate design → apply → package → edit spec (stale badge) → studio drawing + place sketch + save → save fabric → measurements + tailor sheet → duplicate → settings/resources → mobile width. No app errors in the console.

**Fixed during checks**
- Next 16 needs `usePathname()` inside `<Suspense>` for prerendering (sidebar nav).
- Dev "instant navigation" warnings on project pages → `export const instant = false`.
- Idea panel overflowed into the panel below; concept fields were cramped in the narrow column.
- Saving a suggested fabric made the suggestions look out of date; fabric generator no longer depends on `preferred_fabrics`.

**Known warnings**
- `npm audit` reports advisories in ESLint's dependency tree (dev-only tooling, not shipped to the browser). The suggested "fix" downgrades eslint-config-next to v14, so it was not applied.
- Starlette prints a deprecation warning about `httpx` in the test client; tests are unaffected.


## 2026-10-21 · Phase 2 – real AI generators

**Decisions**
- Brand in the UI is now "Drapeit by Vistas Atelier".
- Providers are picked by `LANGUAGE_PROVIDER` / `IMAGE_PROVIDER` (default `auto`): a real provider is used only when its key is in `backend/.env`, otherwise the labelled mock. A wrong provider name stops the backend at startup with a clear message.
- The Anthropic model (set with `ANTHROPIC_MODEL`, effort `medium`) answers in an exact JSON shape (structured outputs via `client.beta.messages.parse`), with the server-side refusal fallback turned on for models that support it. Answers are trimmed to the spec's size limits, so a long answer can never break saving. The user's measurements, references and budget are kept.
- The model is told never to invent measurements, prices or fabric quantities; fabric `approximate_cost` is forced to empty after the call.
- New spec field `visual_description` (written by Generate Design, editable) keeps every sketch and preview of a version describing the same garment. The exact image prompt is saved with each output.
- Images: Gemini (`gemini-nano-banana-2.1`, ~$0.035/image) or OpenAI (`gpt-image-2`, quality `medium`, ~$0.08/portrait image). Both return PNG/JPEG, checked by magic bytes, saved under `data/uploads/<project>/` as `generated` assets with job id, generator, provider and design version.
- Tailor sheet never calls paid AI: it reuses the saved materials checklist, or the free built-in rules.
- Spending: every call records an estimated cost in `provider_usage`. Before a paid call, today's spend + the call's estimate must stay under `DAILY_BUDGET_USD` (default $1, resets at local midnight).
- SQLite schema version 2 (`PRAGMA user_version`): existing Phase 1 databases are upgraded automatically, keeping all assets. Supabase migration `0002_generated_assets.sql` mirrors it.
- Generated SVGs are served with a sandboxing Content-Security-Policy.

**Checks actually run**
- `pytest`: 38 passed (21 new). Real providers are tested with fake API clients, so no money is spent and no internet is used. **No call to the real Anthropic, Gemini or OpenAI APIs has been made yet**, because there are no keys.
- `eslint`, `tsc --noEmit`, `vitest` (5), `next build`: clean.
- Playwright walkthrough in mock mode: create → Generate Design (plan shows) → apply → watercolour sketch → visual preview → image library → history → place preview in Studio → settings page. No console errors.


## 2026-10-22 · Phase 3 – fashion intelligence

**Decisions**
- No new paid API. The cost estimate and the PDF are ordinary code. The only new dependency is
  ReportLab 4.5.1 (free, open source, runs locally) with Pillow 13.0.0 for pictures.
- Prices are never filled in by the app: `approximate_cost` stays empty (also forced empty after
  the model answers). Fabric cards show a *relative* `cost_level` that only compares the listed fabrics.
- The cost estimate uses only the user's quantities and prices. With no lines it lists what needs a
  price (from the saved fabrics and checklist). Labour is a separate subtotal; the buffer % applies
  to materials only; incomplete lines are excluded from the total and listed; all assumptions,
  region and price date are written into the output. Regenerating resends the same typed prices.
- New spec field `tailor` (construction / cutting / stitching notes and front / back / side /
  detail references). Older specs load with empty notes. `tailor_sheet` depends on it.
- Checklist items gained `linked_to` and `quantity_hint` (obvious counts only); `based_on` is
  filled from the spec by the registry. `materials` now also depends on neckline, sleeves,
  preferred fabrics and fabric requirements.
- Tailor sheet: Missing measurements appear as table rows; required measurements follow the
  sleeves (sleeveless drops sleeve length, full sleeves add wrist). Construction notes use the
  design plan's order of work when it is for the same garment. Fabric-specific cutting and
  stitching advice lives in `services/fabric_handling.py` (shared with the mock checklist).
- PDF: A4 with header / footer, warnings box, reference pictures, Design and Fabric side by side,
  colour-coded measurement table, numbered construction steps, tick-box checklist and sign-off.
  Pictures from another project are never included. Dates are printed in local time.
- No database migration: everything new lives in existing JSON columns.

**Checks actually run**
- `pytest`: 58 passed (20 new in `tests/test_phase3.py`). No real Anthropic, Gemini or OpenAI call was
  made (fake API clients only).
- `npm run typecheck`, `npm run lint`: clean. `npm test` (vitest): 8 passed (3 new cost helper tests).
- `npm run build`: succeeded; new route `/projects/[id]/cost`.
- Live run against the local servers through the API (mock mode): create project → design →
  apply → fabric → materials → sketch → tailor sheet → cost (starter lines) → PDF download
  (`application/pdf`, 3 pages). PDF pages were rendered to images and checked by eye; layout fixes
  made after that check: frame padding alignment, headings kept with their content, local date.
- Browser check (Chrome, mock mode): Fabric Studio, Tailor Workspace and Cost Estimate open and
  render; in Cost Estimate, 4 m × ₹450 + ₹1,500 stitching gave ₹1,800 materials, ₹1,500 labour,
  ₹3,300 "total so far", with the unpriced lines listed. Not clicked through: saving tailor
  details with references in the browser, and the PDF button in the browser (the same PDF URL
  was downloaded and checked through the API).

**Fixed during the browser check**
- The sidebar said "Real AI on" without any key, because the new free "Cost calculation and PDF
  export" row counted as live. It now counts only paid providers; the AI Providers table shows
  that row as "Built-in · free".
- "Sort by" label wrapped onto two lines in Fabric Studio.

**Fixed during checks**
- A test expected a low budget note to change the top-3 fabrics for a wedding; the scoring lowers
  costly fabrics (silk 75 → 59) but festive fabrics still lead, which is intended. Test corrected.


## 2026-10-22 · Phase 4 – learning and advanced generators

**Decisions**
- Tutorial search uses the YouTube Data API v3 (`TUTORIAL_PROVIDER=auto|youtube|mock`,
  `YOUTUBE_API_KEY`). It is free within a daily quota (search = 100 units, details = 1 unit), so it is
  `paid=False` and never touches the daily budget. Calls go through `httpx` (now a main dependency).
- Nothing about a video is invented: only results with a valid 11-character id and an `i.ytimg.com`
  thumbnail are kept, results missing from the details call are dropped, links are built from the
  returned id, and HTML entities in titles are decoded. Relevance reasons are computed from each
  video's own title and description (topic words, other design words, "beginner", very short clips).
- Without a key the tutorial generator still returns the learning steps with YouTube search-page links,
  zero videos and a clear "not connected" note (badged MOCK).
- Variations, moodboard and embroidery share a new `DesignIdeasProvider` (the Anthropic API when
  `ANTHROPIC_API_KEY` is set, else `mock-ideas-rules`). The model's moodboard image ids are cleared;
  the app adds the project's own pictures.
- Pattern assistance and the instructional-video storyboard are built-in code. Pattern output is
  always `conceptual` with a disclaimer and a NOT TO SCALE layout; drafting steps use only
  measurement names and relationships.
- No video generation provider was added: costs are high and change often. The video generator
  makes a storyboard and script and attaches real tutorial videos when available.
- Bug found and fixed: spending and "paid calls" counted every non-mock usage row, so built-in
  generators (tailor sheet since Phase 1, cost since Phase 3) and now YouTube were counted as paid.
  Database v3 adds `provider_usage.paid`; older real, non-built-in rows are marked paid.
- Old tests that assumed "tutorial is unavailable" now use a pretend "future" generator, so the
  "planned for a later phase" path is still tested.

**Checks actually run**
- `pytest`: 83 passed (25 new in `tests/test_phase4.py`). YouTube is tested with a fake HTTP server
  (`httpx.MockTransport`) and the Anthropic API with a fake client. **No real YouTube or Anthropic call was made**
  (no keys).
- `npm run typecheck`, `npm run lint`: clean. `npm test`: 10 passed (2 new for variations).
- `npm run build`: succeeded.
- Live run against the local servers (mock mode): all six new generators succeeded on the demo
  project; the existing local database upgraded to version 3; paid calls today = 0; Learning Library
  search returned 503 with setup steps.
- Browser check (Chrome): Design variations, Moodboard, Embroidery (placement diagram), Pattern
  (disclaimer, measurements, cutting layout) and Tutorials (not-connected notice) render in the
  notebook; Learning Library shows the setup steps and a YouTube search link. Not clicked through in
  the browser: "Try this" on a variation (covered by an API test and a unit test) and the
  Instructional Video card.

**Fixed during checks**
- New views were laid out for the full screen width and looked cramped in the notebook column;
  switched to container queries.
- A tutorial topic said "Cutting and stitching a anarkali"; now "the anarkali".
- An SQL comment inside `CREATE TABLE provider_usage` broke SQLite's `DROP COLUMN` rewrite in a test;
  moved the comment outside the table definition.


## 2026-10-22 · Phase 5 – quality and deployment

**Decisions (agreed with the owner first)**
- **Supabase only**, also on your own computer: Postgres, Auth (email + password) and Storage. Local SQLite is gone
  from the app; `scripts/import_sqlite.py` copies the old Phase 1–4 data into one Supabase account, once.
- Hosting plan: **Render** for the backend (Docker, `render.yaml`), **Vercel** for the website. Costs are in
  docs/DEPLOYMENT.md. Nothing was pushed or deployed: there is no GitHub repository or account yet.
- Per-user access twice: user-scoped queries in the repository, plus Row Level Security. User requests run as a
  new `croquis_app` role with the user id set per transaction (`public.request_user_id()`); Supabase's public
  Data API roles lose all access to app tables (migration 0004). Private Storage bucket (migration 0005).
- Tokens: ES256/RS256 via the project's JWKS, or HS256 with `SUPABASE_JWT_SECRET` for older projects.
  Pictures use a 2-hour HMAC "media token" because `<img>` cannot send headers; downloads use `fetch`.
- Tests run on a **real PostgreSQL 16**: the Windows build from the `pgserver` wheel (approved by the owner) is only
  unpacked into `backend/.pgtest` by `scripts/get_test_postgres.py` (pgserver has no Python 3.13 build, so it is not
  installed). A small shim adds the Supabase pieces the migrations use. Supabase Storage and JWKS are faked over
  `httpx.MockTransport`.
- `uvicorn app.main:build --factory`: a missing setting stops the server with a readable list.
- Removed the `pgcrypto` line from migration 0001 (`gen_random_uuid()` is built into PostgreSQL 13+).

**Security review findings and fixes**
- Real leak risk fixed: the YouTube key was in the request URL and `httpx` logs URLs at INFO. The key now goes in
  the `X-Goog-Api-Key` header and `httpx` logging is turned down.
- Uvicorn access logs now hide `mt=`/`token=`/`key=` values (seen working in a real server log: `mt=[hidden]`).
- Request bodies over the limit are refused before reading (413); uploads and generations are rate-limited per user.
- Ids are validated as UUIDs (no database errors from bad ids); empty names/notes give plain messages.
- Production build scanned: no secret values (only setting names in help text and the Supabase library's code).

**UI bugs found and fixed (headless Chrome at 390 px and 1280 px)**
- Phones/tablets: the Generate / Design spec / History panel came after all 13 output sections (~21,000 px down);
  it now comes right after the idea panel.
- AI Providers table cut off its status badges and hid notes on phones; now a stacked layout.
- Cost estimate materials table was cramped on phones; now a stacked list in narrow places.
- Tailor sheet measurement headers ran together ("ValueStatus").
- The Chrome extension's window reported zero size and froze screenshots, so checks used headless Chrome driven
  over the DevTools Protocol instead (no extra download).

**Checks actually run**
- `pytest`: **110 passed** (81 earlier tests now on PostgreSQL + 29 new in `tests/test_phase5.py`: sign-in, two-user
  isolation in the API and with raw SQL under RLS, Data API roles, media tokens, rate limits, size limits, headers
  and CORS, log redaction, clear errors, SQLite import, and one end-to-end run through every workflow).
- Real `uvicorn app.main:build --factory` against a local PostgreSQL: health, readiness, 401 without sign-in,
  create/list with a token, media token. Without settings it stopped with the readable list.
- `npm run typecheck`, `npm run lint`: clean. `npm test`: 13 passed. `npm run build`: succeeded.
- Headless Chrome: every page at phone width with no sideways overflow (before the switch to Supabase); the
  sign-in screen at phone width: sign-in attempt shows "Cannot reach the sign-in service…" against an
  unreachable address; "Create an account" switches correctly.
- **Not run**: anything against a real Supabase project, Render or Vercel (no accounts yet); `docker build`
  (Docker is not installed here); signing in through the real UI end to end.


## 2026-10-22 · Forgot password flow

- Sign-in screen: "Forgot password?" link under the password field (the old in-card "forgot" mode was removed).
- `/forgot-password`: calls `resetPasswordForEmail` with `redirectTo = <site>/reset-password` and always shows
  "If this email has an account, we sent a reset link" (only network / rate-limit problems are shown as errors,
  because they reveal nothing about who has an account).
- `/reset-password`: waits for Supabase to read the emailed link (up to 5 s), explains expired or used links
  (including `#error_code=otp_expired`), asks for the new password twice (min 8 characters, must match), calls
  `updateUser`, signs the short recovery session out, and sends the user to sign-in with
  "Your password was changed".
- Both pages are public (no sign-in, no sidebar): `AuthProvider` now keeps a `PUBLIC_PATHS` list, renders the
  app shell itself, and moves a reset link that landed on another page to `/reset-password`.
- Bug found while checking: the sign-in screen tidied the address bar during rendering, which Next.js reports as
  "Cannot update a component while rendering"; moved into an effect.
- Checks run: `npm run typecheck`, `npm run lint` clean; `npm test` 15 passed (new: password rules, reset
  address, new error messages); `npm run build` succeeded (new static routes `/forgot-password`, `/reset-password`).
  Headless Chrome at 390 px: link opens the page, reset page explains a missing/expired link, success notice shows
  and is removed from the address, no sideways scroll, no new errors in the dev log.
- Not done: sending a real reset email (it would go through the owner's live Supabase project).

## 2026-10-22 · Phase 6A – profiles and publishing

**Decisions**
- Added **follow / unfollow**: the "Followers" visibility needs it. Anyone can follow anyone for now.
- "Public" = every signed-in user (the whole app needs sign-in). Close friends also see Followers posts.
- A post **copies** what it shows (pictures into `posts/<author>/<post>/`, palette and fabrics as JSON), so editing
  or deleting the design never changes or breaks a published post.
- Publishing is an **allowlist**: chosen sketch / generated pictures, palette, fabric names, caption, tags. Never
  measurements, budget, notes, tailor notes, title, idea or uploaded reference photos (those may show a client).
  The suggested caption is built only from colours, garment, occasion, neckline, sleeves and embellishments.
- A published post needs at least one picture; drafts may have none. Up to 3 pinned posts.
- Visibility is enforced in the database (`can_view_post` + RLS), not only in the code.
- The generators were not touched.

**Bugs found while checking**
- Privacy: mock SVG sketches write the design title (which can be a client's name) inside the picture. Post copies
  are now cleaned (`clean_svg_for_post`), with a test.
- A pin test had an assertion that could never fail (`… or True`); fixed to check the author's and a follower's views.
- Test harness only: the fake Storage server listened on IPv4 only, so "localhost" waited ~2 s for IPv6 on Windows and
  screenshots showed blank pictures. Fixed in the harness; not an app bug.

**Checks actually run**
- `pytest`: **128 passed** (110 earlier + 18 new in `tests/test_phase6a.py`: profiles and unique usernames, avatar,
  publish options, the privacy check on row / JSON / picture bytes, the visibility matrix through the API and with raw
  SQL under RLS, drafts and archived posts, post pictures, feed pages and bad cursors, likes / saves / Saved, the full
  post lifecycle, pins, a post outliving its design, follow / search / close friends, 401 without sign-in).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: 17 passed. `npm run build`: succeeded with the new routes.
- Headless Chrome on a local stack (real backend + local PostgreSQL + fake Storage) at 390 px and 1280 px: feed,
  profile with Posts / Drafts / Archived tabs, post page owner tools, publish page, edit profile, close friends, a
  follower's feed (sees the Followers post), like 0 → 1, Save → Saved page, follower's view of the profile (no owner
  tabs). No sideways scroll, no broken pictures; the published picture has no client name.
- **Not run**: migration 0006 on the real Supabase project; the real UI against real Supabase.

## 2026-10-22 · Phase 6B – social features

**Decisions**
- A **private account** hides Public and Followers posts, reposts and follower lists from non-followers; the name,
  picture and bio stay visible (like Instagram). Close Friends still see Followers posts. Existing followers stay when
  you go private; going public again accepts every waiting request.
- **Block** works both ways and is enforced in the database. You can still see the profile of someone *you* blocked,
  so you can unblock them. Blocking removes follows and requests both ways; unblocking does not bring them back.
- **Restrict**: a database trigger marks the restricted person's new comments "waiting"; the post owner approves.
  Unrestricting does not approve old waiting comments (approve or delete them).
- **Mute** hides posts in the Home Feed **and** Explore (Explore is a feed too); profiles and post pages still open.
- **Reposts** point at the original post (never a copy) and only work for Public posts from public accounts. In the
  feed a reposted post appears once, moved up to the repost time, with "Reposted by".
- **Comments**: one level of replies, no editing, the first 500 per post.
- **Reports** are stored with a short excerpt so they still make sense if the post is deleted; reporting the same
  thing twice returns the first report.
- **Explore** shows Public posts from public accounts (including your own); filters match tags, palette and fabric
  names; Trending = likes + saves in the last 7 days (top 24).
- Direct messages do not exist yet, so "can't message me" is noted for when they are built.

**Bugs found while checking**
- Comments could not be saved: the SELECT policy looked the comment up by id, which cannot see a row being inserted
  with `RETURNING`. Fixed with `comment_is_visible(post, writer, approved)` on the row's own columns.
- Accepting a follow request failed: `SELECT … FOR UPDATE` needs UPDATE rights on `follow_requests`; removed it.
- Explore filters: one shared FastAPI `Query()` object made all four filters read the `garment` value. Each parameter
  now gets its own.
- Phone layout: the post buttons (like, comment, repost, save, share) did not fit at 390 px and "Share" was cut off;
  the row now wraps.
- A test I wrote had an assertion ending in `or True` (could never fail); removed before running.

**Checks actually run**
- `pytest`: **145 passed** (128 earlier + 17 new in `tests/test_phase6b.py`: follower lists and remove follower,
  private account + requests (accept, decline, cancel, going public), the same rules with raw SQL, comments and replies
  and likes and deleting, comments on drafts / private posts, restrict + approve, comment rules with raw SQL, reposts
  and the feed label, repost rules with raw SQL, block both ways (API and raw SQL), mute, reports (and that the
  reported person cannot read them), Explore filters / trending / search, colour filter, new tables closed to the
  browser roles, sign-in required).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: 19 passed. `npm run build`: succeeded with the 5 new routes.
- Headless Chrome on a local test stack (real backend + local PostgreSQL + fake Storage, never the real Supabase) at
  390 px and 1280 px (feed also at 360 px): post with comments, replies and a waiting comment, own profile with
  "Follow requests (1)", requests page (Accept → empty state), privacy page, followers list, Explore, a restricted
  profile, the private profile and private followers list as a non-follower, the feed "Reposted by" strip, the
  Reposts tab with the designer's credit, Approve, Reply, the ⋯ menu, the Block confirmation and a report sent.
  No sideways scroll, no broken pictures.
- **Not run**: migration 0007 on the real Supabase project; the real UI against real Supabase.

## 2026-10-23 · Phase 6C – chats and notifications

**Decisions**
- **One chat per pair.** The receiver's side starts as a **request** unless they follow the sender; replying or
  pressing Accept moves it to Chats. Opening a request does not mark it read, so the sender does not see "Seen" yet.
- **Who can message me**: everyone (default) / followers / nobody. People you follow can always message you, and a chat
  you accepted keeps working whatever you choose. A request you never accepted stops when you choose "nobody".
- **Blocks**: no sending either way. If someone blocked you, the chat disappears for you (like their profile). If you
  blocked them, you keep the history with "Unblock them to send messages".
- **Unsend** removes the message for both. **Delete chat** hides it and older messages for you only; a new message
  brings it back.
- **Sharing**: posts are shared as a pointer (the receiver only sees it if allowed, otherwise "not available"). Design
  pictures are copied (sketch / generated only, the name removed from mock SVGs), like publishing.
- **Notifications are written by the database** (triggers), so every path (API, accepting requests, going public) is
  covered; undo removes them; visibility is checked when reading (Row Level Security), so a post that later becomes
  hidden, or a blocked person, drops out. Message notifications: one per chat, moved up on each new message; the menu
  counts chats separately, so the bell number leaves messages out.
- **Realtime** sends only "something changed in chat X" to a private per-user channel, from the database
  (`realtime.send`). The browser then asks the backend. Without Realtime the app polls (15 s for the menu numbers,
  8 s in an open chat, 15-20 s on the inbox and notifications).

**Bugs found while checking**
- Chat screen: pictures finished loading after the jump to the newest message, so it stopped halfway. A
  `ResizeObserver` keeps it at the bottom while you have not scrolled up.
- Shared post card: the 2-line caption clamp sat on the padded element and a third line peeked out; the clamp is now on
  an inner element.
- My first test expected 400 when sending to someone who blocked you; the API answers 404 (the chat is hidden from you,
  like their profile). Kept 404 and fixed the test.

**Checks actually run**
- `pytest`: **160 passed** (145 earlier + 15 new in `tests/test_phase6c.py`: inbox, unread, read and Seen; pages of
  messages; requests (accept, reply accepts, delete for me, comes back); who-can-message-me (everyone / followers /
  nobody, people you follow, accepted chats keep working); blocks both ways and reporting; sharing posts (to several
  people, hidden and deleted posts); design pictures (copy, name removed, members only, unsend deletes the file); chat
  rules with raw SQL as other users; new tables and `start_conversation` closed to the browser roles; every
  notification type with undo, de-duplication and mark read; follow requests and caption mentions (hidden from someone
  who may not see the post, while the row exists); notification settings; blocked actors and drafts; Realtime pings
  carry no message text; sign-in required).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: 24 passed (5 new in `lib/chat.test.ts`). `npm run build`:
  succeeded with the 4 new routes.
- Headless Chrome on a local test stack (real backend + local PostgreSQL with all migrations + fake Storage, never the
  real Supabase) at 1280 px and 390 px: inbox with unread numbers, Requests tab, chat with a shared post, a design
  picture and "Seen", request banner, notifications with Follow back, notification settings, "Who can message me",
  Message on a profile, Send post and Send design dialogs, empty states, and a message typed in the browser plus one
  sent from the other side appearing without a reload (by polling, because Realtime does not exist locally). No console
  errors.
- **Not run**: migration 0008 on the real Supabase project; the Realtime websocket against real Supabase.

## 2026-10-23 · Phase 6D – full settings

**Decisions**
- Account state lives in its own table (`account_status`), not in `profiles`, because people without a profile can
  also deactivate or delete.
- **Deactivate** hides the account at once and signs out; signing in with the password reactivates it. A banner with
  "Reactivate" also appears if a session was still open elsewhere.
- **Delete** asks for the username (email without a profile), hides the account at once, and is final after 30 days:
  files first, then the sign-in account via the Supabase admin API (rows cascade). "Cancel deletion" in the banner or on
  the Account page.
- **Recently deleted** is for posts: status `deleted`, so every existing query (which filters by status) leaves them out;
  restore puts back the old status. Designs keep their permanent delete (with a confirmation).
- **Hidden words** hide matching comments from everyone except the writer and the post owner (both see a "Hidden from
  others" label). **Who can mention me** only affects notifications (the text still shows "@name").
- **Language**: a small dictionary (no library). Menu, Settings, Help and common buttons are translated; other pages
  stay English for now. Remembered in localStorage, so it also works on the sign-in screen's device.
- The old `/settings` (AI providers) moved to `/settings/ai-providers`; "Privacy & safety" and "AI Providers" in the
  menu became one "Settings" item.
- **Support email** is not hard-coded: set `NEXT_PUBLIC_SUPPORT_EMAIL`.

**Bugs found while checking**
- The new-password label wrapped to two lines and pushed its box down; shortened it (the rule is now the placeholder).
- The "Who can mention me" help text showed `@{your username}` literally; reworded.
- Two of my own tests were wrong, not the code: the mention test forgot that following someone also sends a "follow"
  notification, and an early draft had leftover placeholder lines; both fixed.
- 6A's delete test expected files to vanish at once; with Recently deleted they go on permanent delete or after 30 days.
  Updated the test to check both steps.

**Checks actually run**
- `pytest`: **175 passed** (160 earlier + 15 new in `tests/test_phase6d.py`: deactivate hides everything and reactivate
  brings it back; delete needs the username or email and can be cancelled; the purge after 30 days deletes the
  account's files and calls the admin API, not before; download my data contains only your own rows; hidden words;
  who can comment (API and raw SQL); who can mention me; Recently deleted (hidden, no editing, restore, purge with
  pictures); liked posts and my comments; search history (folding half-typed searches, per-user, delete one / all);
  time spent (a long gap counts one minute at most, wrong dates refused); report a problem (screenshot checked, others
  cannot read, nobody can change); new tables closed to the browser; sign-in required).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: 29 passed (5 new). `npm run build`: succeeded with the new
  routes.
- Headless Chrome on the local test stack (never the real Supabase) at 1280 px and 390 px: Settings home and search,
  Account, privacy extras with hidden words, Your activity (time, likes, Recently deleted, search history), Help,
  Language switched to Hindi (menu and Settings in Hindi), a legal page while signed out, and the full deactivate flow
  (confirm → signed out → profile 404 for others → banner → Reactivate → profile back). No console errors.
- **Not run**: migration 0009 on the real Supabase project; real email change / password change emails; the 30-day purge
  against real Supabase (tested with a simulated admin API).

## 2026-10-23 · Phase 6E – onboarding, admin panel, verified badge

**Decisions**
- **Admin role** is a separate table (`admin_users`), not `profiles.role` (that is the profession: designer, tailor...).
  Admins are added only with SQL. The admin tables are not granted to the app role at all; admin routes check
  `is_admin()` in the person's own session, then use the system connection and log every change.
- **Suspended** people can sign in and read (so they can see why), but the database refuses publishing, comments,
  reposts and messages; drafts, archiving and deleting their own posts still work. A red banner shows the reason and
  end date. "Remove content" deletes for good (with pictures).
- **Verified badge**: `verified_accounts` (with `source` admin / premium for later) plus a trigger-maintained copy in
  `profiles.verified`, so every existing query that reads profiles shows the badge, and nobody can set it themselves.
- **Onboarding** opens automatically once (per browser session) for people with no profile who never started; anyone who
  started or has no profile sees a dismissible banner until they finish. People who set up a profile before
  onboarding existed are not nagged. Skipping is always possible.
- Reporting a single **chat message** was added so "chats" can be in the reports queue.

**Bugs found while checking**
- "Remove content" first deleted the post and then tried to close the other reports about it, but deleting had
  already emptied their link (`on delete set null`), so they stayed open. Now the other reports are closed first.
- The onboarding banner rule was confusing for people who set up a profile before onboarding existed; the API now
  says whether onboarding was `started`, and the rule is "not finished, and (started or no profile yet)".
- A TypeScript error: the banner looked up the "done" step in the list of visible steps.

**Checks actually run**
- `pytest`: **184 passed** (175 earlier + 9 new in `tests/test_phase6e.py`: admin-only access and closed admin tables;
  stats; reports queue with dismiss, remove comment / post (pictures deleted, other reports closed), log; reporting a
  chat message (not your own, only from inside the chat) and removing it; warnings until acknowledged, not yourself;
  suspensions in the API and with raw SQL, drafts still allowed, lift, permanent; problem reports with screenshot and
  status; verification request, duplicate, approve (badge on profile, post and comment), cannot self-verify (trigger
  and grants), reject with note, remove badge; onboarding new / resumable / suggestions by interests / skip / done;
  sign-in required).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: 32 passed (3 new). `npm run build`: succeeded with `/admin`,
  `/welcome`, `/settings/verification`.
- Headless Chrome on the local test stack (never the real Supabase) at 1280 px and 390 px: a brand-new person sent to
  `/welcome` and walked through all five steps, the onboarding banner, the admin overview, reports queue, suspend
  dialog, approving a verification, the action log, the admin panel on a phone, a suspended + verified person's post
  page with the red banner and the badge, and "Page not found" for a non-admin. No console errors.
- **Not run**: migration 0010 on the real Supabase project.


## 2026-10-23 · Phase 8 – Drapeit redesign and themes

**Decisions**
- Name: "Drapeit", with "by Vistas Atelier" under a text logo (`components/ui/Logo.tsx`) and the tagline
  "Drape it. Share it." on the sign-in screen. The PDF header now says "DRAPEIT BY VISTAS ATELIER". Database role
  `croquis_app`, storage keys, folders, the Render service name and the Supabase project were left alone.
- Look: ivory paper, wine as the brand colour, soft gold accents, Fraunces headings and Inter text, pill buttons,
  soft warm shadows (`shadow-card`), gold "stitch" dividers, a cover banner on profiles, and short rise / fade
  animations, all turned off by `prefers-reduced-motion`.
- Every colour, font, radius and shadow is a token in `globals.css` (`@theme static`, so variables used only from CSS
  or JavaScript are kept). Fixed colours in components were replaced: `text-white` → `text-on-wine`, `bg-white` →
  `bg-canvas` (only behind pictures), `black/10` → `ink/10`, video duration → `overlay`. Real design colours (fabric
  swatches, sketch canvas, drawing palette) stay as they are.
- Themes are full palettes in `lib/themes.ts`, applied as CSS variables on `<html>` (app) or on one element (profile,
  previews). The first paint uses an inline script that copies the saved variables from localStorage, so a chosen
  theme never flashes. "System" uses the CSS defaults plus a `prefers-color-scheme: dark` block.
- Premium: `premium_members` + `is_premium()`; no payments. Premium choices are refused by the API (403) and by a
  database trigger. A Premium theme kept after Premium ends is not deleted; the app shows "System" instead.
- Custom themes keep the person's raw colours in the database and build the full palette in the browser, adjusting
  any colour below WCAG AA and saying which one changed.
- The tailor sheet always uses the Light theme (it is a printable paper document).

**Bugs found while checking**
- Saving any setting after Premium ended was refused: `INSERT ... ON CONFLICT DO UPDATE` runs the database's insert
  trigger first, which saw the kept Premium theme as a new choice. The repository now runs UPDATE first and INSERT only
  when there is no row.
- The profile name was drawn over the cover banner, and the banner's top margin "collapsed" out of the themed area
  (a strip of the app theme showed above it). Fixed with padding instead of margin and a new header layout.
- Hex inputs in the custom theme editor were too narrow next to the preview; the fields now stack on wide screens.
- Theme cards first used `role="radio"` without arrow-key support; they are now ordinary toggle buttons
  (`aria-pressed`) in labelled groups. On phones the profile tabs no longer centre (which could hide the first tab).

**Checks actually run**
- `pytest`: **191 passed** (184 earlier + 7 new in `tests/test_phase8.py`: defaults and free themes; Premium themes,
  custom themes and the custom colours refused without Premium by the API and by raw SQL; allowed with Premium; bad
  colours refused (API and check constraint); nobody can insert or change `premium_members`; visitors see only the
  profile theme (custom colours only while used) and the Premium tag, never someone's app theme; a kept Premium theme
  survives the end of Premium while other changes still save; the data export includes appearance).
- `npm run lint`, `npm run typecheck`: clean. `npm test`: **52 passed** (`lib/themes.test.ts`: every theme passes AA
  for every text pair including button hover, all tokens defined, `globals.css` equals Light / Dark, Premium gating,
  custom themes fixed to AA). `npm run build`: succeeded, with `/settings/theme`; no test addresses in the final build.
- Headless Chrome on the local test stack (never the real Supabase): feed, profile and Settings → Theme in Light, Dark
  and Denim at 1280 px; feed and Theme settings at 390 px; a Premium custom profile theme seen by its owner (Velvet app
  theme) and by a visitor; the custom editor; the "Premium – coming soon" message for a non-Premium person; an
  unreadable text colour being adjusted; System theme on a dark-mode device; the sign-in screen; inbox, chat,
  notifications, Explore, admin, onboarding, a post with comments and profiles on a phone, in Dark and Linen. No
  console errors.
- **Not run** by me: migration 0011 on the real Supabase project. (Update 2026-10-23: the owner ran it in the Supabase SQL Editor and it said "Success".)


## 2026-10-24 · Docker for running the whole app

**What changed**
- New `frontend/Dockerfile` (Node 22 slim, two stages: build, then only `package.json`, `next.config.ts`,
  `tsconfig.json`, `node_modules` and `.next`; runs as the `node` user) and `frontend/.dockerignore` (keeps
  `node_modules`, `.next` and env files out, except `.env.local`, whose public `NEXT_PUBLIC_` values are needed at build
  time).
- New `docker-compose.yml`: backend (existing `backend/Dockerfile`, settings from `backend/.env`) on port 8000 and the
  website on port 3000; `docker compose up --build`. Supabase stays online; the containers keep no data.
- README: "Run with Docker" section and the file in the project structure list.

**Checks actually run**
- `package-lock.json` lists the Linux builds of Next's compiler, Tailwind's oxide and lightningcss, so `npm ci` inside
  Docker gets them.
- The runtime stage's file set, tested without Docker: only `package.json`, `next.config.ts`, `tsconfig.json`,
  `node_modules` and the production `.next` in an empty folder; `next start` served the home page, `/settings/theme`,
  `/u/<name>` and the CSS (HTTP 200) and listened on all addresses.
- **Not run**: `docker build` / `docker compose up` (Docker is not installed on this computer, and drive C has under
  1 GB free, too little for WSL and Docker Desktop).

## 2026-10-24 · AI model name moved to settings

- `ANTHROPIC_MODEL` no longer has a default in the code: real AI needs both the key and the model name in
  `backend/.env` (or under *Environment* on Render, where `render.yaml` now asks for it). With a key but no model
  name the free mock is used and the backend prints a warning.
- The price and fallback tables are keyed by model family and version (for example `opus-5-5`), so any model name
  with that ending gets the right cost estimate.
- Provider classes renamed (`AnthropicClient`, `DesignAnswer`, `SpecFields`, `FabricAnswer`); provider name shown in
  the app is `anthropic (<model>)`.
- Checks: `pytest` **192 passed** (1 new: a key without a model name keeps the mock); `npm run lint`,
  `npm run typecheck` clean; `npm test` **52 passed**.

## 2026-10-24 · QA audit and browser tests

- Playwright browser tests in `frontend/e2e/` (desktop 1280 px and phone 390 px, using the installed Chrome):
  nine flow files (onboarding, profile, designs, publishing, social, chats and notifications, settings, admin,
  security) and an every-page check (time to content, stuck loading, sideways scrolling, crashes, empty states,
  dead buttons). `npm run e2e`, `npm run e2e:cleanup`.
- `backend/scripts/qa_users.py` creates three confirmed QA accounts with the Supabase admin API (no email sent) and
  deletes them with everything they made (Storage files, reports, chats, admin log rows). It only touches
  `qa-drapeit-%@example.com`.
- Findings, the feature checklist and the suggested fix order are in `docs/AUDIT.md`. No app code was changed.

## 2026-10-25 · Audit fixes: crashes, menus, onboarding, error pages, themes and speed

- **BUG-01** running generator jobs show "Generating…" instead of crashing the notebook (`lib/jobs.ts`).
- **BUG-04** the ⋯ menu is drawn above the page, so every item can be clicked.
- **BUG-05** the onboarding reminder refreshes after /welcome.
- **BUG-06** Drapeit error pages (`app/error.tsx`, `app/global-error.tsx`).
- **BUG-12** two theme saves at the same moment both stay (row lock, saves sent one after another).
- **BUG-02** one database connection and transaction per request; `/me/account` in one query; pool of 4 ready
  connections (`DB_POOL_MIN`); `GET /api/me/bootstrap` for the app frame, loaded at sign-in; post pictures copied on
  the storage server.
- **BUG-22** (found in the re-run) the Requests tab no longer shows the Chats list when the Chats answer is late.
- Checks: `pytest` **204 passed**; `npm test` **62 passed**; lint and type check clean; `npm run e2e` with fresh
  accounts **74 passed, 2 failed** (BUG-22, fixed and passing since; the like burst, BUG-13), 36.6 min. Before / after
  timings are in `docs/AUDIT.md` section 6 (design pages 11–14 s → about 6 s, shell API calls 11 → 7). QA accounts
  deleted afterwards.
- Still open: opening a design takes about 6 s from India; BUG-13 rate limits; the other bugs in `docs/AUDIT.md`.

## 2026-10-27 · Stitching Guide

- New generator **Generate Stitching Guide** with a notebook section: tickable checklist saved per design version,
  progress, a video player per step that starts at the right chapter, fabric tips, and a Stale badge. See README
  "Stitching Guide" and `docs/ARCHITECTURE.md`.
- Garment parser (`services/garment_parser.py`), about 40 original technique modules and 8 fabric rules
  (`app/knowledge/`), master tailor step builder (`services/stitching_guide.py`), video matching
  (`services/guide_videos.py`), optional photo reading, Gemini helpers (`providers/gemini_tools.py`).
- **Migration 0012** (`stitching_guide.sql`): `sewing_modules` (with a pgvector column), `sewing_fabric_rules`,
  `video_search_cache`, `video_index_runs`, `video_segments`, `stitch_progress`. Seed script
  `scripts/seed_sewing_library.py`.
- The YouTube details call now also returns the full description (same 1 quota unit) for chapters.
- Tests: new backend test files for the parser, library, providers, database, builder and videos; `npm test` has
  `lib/stitching.test.ts`; browser test `e2e/pages/stitching-guide.e2e.ts` on a desktop and a phone screen.
- **Not run** by me: migration 0012 and the seed script on the real Supabase project (the tests used a local test
  database, a fake YouTube server and a local sign-in).

