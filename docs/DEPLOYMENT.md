# Deploying Drapeit by Vistas Atelier

This guide takes you from nothing to a live website, one step at a time:

* **Supabase**: database, sign-in and picture storage
* **Render**: runs the Python backend (FastAPI)
* **Vercel**: runs the website (Next.js)

You also need a free **GitHub** account: Render and Vercel deploy straight from a GitHub repository.

> Nothing here is done automatically. Each step below is something you click or paste yourself.

---

## 0. What it costs (check the pricing pages before you sign up; prices change)

| Service | Free plan | When you pay |
| --- | --- | --- |
| **Supabase** | $0: 500 MB database, 1 GB files, 50,000 monthly users. A free project **pauses after about a week with no visits** (you press "Restore" to wake it). No automatic backups. | Pro **$25/month**: no pausing, daily backups, more space. |
| **Render** (backend) | $0: the server **sleeps after 15 minutes** without visits; the next visit waits about a minute while it wakes. | Starter **about $7/month**: always on. |
| **Vercel** (website) | Hobby $0, but **only for personal, non-commercial use**. A boutique selling to customers is commercial. | Pro **$20/month** per team member. |
| **Sign-up emails** | Supabase's built-in email only sends to your own team's addresses, with a very low hourly limit. Fine for testing. | For real customers, connect an email service (Resend's free plan is about 3,000 emails/month; Brevo's is about 300/day). |
| **AI keys** | Same as before: pay per use, with the daily limit (`DAILY_BUDGET_USD`). | |
| **Domain** (optional) | Vercel gives you `your-app.vercel.app` free. | About ₹800–1,500 a year for your own `.com`/`.in`. |

**Trying it out:** $0 (all free plans).
**Running it for a real business:** about **$27–52 a month** (Vercel Pro + Render Starter, plus Supabase Pro once you have real customer data and want backups).

---

## 1. Put the code on GitHub (private)

1. Create a free account at <https://github.com> and a **private** repository, for example `drapeit`.
2. Upload this project to it (GitHub Desktop is the easiest: *File → Add local repository*, then *Publish*).
   The `.gitignore` file already keeps secrets (`.env`, `.env.local`) and local data out.
3. Before publishing, check that **no** `.env` or `.env.local` file is listed in GitHub Desktop.

---

## 2. Create the Supabase project

1. Go to <https://supabase.com>, sign up, then **New project**.
   * Name: `croquis`. Region: **South Asia (Mumbai)** if your users are in India.
   * Choose a strong **database password** and save it in your password manager. You need it in step 4.
2. Wait until the project is ready (about 2 minutes).
3. **Create the tables.** Open **SQL Editor → New query**. For each file in `supabase/migrations/`, **in order**
   (`0001`, `0002`, `0003`, `0004`, `0005`, `0006`, `0007`, `0008`, `0009`, `0010`, `0011`, `0012`, `0013`): open the file in a text editor, copy everything, paste it into the
   SQL editor and press **Run**. Each should say "Success".
   * `0004` locks the tables so only the backend can reach them, and turns on per-user rules.
   * `0005` creates the private picture bucket `project-assets`. Check it under **Storage**.
   * `0006` adds profiles, posts, likes, saves, follows and close friends, with the rules for who sees each post.
   * `0007` adds private accounts, follow requests, comments, reposts, block / restrict / mute and reports, with the
     database rules for each.
   * `0008` adds chats (messages, message requests, "Seen"), notifications and notification settings, and the rule
     that lets each signed-in person listen only to their own private Realtime channel (live updates).
   * `0009` adds account status (deactivate / delete), extra privacy settings, search history, time spent, problem
     reports and "Recently deleted" for posts.
   * `0010` adds onboarding, the admin tables (admins, action log, suspensions, warnings) and verified badges.
     Then make yourself an admin:

     ```sql
     insert into public.admin_users (user_id, note)
     select id, 'owner' from auth.users where email = 'you@example.com';
     ```
   * `0013` adds reviewed clips and per-technique video checks; see [the rollout guide](STITCHING_PIPELINE.md).
   * `0012` adds the Stitching Guide: the sewing library, a cache of tutorial searches, video start times and
     checklist ticks (and turns on `pgvector` for search by meaning). After it, run
     `python scripts/seed_sewing_library.py` once from `backend/` to load the library.
   * `0011` adds themes (app theme, profile theme, custom theme) and the Premium flag (`premium_members`, which
     people can never set themselves).
