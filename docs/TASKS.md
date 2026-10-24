# Task checklist

## Phase 1 – Foundation ✅
- [x] Inspect environment
- [x] Project structure (frontend, backend, supabase, docs)
- [x] Frontend set up (Next.js, TypeScript, Tailwind)
- [x] Dashboard and notebook layout
- [x] Design canvas (tools, layers, undo/redo, import, export)
- [x] Project saving (SQLite) with version history
- [x] Navigation and responsive layouts
- [x] Mock providers for design, sketch, fabric, materials; tailor sheet builder
- [x] README, env examples, architecture notes, log

## Phase 2 – First real AI workflow ✅ (code done; live keys pending your go-ahead)
- [x] Explain Anthropic API and image API account setup and cost
- [x] Anthropic provider with structured output: Generate Design now returns a full design plan
- [x] The Anthropic provider also powers fabric recommendations and the tools & materials checklist
- [x] Image providers: Google Gemini and OpenAI GPT Image (pick with IMAGE_PROVIDER)
- [x] Real sketch generation in 6 styles + new Generate Visual Preview
- [x] Every generated picture saved as an asset linked to its job and design version (image library)
- [x] Version history shows what changed and how many pictures each version has
- [x] Daily spending limit + estimated spending page; keys never leave the backend
- [x] Mocks stay as the free fallback when no key is set
- [ ] First live test with real keys (needs your accounts)
- [ ] Follow-up questions as a real conversation in the notebook (moved to Phase 3)

## Phase 3 – Fashion intelligence ✅ (no new paid API)
- [x] Fabric Studio: climate, occasion, budget, comfort, drape, maintenance, weight, relative cost; lining and embellishment suggestions with reasons; swatches in the design's colours; sort; favourites
- [x] Larger built-in fabric table (19 fabrics) for the free mock; AI prompt updated for the same fields
- [x] Tools & materials tied to the design version: what each item is for, obvious counts only, fabric-specific supplies, ticks remembered
- [x] Tailor Workspace: measurements with units and notes (Measured / Estimate / Missing), neckline, sleeves, length, fit, closures, construction / cutting / stitching notes, front / back / side / detail references
- [x] Tailor sheet never invents cutting dimensions (checked by tests)
- [x] Server-side PDF export with a professional A4 layout (ReportLab)
- [x] Cost Estimate generator: user prices only, region and date, labour separate, buffer %, missing lines listed, assumptions, budget comparison
- [ ] Real fabric data source and reliable prices (needs a data source you trust; prices stay empty until then)
- [ ] Follow-up questions as a real conversation in the notebook (moved from Phase 2)
- [ ] Hindi (Devanagari) text in the PDF (needs a bundled Indic font and text shaping)

## Phase 4 – Learning and advanced generators ✅ (only new service: free YouTube Data API)
- [x] Explain YouTube Data API setup and cost (free quota, no billing)
- [x] Generate Tutorial: learning guide from the design, real videos per step, reasons, search links; never made-up videos
- [x] Learning Library search page (any / English / Hindi)
- [x] Design Variations (neckline, sleeves, silhouette, embellishment, colour) with "Try this" → new version
- [x] Moodboard (mood words, palette, textures, motifs, references, project pictures)
- [x] Embroidery & Print concepts with a front/back placement diagram
- [x] Pattern Assistance, clearly conceptual: pieces, required measurements, drafting guidance, not-to-scale cutting layout
- [x] Instructional Video: storyboard + script fallback with real tutorial links (no video provider configured)
- [x] Fix: free real services (built-in code, YouTube) no longer counted as paid calls (database v3)
- [ ] First live test with a real YOUTUBE_API_KEY (needs your Google account)
- [ ] A real video generation provider (only after choosing one and agreeing on its cost)
- [ ] Save chosen tutorials to the project (the planned `saved_tutorials` table)

