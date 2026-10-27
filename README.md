# Drapeit by Vistas Atelier

*Drape it. Share it.* *(code name: AI Fashion Design Notebook; the old app name "Croquis" still appears in code
identifiers such as the `croquis_app` database role, which were not renamed on purpose)*

A web app that helps tailors, boutique owners, designers, students and anyone with a clothing idea go from

**Idea → Design concept → Sketch → Fabric → Materials → Tailor-ready sheet**

## What it does

- **Design notebook:** write an idea, then generate a design concept, sketches, fabric suggestions, a tools and
  materials checklist, a tailor sheet (PDF), a cost estimate and more. Every result belongs to a design version.
- **Stitching Guide:** step-by-step stitching with a tutorial video for each step (see [Stitching Guide](#stitching-guide)).
- **Studios and tools:** Design Studio (drawing), Fabric Studio, Tailor Workspace, My Designs and a Learning Library
  with real YouTube tutorials.
- **Community:** profiles, publishing, home feed, explore, follow, comments, chats and notifications, with privacy and
  safety controls.
- **Account:** settings, themes, onboarding and an admin panel.

Without API keys everything works for free with clearly labelled **MOCK** placeholders. Real AI (Anthropic, Gemini,
OpenAI) and YouTube tutorial search switch on when you add their keys.

## Requirements

- **Node.js 20 or newer** (we developed on Node 22) – <https://nodejs.org>
- **Python 3.11 or newer** (we developed on 3.13) – <https://python.org>
- Git

Check with `node -v`, `python --version` (or `python3 --version`).

## Run it locally (two terminals)

The app has two parts that run at the same time: the **backend** (Python, port 8000) and the **frontend**
(website, port 3000). Both need a **Supabase project** (free): create one first by following
steps 2 and 3 of [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). You only do that once.

### Terminal 1 – backend

```bash
cd backend
python -m venv .venv                 # creates a private Python folder for this project (first time only)

# activate it (do this every time you open a new terminal)
source .venv/bin/activate            # macOS / Linux
.venv\Scripts\activate               # Windows (PowerShell or cmd)

pip install -r requirements.txt      # first time, and again after updating
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

## Try it

1. On the dashboard, name a design and write your idea in your own words.
2. In the notebook press **Generate** next to *Design*, or **Generate complete design package**.
3. Try the other generators, Design Studio, Fabric Studio and Tailor Workspace.

## Browser tests (Playwright)

`frontend/e2e/` clicks through every flow in Chrome on a desktop and a phone-sized screen with three throw-away
accounts (made and deleted by `backend/scripts/qa_users.py`). With the backend and website running:
`cd frontend`, then `npm run e2e`, and `npm run e2e:cleanup` to delete the accounts. Details in
[frontend/e2e/README.md](frontend/e2e/README.md); the latest results are in [docs/AUDIT.md](docs/AUDIT.md).

## Turn on real AI

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

## Turn on tutorial search

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

**Generate Stitching Guide** (Notebook → Generate) writes step-by-step stitching instructions for a design, in the
order a tailor works, with a tutorial video for each step. Steps can be ticked off (saved per design version), and the
guide shows **Stale** when the design changes.

Set it up once:

1. Supabase → **SQL Editor** → **New query**, paste `supabase/migrations/0012_stitching_guide.sql`, press **Run**.
2. In `backend/` run `python scripts/seed_sewing_library.py`.

It works without any key (free; each step then links to a YouTube search instead of a video). `YOUTUBE_API_KEY` (free)
adds real videos. The optional paid keys `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` add reading a reference photo and,
with Anthropic, steps worded for your design. How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
