# Drapeit by Vistas Atelier

*Drape it. Share it.*

Drapeit is a web app for tailors, boutique owners, designers, students and anyone with a clothing idea. It takes you
from an idea to a design a tailor can actually make:

**Idea → Design concept → Sketch → Fabric → Materials → Tailor sheet → Stitching steps**

## What you can do

- **Design notebook:** write your idea, then generate a design concept, sketches, fabric suggestions, a tools and
  materials checklist, a tailor sheet (PDF) and a cost estimate. Every result belongs to a version of your design.
- **Stitching Guide:** step-by-step stitching in the order a tailor works, with a tutorial video for each step and a
  checklist you tick off as you sew.
- **Tools:** Design Studio (draw and trace sketches), Fabric Studio, Tailor Workspace (measurements and notes),
  Cost Estimate, My Designs and a Learning Library of real YouTube tutorials.
- **Share:** publish designs on your profile, follow people, a home feed, explore, comments, chats and notifications,
  with privacy controls (Public, Followers, Close Friends, Private).

Without any API key everything works for free, with results clearly labelled **MOCK**. Real AI and real tutorial
videos switch on when you add keys (see [Optional keys](#optional-keys)).

## How to use it

1. Open the website, create an account with your email and sign in.
2. On the dashboard, name your design, write your idea in your own words and press **Create and open notebook**.
3. In the notebook press **Generate** next to *Design*, read the concept and press **Use this as the design spec**.
   Then generate the sketch, fabric suggestions and tools and materials, or press **Generate complete design package**.
4. Changed the design (for example the neckline)? Results that no longer match are marked **Out of date**. Press
   **Update** on just those.
5. **Design Studio:** draw, or place a generated sketch as a layer and draw over it.
6. **Fabric Studio:** compare fabrics and save the one you like to the design.
7. **Tailor Workspace:** add measurements and notes, then generate the **tailor sheet** and download it as a PDF.
8. **Cost Estimate:** type your real prices and it adds everything up.
9. **Stitching Guide:** press **Generate** next to *Stitching Guide*. Follow the steps in order, watch the video for each
   step, and tick steps off. The guide shows **Stale** if you change the design afterwards.
10. **Publish** a design to share it, and choose who can see it.

## Run it on your computer

You need Node.js 20+, Python 3.11+ and a free [Supabase](https://supabase.com) project (database and sign-in). Create the
project once by following steps 2 and 3 of [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), which also explains putting the
app online.

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate               # Windows. macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env               # macOS / Linux: cp .env.example .env, then fill it in
uvicorn app.main:build --factory --reload --port 8000
```

**Website** (terminal 2):

```bash
cd frontend
npm install
copy .env.example .env.local         # macOS / Linux: cp, then fill in the two Supabase values
npm run dev
```

Open <http://localhost:3000>. Or run both with Docker: fill in the two settings files as above, then
`docker compose up --build`.

**Stitching Guide, one-time setup:** in Supabase open **SQL Editor → New query**, paste
`supabase/migrations/0012_stitching_guide.sql` and press **Run**. Then run `python scripts/seed_sewing_library.py`
inside `backend/`.

## Optional keys

Put keys in `backend/.env`, then restart the backend. **AI Providers** in the app shows what is switched on. Never share a
key or put it on GitHub; `.env` is not uploaded.

| Key | What it adds | Cost |
| --- | --- | --- |
| none | everything, with MOCK placeholders instead of real AI | free |
| `YOUTUBE_API_KEY` ([Google Cloud](https://console.cloud.google.com), enable *YouTube Data API v3*) | real tutorial videos in the Stitching Guide, Tutorials and Learning Library | free (about 100 searches a day) |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` ([console.anthropic.com](https://console.anthropic.com)) | real AI design plans, fabric and materials lists, reading a reference photo, stitching steps worded for your design | paid per use |
| `GEMINI_API_KEY` ([aistudio.google.com](https://aistudio.google.com)) | real sketches and previews, and reading a reference photo | paid per use |
| `OPENAI_API_KEY` ([platform.openai.com](https://platform.openai.com)) | real sketches and previews (alternative to Gemini) | paid per use |

A chat subscription (ChatGPT Plus and so on) does not work as a key: these need a separate API account with billing.
A full design package costs roughly ₹20–35. `DAILY_BUDGET_USD` (default `1.0`) stops paid AI for the day once that
estimated amount is spent.
