# Drapeit by Vistas Atelier

*Drape it. Share it.* *(code name: AI Fashion Design Notebook; the old app name "Croquis" still appears in code
identifiers such as the `croquis_app` database role, which were not renamed on purpose)*

A web app that helps tailors, boutique owners, designers, students and anyone with a clothing idea go from

**Idea → Design concept → Sketch → Fabric → Materials → Tailor-ready sheet**

> **Status: Phase 8 (Drapeit redesign and themes).** The app is now called **Drapeit** (tagline *Drape it. Share
> it.*) with a fashion-magazine look: ivory paper, wine and soft gold, serif headings, soft shadows, thin
> embroidery-like dividers and gentle motion (switched off when your device asks for reduced motion). **Settings →
> Theme** has free themes (System, Light, Dark, Linen, Cotton, Denim), Premium themes (Silk, Velvet, Brocade, Khadi,
> Chiffon) and **Customize your theme** with a live preview. Premium is not for sale yet: those themes show a
> "Premium" label and "coming soon", and saving them is locked. You can also choose a separate **profile theme** that
> everyone sees on your profile. Every theme passes WCAG AA contrast. **One new database file to run:**
> `supabase/migrations/0011_themes_and_premium.sql` (see [Upgrading to Phase 8](#upgrading-to-phase-8)).
>
> **Phase 6E (onboarding, admin, verified badge).** New people get five short, skippable welcome steps
> (profile, picture, interests, people to follow, a 3-screen tour) and a gentle banner until they finish. An **Admin
> panel** at `/admin` (only for admins) has the reports queue (posts, comments, accounts, chat messages), problem
> reports, warnings, suspensions (temporary or permanent), verification requests, stats and an action log. Verified
> accounts show a badge next to their name everywhere. **One new database file to run:**
> `supabase/migrations/0010_onboarding_admin_verification.sql` (see [Upgrading to Phase 6E](#upgrading-to-phase-6e)).
>
> **Phase 6D (full settings):** One **Settings** page with search: Account (edit profile, change email and
> password, download your data, deactivate, delete with a 30-day grace period), Privacy (who can comment, who can
> mention you, hidden words, plus the existing controls), Your activity (time spent, likes, comments, archived,
> Recently deleted posts with restore, search history), Language (English / हिन्दी / Hinglish for the menu, Settings and
> common buttons), Help (questions and answers, Report a problem with a screenshot) and draft legal pages. **One new
> database file to run:** `supabase/migrations/0009_settings_and_activity.sql` (see
> [Upgrading to Phase 6D](#upgrading-to-phase-6d)).
>
> **Phase 6C (chats and notifications):** Private 1-to-1 **Messages** (inbox with unread numbers, message
> requests, "Seen", send posts and design sketches, unsend, block and report from the chat, "Who can message me") and
> **Notifications** (likes, comments, replies, follows, follow requests, mentions, reposts, messages; mark all as read;
> turn each kind on or off). New messages appear without reloading (Supabase Realtime). **One new database file to
> run:** `supabase/migrations/0008_chats_and_notifications.sql` (see [Upgrading to Phase 6C](#upgrading-to-phase-6c)).
>
> **Phase 6B (social features):** follower lists, private accounts with follow requests, comments with replies,
> reposts with credit, Share links, block / restrict / mute / report, and an **Explore** page with filters, Trending and
> search (migration `0007_social_features.sql`).
>
> **Phase 6A (profiles and publishing):** make a public profile, publish designs as posts (Public, Followers,
> Close Friends or Private), follow people, and like and save posts in a Home Feed. Measurements and client
> details are never published (migration `0006_profiles_and_posts.sql`).
>
> **Phase 5 (quality and deployment):** The app now runs on **Supabase**: everyone signs in
> (email + password), each user only ever sees their own designs (checked in the code *and* by the
> database's Row Level Security), and pictures live in private Supabase Storage. It is ready to deploy:
> **Vercel** for the website and **Render** for the backend. Start with **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**:
> it explains every step and what it costs (free to try).
> Real AI (Anthropic, Gemini or OpenAI) and YouTube tutorial search still only switch on when you add their keys.
> Without keys everything works for free with clearly labelled **MOCK** placeholders.

## What works today

| Area | What you can do |
| --- | --- |
| Sign-in | Email + password accounts (Supabase Auth): sign up with email confirmation, sign in, sign out, and **Forgot password?** (`/forgot-password` sends a reset email; `/reset-password` sets a new password with confirmation). Each account's designs and pictures are private |
| Dashboard | Create a project, see recent projects with thumbnails, search and filter, quick links |
| Notebook | Write ideas and notes, upload reference images, run generators one by one or as a complete package, edit the shared design spec, see version history (with what changed) and restore old versions. **New:** full design plan (concept, colour story with swatches, design details, order of work, difficulty), visual preview, and an image library of every generated picture grouped by design version |
| Design Studio | Draw with pencil, pen, brush, eraser, line, rectangle, ellipse; colours, brush size, undo/redo, clear, layers, image import, place generated sketches as a tracing layer, save, download PNG, save as the project thumbnail |
| Fabric Studio | Fabric suggestions scored on climate, occasion, budget, comfort, drape, care and skill. Each card shows comfort / drape / breathability meters, care, weight, a *relative* cost level (never a price), and one-line climate, occasion and budget notes. Swatches are drawn in your design's own colours. Lining and embellishment suggestions with reasons. Sort by match, comfort, care, breathability or drape. Save favourites into the design |
| Tools & Materials | A checklist for one design version: each item says which part of the design needs it (closure, neckline, fabric, embellishment) and gives counts only when obvious. Fabric-specific needles and tools. Ticks are remembered in your browser |
| Tailor Workspace | Measurements (cm/in) with notes, marked **Measured**, **Estimate** or **Missing**; neckline, sleeves, length, fit, closures; your construction, cutting and stitching notes; pick front / back / side / detail reference pictures. The sheet adds fabric-specific cutting and stitching advice and **never invents cutting dimensions**. **Download PDF** (A4, professional layout) or print |
| Cost Estimate | Lists what needs a price (from your fabrics and checklist), you type real quantities and prices with region and date, it adds them up. Materials and labour are separate, a buffer % is optional, missing prices are listed (not guessed), every assumption is written out, and the total is compared with your budget |
| My Designs | All projects with search, filter, sort, duplicate, export (JSON), delete |
| Stitching Guide (Notebook) | Step-by-step stitching in the order a tailor works (prep, shaping, main seams, openings, side seams, hem, pressing), built from about 40 technique modules and fabric rules for 8 fabrics, with a real tutorial video for each step started at the right chapter, a checklist saved per design version, and a Stale badge when the spec changes. See [Stitching Guide](#stitching-guide) |
| Learning Library | Search real YouTube tutorials (any language, English or Hindi): real titles, thumbnails, channels and links, plus the reasons each one fits. Without a key it explains the free setup and links to the same search on YouTube. Never shows made-up videos |
| Phase 4 generators (Notebook) | **Tutorial**: a learning guide for this design (garment, measurements, embellishment, neckline, tricky fabric, zip) with real videos per step. **Design Variations**: alternative necklines, sleeves, silhouettes, embellishments and colours, each with a "Try this" button that saves it as a new version. **Moodboard**: mood words, palette, textures, motifs, visual references and your project's own pictures. **Embroidery & Print**: techniques, motifs, materials and a front/back placement diagram. **Pattern Assistance** (conceptual, not production-ready): pieces to cut, required measurements, drafting guidance and a not-to-scale cutting layout. **Instructional Video**: no video provider is set up, so it writes a storyboard and narration script and adds real tutorial links |
| Profile | Username (unique), display name, bio, avatar picture and role (designer, tailor, boutique, student, other). Public page at `/u/<username>` with a grid of published designs (up to 3 pinned first). Edit at `/profile/edit`. Follow / unfollow other people |
| Publishing | **Publish** button on every design. Choose which sketches and generated pictures to show, and whether to show the colour palette and fabric. Caption and tags (garment, fabric, occasion). Visibility: Public, Followers, Close Friends or Private. Save as draft, edit, archive, delete (asks first), pin to profile. Measurements, budget, notes, client names and uploaded reference photos are **never** published |
| Close Friends | `/close-friends`: search people by username or name, add or remove them |
| Home Feed | `/feed`: every post you are allowed to see, newest first, 12 at a time with **Load more**. Like and Save with counts. `/saved` lists what you saved. **6B:** a post that someone you follow reposted moves up and says "Reposted by @name · design by @designer". Muted people's posts are left out |
| Followers | **6B:** tap the follower / following count on a profile to see the lists (`/u/<username>/followers`, `/following`). On your own lists: **Remove** a follower or **Unfollow** (both ask first) |
| Private account | **6B:** `/settings/privacy` → *Private account*. Then only people you accept (and your Close Friends) see your posts, reposts and follower lists. Others press **Request to follow**; you **Accept** or **Decline** on `/requests` (button on your profile shows how many wait). Making the account public again accepts everyone waiting |
| Comments | **6B:** on every published post: add, reply to a comment (one level), like a comment, delete your own; the post owner can delete any comment on their post. Deleting asks first |
| Repost and Share | **6B:** **Repost** puts someone's Public post on your profile's *Reposts* tab (the designer's name always stays on it). **Share** copies the post's link (on phones it opens the share menu); the link only opens for people allowed to see the post |
| Safety | **6B:** the **⋯** button on a profile: **Restrict** (their new comments on your posts wait for your **Approve**), **Mute** (their posts leave your feed and Explore; you still follow), **Block** (asks first; they cannot find you or see your posts and comments, and you unfollow each other), **Report** (post, comment or account, with a reason). `/settings/privacy` lists blocked, restricted and muted accounts with Unblock / Unrestrict / Unmute |
| Explore | **6B:** `/explore`: grid of Public posts from public accounts, filters for garment, occasion, colour and fabric, **Trending** (most likes + saves in the last 7 days), and search for people, posts and tags |
| Themes | **8:** Settings → Theme (`/settings/theme`): preview cards for System (follows the device's light / dark), Light, Dark, Linen, Cotton and Denim. Each fabric theme has its own colours and a subtle fabric texture drawn with CSS only. Saved to your account and to this browser (so it shows at once, without a flash). Silk, Velvet, Brocade, Khadi, Chiffon and the custom theme are Premium (locked, "coming soon") |
| Profile theme | **8:** choose a theme for your public profile, separately from the app theme. Everyone who opens `/u/<username>` sees it (colours, texture, cover banner). "Default" shows your profile in each visitor's own theme. Premium members get a small **Premium** tag |
| Custom theme | **8:** pick a brand colour, background, text colour, fabric texture, heading font and profile cover, with a live preview and the contrast ratios. Colours that would be hard to read are adjusted (and the screen says which). Saving needs Premium (`is_premium`, off by default), so payments can unlock it later |
| AI Providers | Which provider each service uses (mock / live), which keys are set, a daily spending limit and estimated spending |

Generators available now: **Design (with design plan), Sketch (6 styles), Visual Preview, Fabric, Tools & Materials, Tailor Sheet, Cost Estimate, Design Variations, Moodboard, Embroidery & Print, Pattern Assistance, Tutorial, Instructional Video (storyboard), Complete Package**.

## Requirements

- **Node.js 20 or newer** (we developed on Node 22) – <https://nodejs.org>
- **Python 3.11 or newer** (we developed on 3.13) – <https://python.org>
- Git

Check with `node -v`, `python --version` (or `python3 --version`).

## Run it locally (two terminals)

The app has two parts that run at the same time: the **backend** (Python, port 8000) and the **frontend**
(website, port 3000). Since Phase 5 both need a **Supabase project** (free): create one first by following
steps 2 and 3 of [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). You only do that once.

### Terminal 1 – backend

```bash
cd backend
python -m venv .venv                 # creates a private Python folder for this project (first time only)

# activate it (do this every time you open a new terminal)
source .venv/bin/activate            # macOS / Linux
.venv\Scripts\activate               # Windows (PowerShell or cmd)

pip install -r requirements.txt      # first time, and again after updating to a new phase
copy .env.example .env               # first time only (macOS/Linux: cp .env.example .env), then fill it in
uvicorn app.main:build --factory --reload --port 8000
```

If a setting is missing, the backend stops and lists exactly what to fill in. When it runs,
<http://localhost:8000/api/health/ready> says `{"status":"ok"}` and <http://localhost:8000/docs> lists every endpoint.

### Terminal 2 – frontend

```bash
cd frontend
npm install                          # first time, and after updating
copy .env.example .env.local         # first time only (macOS/Linux: cp), then fill in the two Supabase values
npm run dev
```

Open <http://localhost:3000>, press **Create an account**, confirm the email, and sign in.
Your Phase 1–4 designs can be copied into your account once with
`python scripts/import_sqlite.py --email you@example.com` (inside `backend/`, see DEPLOYMENT.md).

## Run with Docker (one command, instead of the two terminals)

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) (free for personal use and small businesses)
and the same **Supabase project** as above: the database, sign-in and file storage stay on Supabase.

1. Make the two settings files, as in the two-terminal steps above:
   `backend/.env` (from `backend/.env.example`) and `frontend/.env.local` (from `frontend/.env.example`).
   Keep `FRONTEND_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_API_URL=http://localhost:8000`.
2. In the project folder (where `docker-compose.yml` is):

   ```bash
   docker compose up --build
   ```

   The first time takes a few minutes (it downloads Python and Node and installs everything).
3. Open <http://localhost:3000>. Stop with Ctrl+C (or `docker compose down`).

After changing `frontend/.env.local`, run `docker compose up --build` again: the website's `NEXT_PUBLIC_` values
are written into it when it is built. Render uses the same `backend/Dockerfile`; Vercel does not use Docker.

## Browser tests (Playwright)

`frontend/e2e/` clicks through every flow in Chrome on a desktop and a phone-sized screen with three throw-away
accounts (made and deleted by `backend/scripts/qa_users.py`). With the backend and website running:
`cd frontend`, then `npm run e2e`, and `npm run e2e:cleanup` to delete the accounts. Details in
[frontend/e2e/README.md](frontend/e2e/README.md); the latest results are in [docs/AUDIT.md](docs/AUDIT.md).

### Try this first

1. On the dashboard, name a design (e.g. *Wine anarkali*) and paste an idea such as
   *"An embroidered wine colour anarkali with full sleeves and a V-neck for a winter wedding, with gold zari work"*.
2. In the notebook press **Generate** next to *Design*, read the concept, then **Use this as the design spec**.
3. Press **Generate complete design package**, keep the defaults, **Run selected**.
4. Change the neckline in the **Design spec** tab and save. The sketch is marked **Out of date**; press **Update** on just that one.
5. Open **Design Studio**, click a generated sketch to place it as a layer, draw over it, then **Save as project sketch**.
6. In **Fabric Studio** try *Sort by → Easiest care*, then **Save to design** on a fabric you like.
7. In **Tailor Workspace** add measurements (tick *Measured* only for real ones), write a cutting note,
   pick a front and a back picture, press **Save tailor details**, then **Generate tailor sheet** and **Download PDF**.
8. In **Cost Estimate** press **Fill from my checklist**, type real quantities and prices, then **Calculate estimate**.
9. Back in the Notebook, generate **Design Variations** and press **Try this** on one; generate the
   **Moodboard**, **Embroidery & Print**, **Pattern Assistance**, **Tutorial** and **Instructional Video**.
10. Open **Learning Library** and search for a technique (needs the free YouTube key for results).

## Turn on real AI (Phase 2)

Real AI costs a little money per use, paid to the AI company (not to us). **Nothing is charged
until you add a key.** A chat app subscription (ChatGPT Plus, a Gemini plan and so on) does **not** count:
apps need a separate "API" account with its own billing.

Approximate prices (October 2026, $1 ≈ ₹88; always check the company's pricing page):

| What | Provider | Rough cost |
| --- | --- | --- |
| One design plan, fabric list or materials list | Anthropic API (newest Opus model) | about ₹3–8 each |
| One sketch or visual preview | Google Gemini (`gemini-nano-banana-2.1`) | about ₹3 each |
| One sketch or visual preview | OpenAI (`gpt-image-2`, medium quality) | about ₹5–7 each |

So a full package (design + sketch + preview + fabric + materials) is roughly ₹20–35.

### Step 1 – Anthropic API key (design planning)

1. Go to <https://console.anthropic.com> and sign up (this is separate from any chat app account).
2. **Billing**: add a card and buy a small amount of credit, for example $5.
3. **API keys** → *Create key* → copy it (it starts with `sk-ant-`). You can only see it once.
4. **Models**: copy the name of the newest Opus model. It goes in `ANTHROPIC_MODEL` (real AI needs both).

### Step 2 – an image key (pick one)

**Google Gemini (recommended, cheaper):**
1. Go to <https://aistudio.google.com>, sign in with Google, click **Get API key** → *Create API key*.
2. Turn on billing for that key's Google Cloud project (AI Studio shows a "Set up billing" link).
   Image models do not work on the free tier.

**or OpenAI:**
1. Go to <https://platform.openai.com>, sign up, add credit under **Billing**.
2. **API keys** → *Create new secret key*. OpenAI may ask you to verify your organisation (ID check) before image models work.

### Step 3 – put the keys in `backend/.env`

```bash
cd backend
cp .env.example .env          # Windows: copy .env.example .env
```

Open `backend/.env` in VS Code and paste after the `=` sign, with no spaces or quotes:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=(the model name from step 1)
GEMINI_API_KEY=AIza...
```

Then **restart the backend** (Ctrl+C, then the `uvicorn` command again; on Render, set them under
*Environment* and redeploy). The terminal prints which
provider each service uses, and **AI Providers** in the app shows *Live · paid*.

Safety rules:
- Never paste a key into code, a chat, a screenshot or GitHub. `.env` is ignored by git.
- `DAILY_BUDGET_USD` (default `1.0`) stops paid AI for the day once the estimated spend reaches it.
- Lost or leaked key? Delete it on the provider's website and create a new one.
- To go back to free mode, empty the key (or set `LANGUAGE_PROVIDER=mock` / `IMAGE_PROVIDER=mock`).

If something fails, the output card shows a plain message (wrong key, no credit, rate limit,
safety filter) with a **Retry** button.

## Turn on tutorial search (Phase 4)

Generate Tutorial and the Learning Library use the **YouTube Data API v3**. It is **free**: there is
no billing, only a daily quota of 10,000 units. One search costs 100 units, so that is about
**100 searches a day**. One "Generate Tutorial" makes up to 5 searches (one per topic). When the
quota is used up, searches stop until it resets the next day; nothing is charged.

1. Go to <https://console.cloud.google.com> and sign in with a Google account.
2. Create a project (top bar → project picker → **New project**), e.g. "Drapeit".
3. Open **APIs & Services → Library**, search **YouTube Data API v3**, press **Enable**.
4. Open **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. Optional but wise: **Edit API key → API restrictions → Restrict key → YouTube Data API v3**.
6. Paste it into `backend/.env`:
   ```
   YOUTUBE_API_KEY=paste-your-key-here
   ```
7. Restart the backend. **AI Providers** now shows *Tutorial search: youtube-data-api*.

Without a key, Generate Tutorial still builds the learning steps, with a link per step that opens
the same search on YouTube, and shows **no** videos. The app never invents titles or links.

**Instructional video generation** is not connected: video AI is expensive and its prices change
often. Generate Instructional Video therefore makes a free storyboard and narration script. A real
video provider can be added later behind the same generator, after we agree on a provider and its cost.

## Checks

```bash
# backend (inside backend/, with the venv active)
pip install -r requirements-dev.txt
python scripts/get_test_postgres.py   # Windows, one time: PostgreSQL programs for the tests (~13 MB)
python -m pytest                      # runs on a real, temporary PostgreSQL with the real migrations

# frontend (inside frontend/)
npm run lint
npm run typecheck
npm test
npm run build
```

## Project layout

```
backend/            Python FastAPI API
  app/main.py         app setup
  app/schemas/        data shapes (shared DesignSpec, API, generator outputs)
  app/providers/      provider interfaces + mock providers (swap these for real AI later)
  app/generators/     list of generators and what each depends on
  app/services/       generation jobs, package orchestration, tailor sheet + PDF, cost estimate,
                      fabric handling advice, tutorials, pattern assistance, storyboards,
                      uploads, rate limit
  app/auth.py         sign-in checks (Supabase tokens) and media tokens for pictures
  app/storage/        Postgres connection, repository (all SQL lives here), Supabase Storage
  scripts/            test PostgreSQL download, one-time import of the old SQLite data
  tests/              real-PostgreSQL tests, including per-user access and an end-to-end run
  Dockerfile          the backend image Render runs
frontend/           Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
  src/app/            pages (routes)
  src/components/     UI pieces (notebook, studio, outputs, project, ui)
  src/components/auth sign-in screen and session handling
  src/components/social profiles, posts, feed, publishing, close friends
  src/components/theme  theme provider (applies and remembers the theme) and theme previews
  src/app/globals.css design tokens: every colour, font, radius, shadow and motion setting
  src/lib/            API client, Supabase sign-in client, types, canvas drawing model, themes, helpers
supabase/migrations The database: run 0001–0012 in order in Supabase (tables, per-user rules, storage)
render.yaml         Render blueprint for the backend
docker-compose.yml  Runs backend and website together with Docker (backend/Dockerfile, frontend/Dockerfile)
docs/               Deployment guide, security notes, architecture, development log, task checklist
```

More detail: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) · [docs/TASKS.md](docs/TASKS.md)

## Stitching Guide

**Generate Stitching Guide** (Notebook → Generate) turns a design into step-by-step stitching instructions, in the
order a real tailor works, with the right tutorial video for each step.

1. **Reads the garment.** The garment type, bodice, neckline and how it is finished, sleeves, skirt, closure and where it
   sits, length, fabric and fabric weight are worked out from the design spec. If you uploaded a reference photo and a
   picture-reading provider is set up, the photo fills in what the spec leaves empty (the spec always wins). Anything
   guessed is listed under "What the guide worked out for itself".
2. **Picks the techniques.** A library of about 40 original technique modules (stay-stitching, interfacing, darts, pleats,
   gathers, shoulder and side seams, bodice to skirt, facings, bias binding, invisible and lapped zips, set-in sleeves,
   cuffs, waistband, rolled / blind / machine hems, French and flat-fell seams, pressing...) plus rules for silk, chiffon,
   georgette, cotton, linen, denim, velvet and khadi (needle, thread, stitch length, seam type, pressing heat). Steps are
   chosen from the garment's features; words in your design notes can add more (by meaning when Gemini is set up).
3. **Orders them like a tailor:** prep and cutting, shaping, main seams, openings and finishes, side seams, hem, pressing.
   Each step shows which module it came from and fabric-specific tips. With the Anthropic API set up, the steps are
   worded for your design; without it they come straight from the library (no AI, no cost).
4. **Finds a real video for every step** with the YouTube search (kept for 14 days in the database, so the free quota
   lasts). If the video's description has chapters, the player starts at the matching one. The channel name is always
   shown. If nothing suitable is found it says "No video found" and links to the same search; it never invents a video.
5. **Checklist.** Tick steps as you sew; ticks are saved per design version. When the design spec changes, the guide shows a
   **Stale** badge. Works on phone screens.

**To set it up (once):**

1. Supabase → **SQL Editor** → **New query**, paste `supabase/migrations/0012_stitching_guide.sql`, press **Run**. It only
   adds new tables (the sewing library, a search cache, video start times and checklist ticks) and turns on `pgvector`.
2. Load the library: in `backend/` run `python scripts/seed_sewing_library.py` (add `--check` to only check the files).
   Run it again whenever `backend/app/knowledge/` changes. Until then the guide reads the same library from the files, so it
   works straight away; the database copy adds search by meaning.

| Key | Needed? | What it adds | Cost |
| --- | --- | --- | --- |
| none | - | The whole guide: garment reading, steps, fabric tips, checklist | free |
| `YOUTUBE_API_KEY` | for videos | A real video per step, started at its chapter | free (10,000 units a day; one new search costs 100, and a new guide makes about 20) |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` | optional | Steps worded for your design; reading a reference photo | paid, a few cents per guide |
| `GEMINI_API_KEY` | optional | Reading a reference photo (if no Anthropic key), search by meaning, and (when you tick it) an AI watching a video once to find where a step starts | embeddings free, photo and video a little paid (limited by `DAILY_BUDGET_USD`) |

## Upgrading to Phase 8

Run the new database file **once** in Supabase (after 0001–0010):

1. Supabase → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0011_themes_and_premium.sql`, copy **everything**, paste, press **Run**.
3. It should say **Success. No rows returned**. Under **Table Editor** you now see `appearance_settings` and
   `premium_members`.

Until you run it, the app still works and themes are remembered in your browser only (saving to your account shows
an error). No existing table is changed, no new keys and no new paid service.

**Try a Premium theme before payments exist** (optional, for testing; use your own sign-in email):

```sql
insert into public.premium_members (user_id, source)
select id, 'manual' from auth.users where email = 'you@example.com';
```

Remove it again with
`delete from public.premium_members where user_id = (select id from auth.users where email = 'you@example.com');`.
People can never give themselves Premium: only SQL (and later the payment system) can.

If you changed Supabase's sign-in **email templates** or the **Site name** in the Supabase dashboard
(Authentication → Emails), replace "Croquis" there with "Drapeit" by hand; those texts live in Supabase, not in this
code.

## Upgrading to Phase 6A

Run the new database file **once** in Supabase (after 0001–0005):

1. Open your project at <https://supabase.com/dashboard> → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0006_profiles_and_posts.sql` in a text editor, copy **everything**, paste it in, press **Run**.
3. It should say **Success. No rows returned**. Under **Table Editor** you now see `posts`, `post_images`,
   `post_likes`, `post_saves`, `follows` and `close_friends`.

Nothing else changes: no new keys, no new paid service. Then restart the backend.

## Upgrading to Phase 6B

Run the new database file **once** in Supabase (after 0001–0006):

1. Open your project at <https://supabase.com/dashboard> → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0007_social_features.sql` in a text editor, copy **everything**, paste it in, press **Run**.
3. It should say **Success. No rows returned**. Under **Table Editor** you now see `blocks`, `restricts`, `mutes`,
   `follow_requests`, `comments`, `comment_likes`, `reposts` and `reports`.

Run it only once. Running it a second time stops with an error such as *relation "blocks" already exists*; that is
harmless (nothing is changed), it just means it is already done. No new keys and no new paid service. Then restart
the backend (Ctrl+C, then the `uvicorn` command again; on Render it redeploys when you push).

## Upgrading to Phase 6E

Run the new database file **once** in Supabase (after 0001–0009), **before** you use the new code:

1. Supabase → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0010_onboarding_admin_verification.sql`, copy **everything**, paste, press **Run**.
3. It should say **Success. No rows returned**.

**Make yourself an admin** (once, in a new SQL query; use the email you sign in with):

```sql
insert into public.admin_users (user_id, note)
select id, 'owner' from auth.users where email = 'you@example.com';
```

Sign out and in again (or reload): **Admin** appears in the menu. To remove an admin:
`delete from public.admin_users where user_id = (select id from auth.users where email = 'you@example.com');`

No new keys and no new paid service.

## Upgrading to Phase 6D

Run the new database file **once** in Supabase (after 0001–0008), **before** you use the new code (posts, comments and
profiles need it):

1. Open your project at <https://supabase.com/dashboard> → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0009_settings_and_activity.sql` in a text editor, copy **everything**, paste it in,
   press **Run**.
3. It should say **Success. No rows returned**. Under **Table Editor** you now see `account_status`,
   `privacy_settings`, `search_history`, `time_spent` and `problem_reports`.

Optional settings (no new paid service):
- `NEXT_PUBLIC_SUPPORT_EMAIL` (frontend) shows a support address on the Help page; without it, people use "Report a
  problem".
- `PURGE_INTERVAL_HOURS` (backend, default 6) is how often posts and accounts past their 30 days are removed for good.
- Supabase → **Authentication → Email**: keep **Secure email change** on, so changing the email asks both addresses.

Read problem reports in Supabase → **Table Editor** → `problem_reports` (screenshots are in Storage under
`problem-reports/`).

## Upgrading to Phase 6C

Run the new database file **once** in Supabase (after 0001–0007), **before** you use the new code (the profile page
and the menu numbers need it):

1. Open your project at <https://supabase.com/dashboard> → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0008_chats_and_notifications.sql` in a text editor, copy **everything**, paste it in,
   press **Run**.
3. It should say **Success. No rows returned**. Under **Table Editor** you now see `conversations`,
   `conversation_members`, `messages`, `notifications` and `notification_settings`.

Live updates (Supabase Realtime) need nothing else: the file already adds the rule that lets each person listen only to
their own private channel. Optional, for extra safety: open **Realtime → Settings** and turn **off** "Allow public
access", so only private channels can be used. If Realtime is ever unavailable the app still works: it checks for new
messages every few seconds instead.

No new keys and no new paid service. Then restart the backend.

## Known limitations (Phase 8)

- Premium cannot be bought yet; Premium themes and custom themes are locked for everyone without a
  `premium_members` row. If Premium ends, a saved Premium theme falls back to the device's light / dark.
- The profile theme colours the profile page itself; the menu around it keeps the visitor's own app theme.
- Theme names and descriptions are in English in every language; the rest of the Theme page is translated.
- Fabric swatches, sketch canvases and drawing colours show real design colours, so they do not change with the theme.
  The tailor sheet always shows on ivory paper (it is a printable document).
- Database names (the `croquis_app` role, the test database) and storage keys still say "croquis"; they are code
  identifiers and were left alone on purpose.

## Known limitations (Phase 6E)

- Admins are added and removed only with SQL (no "invite admin" page), on purpose.
- A suspended person can still sign in, read, like, follow and edit their profile; they cannot publish, comment,
  repost or message. Their existing posts stay visible unless an admin removes them.
- Warnings and decisions are shown in the app only (no email).
- Onboarding suggestions come from roles and post tags; the "styles" interests are saved but not used yet.
- The verified badge can also come from a future Premium plan (`verified_accounts.source = 'premium'`); nothing sets
  that yet.

## Known limitations (Phase 6D)

- Language: the menu, Settings, Help and common buttons are translated; most other pages are still English. The
  choice is remembered in this browser only.
- "Download your data" is one JSON file; pictures are listed but not included.
- Time spent counts minutes while the app is open and visible (a ping each minute), not exact screen time.
- Recently deleted covers posts only; deleting a design is still permanent (it asks first).
- Deleting an account for good needs the backend to be running at some point after the 30 days (it checks at start-up
  and every `PURGE_INTERVAL_HOURS`).
- Legal pages are drafts and must be reviewed by a lawyer before a public launch.

## Known limitations (Phase 6C)

- Chats are 1-to-1: text, shared posts and design pictures. No group chats, voice notes, typing dots, editing or
  reactions. Unsend removes a message for both people.
- The inbox shows your 100 most recent chats; a chat loads 40 messages at a time ("Load older messages").
- Notifications are in the app only (no email or phone push). Opening a message request does not show "Seen" to the
  sender until you accept it.
- Deleting a whole account does not yet remove its copied chat pictures from Storage (the database rows go).

## Known limitations (Phase 6B)

- Reports are only saved (table `reports`); there is no admin page yet. Read them in Supabase → **Table Editor** →
  `reports`.
- Comments show the first 500 on a post, oldest first, with no editing (delete and write again).
- Only Public posts from public accounts can be reposted. If the designer later makes the post private or their
  account private, the repost disappears for people who can no longer see the original.
- Trending is one list of up to 24 posts (no "Load more"). Explore and search look at captions and tags only
  (simple text matching, no spelling help). Your own posts appear in Explore too.
- Mute hides posts from your feed and Explore only; you can still open a muted person's profile and posts.
- A private account's post count shows only the posts *you* can see (0 if you do not follow).
- Tested on a real local PostgreSQL with the same migrations and in headless Chrome against a local test stack, not
  yet on a real Supabase project.

## Known limitations (Phase 6A)

- "Public" means every **signed-in** user of the app; people who are not signed in cannot see posts yet.
- A published post needs at least one sketch or generated picture. Uploaded reference photos cannot be published
  (they may show a client).
- A post keeps its own copy of the pictures, so it stays even if the design is deleted, and later changes to the
  design do not change the post (edit the post to pick pictures again).
- Not yet tested against a real Supabase project; tested on a real local PostgreSQL with the same migrations.

## Known limitations (Phase 5)

- The app needs a Supabase project, even on your own computer (your choice in Phase 5); it no longer runs offline.
- Not yet tested against a real Supabase, Render or Vercel account (none exists yet). The code is tested on a real
  local PostgreSQL with the same migrations, with Supabase's Storage and sign-in keys simulated. The first real
  deployment is the first live test: tell me exactly what any message says.
- Supabase's built-in email only reaches your own team; connect SMTP before inviting customers (DEPLOYMENT.md).
- Rate limits are kept in the server's memory (fine for one Render instance).
- The Dockerfile has not been built on this computer (Docker is not installed here); Render builds it.

- Tutorial reasons ("Title mentions …") are worked out from each video's own title and description, not from watching it. Watch a video before relying on it.
- Without an Anthropic key, variations, moodboards and embroidery concepts come from small built-in tables (labelled MOCK).
- Pattern assistance is conceptual only: it names measurements and relationships (such as "bust ÷ 4 plus ease") but never gives cutting dimensions, ease or seam allowance. The cutting layout is not to scale.
- The moodboard does not generate new pictures; it places your project's existing pictures on the board.
- Embroidery placement diagrams are simple front/back outlines, the same for every garment.
- No video generation provider: Instructional Video is a storyboard and script.

- Without keys, AI is mocked: the "Design" generator matches keywords; sketches are simple SVG outlines; fabrics come from a 19-row table with simple scoring rules. All are labelled MOCK.
- No fabric prices are shown anywhere unless you type them into Cost Estimate. "Relative cost" in Fabric Studio only compares the listed fabrics with each other.
- The cost estimate is only as good as the prices you enter. Fabric lengths must come from your tailor; the app never calculates them.
- The PDF uses a system font (Arial on Windows, DejaVu Sans on Linux). English text, ₹ and common symbols print correctly; Hindi (Devanagari) text may not print correctly yet.
- Mock SVG sketches cannot be drawn inside the PDF (a short note appears instead). Uploaded photos and real AI images (PNG/JPEG/WebP) are printed.
- Checklist ticks are saved in your browser only, not in the project.
- The real providers are tested with fake API clients only. The first run with your real keys is the first live test, so tell me exactly what any error says.
- Generated images are pictures, not editable vector drawings. AI images can get small details wrong (for example the number of buttons); the design spec is the source of truth.
- Spending is an estimate from token counts and published prices; the provider's billing page is the final word.
- Phases 1–4 kept data in `backend/data/` (SQLite + pictures). Phase 5 does not use it; copy it to Supabase once with `scripts/import_sqlite.py`.
- Upgrading to Phase 4: the database is upgraded automatically (version 3: usage rows now say whether a call was paid, so free services such as YouTube search and built-in code no longer count as paid calls). Nothing is deleted. No database change was needed for Phase 3. Older designs and outputs keep working; regenerate a fabric, checklist or tailor sheet to see the new details. After pulling Phase 3, run `pip install -r requirements.txt` once (it adds the free `reportlab` PDF library).

## Security notes

See **[docs/SECURITY.md](docs/SECURITY.md)** for the full review. In short:

- Secret keys (database, Supabase secret key, AI keys) live only in the backend's environment (`backend/.env`
  locally, Render's Environment page when deployed). The website only gets `NEXT_PUBLIC_` values, which are public.
- Every request needs a signed-in user; each user only ever reaches their own designs and pictures.
- Posts: the database itself decides who may see each post (Public / Followers / Close Friends / Private).
  Publishing copies only an allowlist (chosen pictures, palette, fabric names, caption, tags); never measurements,
  budget, notes or the design title.
- Blocks, private accounts and restricted comments are also enforced by the database (migration 0007), not only
  by the code. Block / restrict / mute lists and reports are only visible to the person who made them.
- Uploads are checked by their first bytes (PNG/JPEG/WebP), size-limited, rate-limited per user, and stored privately.
- A chat app subscription does **not** give this app API access. The Anthropic API needs its own account and billing at <https://console.anthropic.com>.