## Phase 5 – Quality and deployment ✅ (code and docs; live deployment waits for your accounts)
- [x] End-to-end check of every core workflow (automated test + headless Chrome at phone and desktop width)
- [x] Fixed phone layout: tools panel moved up, provider table, cost list, tailor-sheet table spacing
- [x] Supabase Postgres with per-user Row Level Security (migrations 0004, 0005), tested on real PostgreSQL
- [x] Supabase Auth: email + password sign-up, sign-in, forgot password, sign-out; backend token checks (JWKS + legacy secret)
- [x] Supabase Storage (private bucket) for pictures; short-lived media tokens for `<img>`
- [x] Security review: secrets server-side only, validation, upload limits, per-user rate limits, log redaction (docs/SECURITY.md)
- [x] Clear error messages (backend handlers with request ids, frontend plain-words fallbacks)
- [x] Deployment: Dockerfile, render.yaml, both .env.example files, docs/DEPLOYMENT.md with costs
- [x] One-time import of the old SQLite data into Supabase (`scripts/import_sqlite.py`)
- [ ] Create the Supabase, Render and Vercel accounts and run the first live deployment (needs you; ask before deploying)
- [ ] Connect SMTP for sign-up emails before inviting customers
- [ ] Put the code on GitHub (private) — I will only push if you ask

## Phase 6A – Profiles and publishing ✅ (no new paid service; migration 0006 waits for you to run it)
- [x] Profiles: unique username, display name, bio, avatar upload, role; public page `/u/<username>`; edit page
- [x] Publish from any design: pick pictures, palette, fabric; caption; tags (garment, fabric, occasion)
- [x] Visibility Public / Followers / Close Friends / Private, enforced by Row Level Security (migration 0006)
- [x] Drafts, edit, archive, delete with confirmation, pin to profile (up to 3)
- [x] Measurements, budget, notes, client names and reference photos never published (allowlist + test)
- [x] Close Friends list (search, add, remove); follow / unfollow
- [x] Home Feed (newest first, pages of 12), Like and Save with counts, Saved page
- [x] Empty, loading and error states; checked in headless Chrome at phone and desktop width
- [ ] Run `0006_profiles_and_posts.sql` in your Supabase SQL Editor (needs you)
- [x] 6B: comments, blocking/reporting, follow requests (see below)
- [ ] Later: notifications, posts visible without signing in

## Phase 6B – Social features ✅ (no new paid service; migration 0007 waits for you to run it)
- [x] Follower and following lists; remove a follower; unfollow asks first
- [x] Private account toggle, follow requests (send, cancel, accept, decline), `/requests` page
- [x] Comments: add, reply (one level), like, delete own, post owner deletes any; delete asks first
- [x] Repost with "Reposted by" and the designer's credit; Share (copy link / phone share menu)
- [x] Block (auto-unfollow both ways), restrict (approve comments), mute (feed + Explore), report (post, comment, user)
- [x] Privacy & safety page: private account, blocked / restricted / muted lists with undo
- [x] Explore: grid, filters (garment, occasion, colour, fabric), Trending (7 days), search (people, posts, tags)
- [x] Migration 0007 with Row Level Security for visibility, private accounts, blocks and restricted comments
- [x] Loading, empty and error states; checked in headless Chrome at 360 / 390 px and 1280 px
- [ ] Run `0007_social_features.sql` in your Supabase SQL Editor (needs you)
- [ ] Later: admin page for reports
- [x] Notifications and direct messages (Phase 6C, below)