4. **Sign-in settings.** Open **Authentication → Sign In / Providers → Email**: keep *Email* on and
   *Confirm email* on. Under **Authentication → URL Configuration**:
   * **Site URL**: `http://localhost:3000` for now (you change it in step 6).
   * **Redirect URLs**: add **`http://localhost:3000/**`** (the `/**` allows every page, including
     `/reset-password`, where the "Forgot password?" email sends people). Later also add your Vercel address the same way.
   * If `/reset-password` is not allowed here, Supabase sends people to the Site URL instead; the app then moves
     them to `/reset-password` itself, but adding it here is the reliable way.
5. **Collect these values** (keep them private, except the publishable key):

| Where in Supabase | What it is | Goes into |
| --- | --- | --- |
| Project Settings → API → **Project URL** | `https://xxxx.supabase.co` | `SUPABASE_URL` (backend) and `NEXT_PUBLIC_SUPABASE_URL` (website) |
| Project Settings → API Keys → **publishable** key (`sb_publishable_…`), or legacy **anon** key | safe in the browser | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (website only) |
| Project Settings → API Keys → **secret** key (`sb_secret_…`), or legacy **service_role** key | **secret**: full access to files | `SUPABASE_SECRET_KEY` (backend only) |
| **Connect** (top bar) → **Session pooler** connection string, with your database password filled in | **secret** | `DATABASE_URL` (backend only) |
| Project Settings → JWT Keys → *Legacy JWT secret* (**only** if your project still uses it) | **secret** | `SUPABASE_JWT_SECRET` (backend only) |

> Use the **Session pooler** string, not "Direct connection": the direct one needs IPv6, which Render does not have.
> New Supabase projects sign logins with *signing keys*, which the backend reads automatically. You only need
> `SUPABASE_JWT_SECRET` if the dashboard says the project still uses the legacy JWT secret.

---

## 3. Run it on your computer (optional, but a good first test)

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            # macOS/Linux: cp .env.example .env
```

Open `backend/.env` and fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `MEDIA_TOKEN_SECRET`
(make one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`). Then:

```bash
uvicorn app.main:build --factory --reload --port 8000
```

If something is missing, the backend stops and lists exactly which setting to fill in.
<http://localhost:8000/api/health/ready> should say `{"status":"ok"}`.

**Website** (terminal 2):

```bash
cd frontend
npm install
copy .env.example .env.local      # macOS/Linux: cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `frontend/.env.local`, then:

```bash
npm run dev
```

Open <http://localhost:3000>, press **Create an account**, open the confirmation email, then sign in.

**Bring your old designs across (once).** Your Phase 1–4 designs are in `backend/data/notebook.sqlite3`.
After you have signed up, with the backend's `.env` filled in:

```bash
cd backend
python scripts/import_sqlite.py --email you@example.com
```

It copies every project, version, note, output, drawing and picture to your account. Running it again skips
projects that are already there. The old file is not changed.

---

## 4. Deploy the backend on Render

1. Sign up at <https://render.com> (you can use your GitHub account).
2. **New → Blueprint**, pick your GitHub repository. Render reads `render.yaml` and shows a service called
   `croquis-backend` (Docker, region Singapore, **free** plan).
3. Render asks for the secret values. Fill in:
   * `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (and `SUPABASE_JWT_SECRET` only if needed)
   * `FRONTEND_ORIGIN`: put `http://localhost:3000` for now; you change it in step 6.
   * AI keys (`ANTHROPIC_API_KEY` with `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `YOUTUBE_API_KEY`): leave empty for the free mocks.
   * `MEDIA_TOKEN_SECRET` is generated by Render automatically.
4. Press **Apply**. The first build takes a few minutes.
5. When it is live, open `https://croquis-backend-XXXX.onrender.com/api/health/ready` (your address is at the top
   of the service page). It should say `{"status":"ok"}`. Copy the address.

> **Always on:** in the service's *Settings → Instance type*, change *Free* to *Starter* (about $7/month).

---

## 5. Deploy the website on Vercel

1. Sign up at <https://vercel.com> with GitHub. **Add New → Project**, import your repository.
2. **Root Directory**: `frontend`. Framework: Next.js (detected).
3. **Environment Variables**:
   * `NEXT_PUBLIC_API_URL` = your Render address from step 4 (no `/` at the end)
   * `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable (or anon) key
   * **Never** add the secret key, the database URL or AI keys here.
4. **Deploy**. Copy the address, e.g. `https://drapeit.vercel.app`.

---

## 6. Connect the pieces

