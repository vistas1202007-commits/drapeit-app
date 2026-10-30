# Personalized stitching video guides

The existing video action now uses the same garment-specific construction pipeline as
stitching_guide. It produces instructions with existing technique demonstrations and retains
a filming storyboard. It does not synthesize needlework footage or claim to show the user's
exact garment being sewn.

## Construction decisions and grounding

A saved design can include optional construction choices: bodice shaping, neckline finish,
closure type and position, woven/knit construction, fabric weight and seam finish.
Old specs default to empty choices and old saved outputs remain readable.

The parser labels decisions as specified, observed, proposed or unknown. Proposed and unknown
choices produce a visible draft review form. Confirming creates a new design version; Update
regenerates the guide. Confirmed closure choices also update the spec's closure list, so the
materials and tailor tools do not keep a contradictory old zipper. A generic "back zip" does
not establish whether it is an invisible or lapped zip.

Technique modules remain original application content. An optional LLM explains why a module
applies; its output cannot replace source instructions, tips, machine settings or operation
order. This is not a claim that the source library has been professionally reviewed.

A versioned dependency graph orders operations, using phase/order only as a stable tie breaker.
It distinguishes closed-armhole set-in sleeves from sleeves sewn flat and includes skirt side
seams. Each step exposes prerequisites, its garment piece and the source module hash. Unknown
garments no longer silently become dresses. The selected sewing pattern still controls details
not represented by these modules. This is a technique guide, not a fitted cutting pattern.

Knits have their own needle and stretch-seam guidance; silk jersey does not inherit woven-silk
needle advice. Numeric settings remain source-library starting points to test on actual fabric.

## Video evidence

The application distinguishes:

- **candidate**: search metadata only; visibly unverified;
- **chapter**: title-matched chapter boundaries, not visual verification;
- **indexed**: a video-understanding provider identified the technique and its times;
- **reviewed**: a curator-approved catalog record with reviewer, date, rights and entry/exit states.

A negative indexed result removes the candidate, including on subsequent requests. Checks are
stored per video id, technique slug and technique revision, so checking one technique never
prevents checking another. New checks preserve results for other techniques. Invalid or
out-of-range segments are rejected. AI indexing is not human tailoring review.

Reviewed clips take priority over live search and work without a YouTube key. Exact compatibility
filters check the technique revision, language, garment family, fabric construction/class/weight,
feature inclusions/exclusions, confirmed choices and prerequisite operations before selection.
A generic demonstration still needs to be applied to the user's pattern and garment pieces.

YouTube sources use the official embedded player. Hosted HTTPS footage must be owned or licensed.
The hosted player starts at the segment start, prevents seeking before it and pauses at the end.
No YouTube footage is downloaded, spliced or re-hosted by this implementation.

## Deploy without disrupting existing installations

1. Run supabase/migrations/0013_verified_sewing_media.sql after 0012. It adds two server-only tables;
   it does not rewrite projects, saved jobs, old video caches or checklist ticks.
2. Re-run python scripts/seed_sewing_library.py --no-embeddings inside backend to update the source
   modules and add the knit card. Refresh embeddings separately if configured and desired.
3. Deploy backend and frontend together. Old output fields and the video generator id are retained.
4. Import reviewed media when real footage is ready. The shipped catalog is intentionally empty.

Before 0013, source-backed guides, existing tutorial searches/chapters, old positive caches and
checklists still work. The new catalog is unavailable and fresh paid indexing explains the missing
migration. Reverting the app commits leaves the additive tables harmlessly unused.

Construction changes mark materials, tailor sheets and both guide actions out of date. Unrelated
sketches are not invalidated by a construction-only confirmation.

## Curate and pre-index outside user requests

From backend:

~~~bash
python scripts/sewing_media.py revisions
python scripts/sewing_media.py check sewing-media.example.json
python scripts/sewing_media.py import /path/to/reviewed-manifest.json
python scripts/sewing_media.py index /path/to/index-manifest.json --allow-paid --limit 3
~~~

The check and revisions commands require no credentials or network. Import uses the privileged
database connection. Index is a bounded, resumable worker command, suitable for an existing task
scheduler or a separate worker process. It requires configured video understanding and explicit
--allow-paid. It reuses positive and negative checks, respects the configured estimated daily
budget, and records usage including failed calls. It does not approve footage. No scheduler or
credentials are installed by this PR. Web-request indexing remains opt-in and bounded.

The JSON manifest has clips and index_requests arrays. An index request names a public YouTube
video_id, its curator-checked duration_seconds (at most 1800), and module_slugs. A clip contains:
id, module_slug, current module_revision from the revisions command, title, source, source_url,
segment start/end, language, compatibility filters, entry/exit states, review state, reviewer/date
and rights provenance. YouTube clips use video_id and rights "youtube_embed"; hosted clips use
media_url and rights "owned" or "licensed". Drafts cannot be selected. Approved records require a
timezone-aware review date, reviewer, rights note and both construction states. Never invent
reviewer names or approve clips automatically from model output.

Use original or licensed knowledge sources and footage. Reference documentation:

- [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [Gemini video understanding and sampling limitations](https://ai.google.dev/gemini-api/docs/video-understanding)
- [SCHMETZ fabric and needle guidance](https://www.schmetzneedles.com/pages/needles-by-fabric-type)
- [Example construction-method dependencies](https://www.seamwork.com/sewing-tutorials/sewing-all-in-one-facings)

## Validation and remaining work

Backend tests use real temporary PostgreSQL with real migrations and fake sign-in, storage,
YouTube and AI providers. They cover old installations, versioning, ordering, negative evidence,
new techniques/revisions, catalog compatibility, worker limits, budgets and table permissions.

Frontend unit tests, type generation/typechecking, lint and production build exercise the existing
application. Offline Playwright tests render actual guide/player components and styles on desktop
and mobile, with fake project APIs, persistence, confirmation and legacy output fixtures.
A tiny original blank WebM tests actual native decoding, start bounds, seeking and end-of-segment
pause. It is test media only, not a sewing demonstration. It was generated with FFmpeg from a
white 320x180 color source at 2 FPS for 40 seconds, VP9/yuv420p with a four-frame keyframe interval, without audio. The fixture transport supports HTTP byte ranges, like a media host.

~~~bash
cd frontend
CHROMIUM_PATH=/path/to/chromium npm run test:stitching-browser
~~~

Without CHROMIUM_PATH, first install Playwright Chromium. Regenerate fixtures from the repository root:

~~~bash
backend/.venv/bin/python backend/scripts/generate_stitching_fixtures.py
~~~

These checks do not establish live-provider timestamp accuracy, production Supabase deployment,
codec/CDN behavior, or successful garment construction. A tailor must review complete guides and
real clips before production claims. Start with a small supported pattern set and measure missing
operations, ordering errors, compatible clip coverage and unusable timestamp ranges. Estimated
provider budgets are not atomic reservations across simultaneous worker processes.