## Phase 6C – Chats and notifications ✅ (no new paid service; migration 0008 waits for you to run it)
- [x] 1-to-1 chats: inbox (newest first, unread numbers), chat screen, text, share a post (to up to 10 people),
      send a design picture (a copy; never reference photos or the design's name), unsend own message, "Seen"
- [x] Message requests (people you don't follow): Requests tab, Accept / Delete / Block; replying accepts
- [x] "Who can message me": everyone / followers / nobody (people you follow can always message you)
- [x] Blocks stop messages both ways; block and report from the chat's ⋯ menu; delete a chat for yourself
- [x] Live updates with Supabase Realtime (private channel per person; only "something changed" travels), polling fallback
- [x] Notifications for likes, comments, replies, follows, follow requests, mentions (comments and captions), reposts,
      messages; unread dot and number on the menu; mark all as read; Accept / Decline / Follow back in the list
- [x] Notification settings page (each kind on / off)
- [x] Migration 0008 with Row Level Security; notifications written by database triggers
- [x] Loading, empty and error states; checked in headless Chrome at 390 px and 1280 px
- [ ] Run `0008_chats_and_notifications.sql` in your Supabase SQL Editor (needs you)

## Phase 6D – Full settings ✅ (no new paid service; migration 0009 waits for you to run it)
- [x] Settings home with search; AI providers moved to `/settings/ai-providers`; one "Settings" item in the menu
- [x] Account: edit profile, change email and password (Supabase Auth, current password checked), download my data
      (JSON), deactivate (hidden until you sign in again), delete (type username, 30-day grace, then files + account)
- [x] Privacy: who can comment, who can mention me, hidden words (plus private account, who can message, lists with undo)
- [x] Your activity: time spent this week, likes, my comments, archived, Recently deleted (restore / delete for good),
      search history (clear one / all); Saved stays at `/saved`
- [x] Language: English / Hindi / Hinglish for menu, Settings, Help and common buttons, remembered in the browser
- [x] Help: questions and answers, Report a problem (optional screenshot), contact (NEXT_PUBLIC_SUPPORT_EMAIL)
- [x] Legal: Terms, Privacy Policy, Community Guidelines (drafts, marked "needs legal review"), open without signing in
- [x] Migration 0009 with Row Level Security; cleanup job for 30-day removals
- [x] Checked in headless Chrome at 390 px and 1280 px
- [ ] Run `0009_settings_and_activity.sql` in your Supabase SQL Editor (needs you)
- [ ] Have a lawyer review the legal pages before launch (needs you)

## Phase 6E – Onboarding, admin panel, verified badge ✅ (migration 0010 waits for you to run it)
- [x] Onboarding at `/welcome`: username / name / role, picture, interests, 5-10 people to follow, 3-screen tour;
      skippable, resumable, opened once for brand-new people, then a gentle banner until finished
- [x] Admin panel `/admin` (admins only, set with SQL): stats, reports queue (posts, comments, accounts, chat messages)
      with dismiss / remove content / warn / suspend, problem reports, verification requests, suspensions, action log
- [x] Suspensions (days or permanent) enforced in the API and the database, with a clear banner; warnings until
      acknowledged
- [x] Verified badge on profiles, posts, comments, chats, people lists and notifications; request form in Settings;
      `verified_accounts.source` ready for Premium
- [x] Report a single chat message
- [x] Migration 0010 with Row Level Security (admin tables closed to the app role)
- [x] Hindi / Hinglish for the new menu, onboarding, banners and admin tabs
- [x] Checked in headless Chrome at 390 px and 1280 px
- [ ] Run `0010_onboarding_admin_verification.sql` and add yourself to `admin_users` (needs you)

## Phase 8 – Drapeit redesign and themes ✅
- [x] Renamed to "Drapeit" everywhere people see it (title, metadata, logo, menu, sign-in, onboarding, help, legal,
      translations, PDF header, data export, README and docs); "by Vistas Atelier" under the logo; tagline
      "Drape it. Share it." Database names, folders and code identifiers unchanged
- [x] Editorial redesign: ivory / wine / soft gold, serif headings, pill buttons, soft card shadows, stitch dividers,
      cover banners, gentle motion that respects reduced motion
- [x] All colours, fonts, radii and shadows are design tokens (`globals.css`); hard-coded colours removed from components
- [x] Themes: System, Light, Dark, Linen, Cotton, Denim (free); Silk, Velvet, Brocade, Khadi, Chiffon (Premium, locked,
      "coming soon"); CSS-only fabric textures; Settings → Theme with preview cards; saved to the account and browser,
      no flash on load
- [x] Profile theme that every visitor sees (colours, texture, cover banner); Premium tag on Premium profiles
- [x] Customize your theme: colours, texture, font, cover, live preview, contrast ratios; unreadable colours adjusted
      with a message; saving locked behind `is_premium`
- [x] Every theme passes WCAG AA (tested); visible focus states; checked at 390 px and 1280 px
- [x] Migration 0011 with Row Level Security; nobody can make themselves Premium (tested)
- [x] Run `0011_themes_and_premium.sql` in your Supabase SQL Editor (done 2026-10-23: "Success")
- [ ] If you customised Supabase's email templates, change "Croquis" to "Drapeit" there (needs you)
- [ ] Later (Phase 7): payments that add `premium_members` rows

## QA audit
- [x] Playwright browser tests (`frontend/e2e/`) and QA account script (`backend/scripts/qa_users.py`)
- [x] `docs/AUDIT.md`: checklist, bugs, fix order
- [ ] Fix the bugs in the three groups listed in `docs/AUDIT.md` section 5

## Docker
- [x] `frontend/Dockerfile`, `docker-compose.yml` and README "Run with Docker" (runtime files tested without Docker)
- [ ] Run `docker compose up --build` once on a computer with Docker Desktop (needs you or whoever gets the code)