1. **Render** → your service → **Environment** → set `FRONTEND_ORIGIN` to your Vercel address
   (e.g. `https://drapeit.vercel.app`; several addresses can be separated with commas) → **Save** (it redeploys).
2. **Supabase** → Authentication → URL Configuration:
   * **Site URL**: your Vercel address.
   * **Redirect URLs**: add `https://your-app.vercel.app/**` (keep `http://localhost:3000/**` if you still develop locally).
3. (For real customers) **Supabase → Authentication → Emails → SMTP Settings**: connect an email service so
   confirmation and password-reset emails reach everyone, not just your team.

---

## 7. Check that it works

On your phone **and** a computer:

- [ ] The site shows the sign-in screen. Create an account, confirm the email, sign in.
- [ ] Sign out, press **Forgot password?**, open the email, choose a new password, sign in with it.
- [ ] Create a design, generate a design concept, use it, generate a sketch: the sketch picture shows.
- [ ] Upload a reference picture; it shows in References.
- [ ] Tailor Workspace: add a measurement, generate the sheet, **Download PDF**.
- [ ] Sign out, create a **second** account: it sees **no** designs of the first account.
- [ ] AI Providers page shows the services; with no keys, "Demo mode".

If the backend was asleep (free plan), the first click can take about a minute; the site shows a message and
recovers by itself.

---

## Updating later

* Push new code to GitHub. Vercel deploys the website automatically.
* Render: `render.yaml` has `autoDeploy: false`, so press **Manual Deploy → Deploy latest commit** when you are ready.
* Database changes come as new files in `supabase/migrations/`: run only the new ones, in order, in the SQL editor.
  Phase 6A added `0006_profiles_and_posts.sql`: run it once (SQL Editor → New query → paste the whole file → Run).
  Phase 6B added `0007_social_features.sql`: run it once the same way, after 0006.
  Phase 6C added `0008_chats_and_notifications.sql`: run it once the same way, after 0007, before deploying the code.
  Optional: Realtime → Settings → turn off "Allow public access" (the app only uses private channels).
  Phase 6D added `0009_settings_and_activity.sql`: run it once the same way, after 0008, before deploying the code.
  Optional new settings: `PURGE_INTERVAL_HOURS` (backend, default 6) and `NEXT_PUBLIC_SUPPORT_EMAIL` (frontend).
  Phase 6E added `0010_onboarding_admin_verification.sql`: run it once after 0009, then add yourself to `admin_users`
  (see README "Upgrading to Phase 6E").
  Phase 8 added `0011_themes_and_premium.sql`: run it once after 0010, before deploying the code (see README
  "Upgrading to Phase 8"). If you edited Supabase's email templates, change "Croquis" to "Drapeit" there by hand.

## When something goes wrong

| You see | What to do |
| --- | --- |
| Backend log: "The backend is not configured yet" | Fill in the settings it lists (Render → Environment), then redeploy. |
| `/api/health/ready` says "database unreachable" | Check `DATABASE_URL` (Session pooler string, right password). Is the Supabase project paused? Restore it. |
| Website: "Setup needed" | Add the `NEXT_PUBLIC_…` variables in Vercel, then redeploy. |
| Website: "Cannot reach the server" | Check `NEXT_PUBLIC_API_URL` in Vercel. On the free plan, wait a minute for the backend to wake. |
| Browser console: "blocked by CORS policy" | `FRONTEND_ORIGIN` on Render must exactly match the website address (https, no `/` at the end). |
| "Your sign-in is not valid for this app" | `SUPABASE_URL` on Render must be the same project as on Vercel. If the project uses the legacy JWT secret, set `SUPABASE_JWT_SECRET`. |
| Pictures do not load / "File storage could not upload" | Run `0005_storage_bucket.sql`; check `SUPABASE_SECRET_KEY` on Render. |
| Confirmation email never arrives | Set up SMTP (step 6.3), or confirm the user by hand in Supabase → Authentication → Users. |

## Running the backend tests

The tests use a real, temporary PostgreSQL with the same migrations.

```bash
cd backend
pip install -r requirements-dev.txt
python scripts/get_test_postgres.py      # Windows, one time: downloads PostgreSQL 16 programs (~13 MB) into backend/.pgtest
python -m pytest
```

On Linux/macOS, install PostgreSQL and set `PG_BIN` to its `bin` folder, or set `TEST_DATABASE_URL` to an
**empty** test server (the tests create and wipe a `croquis_test` database there). Never point it at Supabase.
