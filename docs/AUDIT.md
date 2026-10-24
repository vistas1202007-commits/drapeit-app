# Drapeit QA audit

**Date:** 2026-10-24 · **Build:** production build (`npm run build && npm start`) on this computer, backend with
mock AI providers, connected to the **real Supabase project** (all migrations 0001–0011 applied).
**How:** reading the code and docs, and Playwright browser tests (`frontend/e2e/`) with three throw-away accounts
(a = admin, b and c = ordinary people) on a desktop screen (1280 px) and a phone screen (390 px). The accounts and
everything they made were deleted at the end. Nothing in the app was changed.

Severity: **Critical** = blocks launch or loses data/privacy · **High** = a main flow breaks or is painful for
everyone · **Medium** = a feature is wrong or incomplete in a way people will notice · **Low** = small or rare.

---

## 1. Summary

- **Privacy and permissions hold up well.** In every check, one person could not read, change, export or delete
  another person's designs, pictures, private / close-friends posts or chats, neither through the API nor directly
  through Supabase (tables and Storage). Visibility rules (Public, Followers, Close Friends, Private), private
  accounts, blocking, restricting, muting, hidden words and admin-only pages all behaved correctly.
- **Almost every flow works end to end:** onboarding, profile and picture, the design notebook with all 13
  generators, studio, fabric, tailor sheet with PDF, cost estimate, publishing, likes / comments / replies / saves /
  reposts / share, follow requests, chats (live), notifications, every settings page, and the admin panel.
- **The biggest problems are speed and a few breakages:** pages take 5–14 seconds, publishing about 40 seconds;
  the notebook page can crash when two generators run close together; the profile "⋯" menu is partly hidden so
  "Report account" cannot be clicked; new people can see a stale "finish setting up" banner; and most pages are not
  translated.
- **Before inviting customers:** sign-up emails need your own SMTP (Supabase's built-in email only reaches your
  team), and the website should send Content-Security-Policy and HSTS headers.

---

## 2. Feature checklist

Status: **Done** · **Partly done** · **Missing** · **Broken** (works, but a bug in section 3 breaks part of it).

### Accounts, onboarding, profile

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Sign up with email + password | Partly done | Works in code; real customers need SMTP before confirmation emails arrive (BUG-03). `@example.com` addresses are refused by Supabase | `components/auth/LoginScreen.tsx` |
| Sign in / sign out | Done | | `components/auth/AuthProvider.tsx` |
| Forgot / reset password | Done (UI) | Email delivery depends on SMTP (BUG-03) | `app/forgot-password`, `app/reset-password` |
| Google / Apple / phone sign-in | Missing | | – |
| Two-factor sign-in | Missing | | – |
| Onboarding (profile, picture, interests, people, tour), skip, resume | Broken | Works, but the reminder banner keeps old state (BUG-05) | `components/onboarding/Welcome.tsx`, `components/layout/AccountBanner.tsx` |
| Edit name, username, role, bio | Done | Taken usernames refused clearly; bio limit 300 enforced; HTML in bio shown as text (safe) | `components/social/ProfileForm.tsx` |
| Profile picture upload | Done | Fake / oversized files refused with a message. No cropping | `backend/app/routers/social.py` (`/me/avatar`) |
| Links / website on profile | Missing | No field in UI, API or database | `backend/app/schemas/social.py` (`ProfileUpdate`) |
| Public profile page with grid, pinned posts, reposts tab | Done | | `components/social/ProfileView.tsx` |
| Profile theme seen by visitors | Done | | `ProfileThemeScope` in `ProfileView.tsx` |
| Verified badge + request | Done | Request → admin approve → badge shows | `components/settings/VerificationSettings.tsx` |

### Posts, feed, explore, search

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Publish a design (pictures, caption, tags, palette, fabric) | Done | Slow: about 40 s per post (BUG-02) | `components/social/PublishForm.tsx`, `routers/social.py` (`POST /posts`) |
| Visibility: Public / Followers / Close Friends / Private | Done | All four checked from two other accounts, by page and by API | `supabase/migrations/0006_profiles_and_posts.sql` |
| Drafts, edit caption, archive, pin, delete + restore | Done | Edit caption checked in the browser; draft, archive, pin, delete and restore were not clicked | `components/social/PostDetail.tsx` |
| Multiple pictures per post (carousel) | Done | | `components/social/PostCard.tsx` |
| Video posts, reels, stories | Missing | | – |
| Home feed with Load more, reposts moved up, muted hidden | Done | | `components/social/PostList.tsx` |
| Likes, saves (/saved), share link | Done | Likes are not rate-limited (BUG-13) | `routers/social.py` |
| Saved collections / folders | Missing | | – |
| Comments, replies, comment likes, delete | Done | Add, reply and like checked; delete not clicked; no editing (by design) | `components/social/Comments.tsx` |
| Mentions (@name) | Partly done | A comment with @name was saved; no separate "mentioned you" notification was seen (the post owner got "commented"); not clickable links | `components/social/Comments.tsx` |
| Hashtags | Partly done | Shown as chips but not clickable; no tag page (Explore search finds them) | `PostCard.tsx` lines ~248–256 |
| Repost with credit | Done | | `routers/social.py` (`/repost`) |
| Explore grid, filters, Trending | Done | Only public posts from public accounts appear (checked) | `components/social/Explore.tsx` |
| Search people, posts, tags; search history | Done | Two clear (×) buttons in the box (BUG-19) | `routers/community.py` (`/search`) |
| Link previews when sharing (Open Graph) / public post page for signed-out people | Missing | Every post needs sign-in; shared links show a generic preview | `app/p/[id]/page.tsx` |

### Social safety

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Follow / unfollow, follower lists, remove follower | Done | Follow and the lists checked; unfollow and remove follower not clicked | `components/social/PeopleList.tsx` |
| Private account + follow requests (accept / decline) | Done | Request + accept checked; decline not clicked | `app/requests`, `routers/social.py` |
| Close Friends list | Done | | `components/social/CloseFriends.tsx` |
| Restrict (comments wait for approval) | Done | Checked: others did not see the comment until approved | `routers/community.py` |
| Mute | Broken | Works, but "Unmute" is hidden behind the page (BUG-04) | `components/social/ProfileView.tsx`, `MoreMenu.tsx` |
| Block / unblock | Broken | Works (blocked person gets "not found"), but the menu item can be covered (BUG-04) | same |
| Report post / comment / account / message | Broken | Post report works (comment and message reports not clicked); "Report account" is hidden behind the posts grid on profiles with posts (BUG-04) | `components/social/ReportDialog.tsx` |
| Hidden words, who can comment, who can mention, who can message | Done | All checked | `components/settings/PrivacyExtras.tsx`, `components/social/PrivacySettings.tsx` |

### Chats and notifications

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| 1-to-1 chats, inbox, unread, "Seen" | Done | New messages arrive without reloading | `components/chat/ChatView.tsx`, `Inbox.tsx` |
| Message requests (people you do not follow) | Done | | `routers/chats.py` (`/accept`) |
| Send posts and design sketches, unsend | Done | Sending a post and unsend checked; sending a design sketch not clicked | `components/chat/SendDialogs.tsx` |
| Group chats, reactions, typing dots, voice notes, editing | Missing | | – |
| In-app notifications, mark all as read, per-kind settings | Done | | `components/chat/Notifications.tsx` |
| Email / phone push notifications | Missing | | – |

### Settings

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Settings home with search | Done | | `components/settings/SettingsHome.tsx` |
| Change password | Done | Checked by signing in with the new password | `components/settings/AccountSettings.tsx` |
| Change email | Partly done | Not tested (needs real email delivery, BUG-03) | same |
| Download your data | Done | Slow: about 78 s (BUG-02); pictures listed, not included | `routers/account.py` (`/me/export`) |
| Deactivate / come back by signing in | Done | Profile hidden while deactivated (checked) | `routers/account.py` |
| Delete with 30-day grace, cancel | Done | Banner "will be deleted on …" with Cancel deletion | `services/cleanup.py` |
| Your activity (time, likes, comments, recently deleted, search history) | Done | | `components/settings/ActivityView.tsx` |
| Language (English / हिन्दी / Hinglish) | Partly done | Only menu and settings are translated (BUG-07) | `lib/i18n.ts` |
| Theme: free themes, Premium locked, custom theme locked, profile theme | Broken | Works; two quick changes can undo each other (BUG-12) | `components/settings/ThemeSettings.tsx`, `storage/appearance_repository.py` |
| Help, report a problem with screenshot, legal pages | Done | Legal pages are drafts ("needs legal review") | `components/settings/HelpView.tsx` |
| AI providers page | Done | | `app/settings/ai-providers/page.tsx` |

### Admin

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Admin-only access | Done | Non-admins get no admin data (API answers 404) | `routers/admin.py` |
| Stats, reports queue (dismiss, remove, warn, suspend) | Partly done | Dismiss, warn and suspend checked; remove content not clicked. Warning closes the report, so suspending from it is no longer possible (BUG-15) | `components/admin/AdminPanel.tsx` |
| Suspensions and lift | Done | Suspended person cannot comment (403); UI still offers the comment box (BUG-16) | same |
| Problem reports with screenshot, verification queue, action log | Done | | same |

### Design tools

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Dashboard: create project, recent, search, filter | Done | | `components/project/Dashboard.tsx` |
| Notebook: ideas, references, 13 generators, complete package, spec editor, versions, out-of-date marks | Broken | All generators work; the page can crash (BUG-01); 12 s to open (BUG-02); very long on phones (BUG-09) | `components/notebook/*`, `components/outputs/*` |
| Design Studio: draw, layers, undo, save, PNG, project sketch | Done | | `components/studio/DesignStudio.tsx` |
| Fabric Studio: recommend, sort, save to design | Done | | `components/project/FabricStudio.tsx` |
| Tailor workspace: measurements, details, notes, sheet, PDF | Done | Measurement box accepts letters (BUG-17) | `components/project/TailorWorkspace.tsx` |
| Cost estimate | Done | Checked: 3 × 850 + 10% + 2500 labour = 5,305 | `components/project/CostWorkspace.tsx` |
| My Designs: search, duplicate, export JSON, delete | Done | Export takes about 25 s (BUG-02) | `components/project/MyDesigns.tsx` |
| Learning Library | Partly done | Without a YouTube key every quick search answers 503 (BUG-18) | `components/project/LibrarySearch.tsx` |

### Whole app

| Feature | Status | Notes | Where |
| --- | --- | --- | --- |
| Works on phones (390 px) | Done | No page scrolls sideways; menu opens; notebook is very long (BUG-09) | `components/layout/AppShell.tsx` |
| Loading and empty states | Done | Every empty page tested shows a friendly message | – |
| Error page when something crashes | Missing | Crashes show Next.js's plain "This page couldn't load" (BUG-06) | no `app/error.tsx` / `app/global-error.tsx` |
| Install as an app (PWA), offline | Missing | No web manifest | – |
| Speed | Broken | See BUG-02 | – |

---

## 3. Bugs

Each bug: what happens, how to see it, why (where known), and a suggested fix.

### BUG-01 · High · The notebook page crashes when generators run close together
**Steps:** open a new design → press **Generate** on Pattern Assistance, then quickly on Tools and Materials (or any
two generators within a few seconds; the complete package plus another generator also does it).
**Result:** the whole page is replaced by "This page couldn't load" with `TypeError: Cannot read properties of null
(reading 'disclaimer')` (also seen with `'videos'`). Reloading brings it back; no data is lost.
**Why:** the backend saves each new job as `running` with `output = null` first
(`backend/app/storage/repository.py` ~line 256). After every generation the website reloads the whole project
(`components/project/ProjectContext.tsx` lines 63–64), which takes 2–8 s; if another job is running at that moment,
its `running` row comes back and `components/outputs/OutputCard.tsx` (`renderOutput`, line ~122) draws it as if it
were finished. Every output view assumes `output` is filled.
**Fix:** in `OutputCard` show a "Generating…" placeholder when `job.status === "running"` or `job.output == null`,
and make each view tolerate missing fields; optionally do not return running jobs as the latest output.
**Test:** `flows/03-design.e2e.ts` → "pressing two generators quickly does not crash the notebook" (timing-dependent).

### BUG-02 · High · Everything is slow (5–14 s pages, 40 s publishing)
**Measured (this computer, India → Supabase):** first content 5–7 s on most signed-in pages, **11–14 s** on project
pages (notebook, studio, fabric, tailor, cost, publish), the "Preparing…" publish page, **~40 s per publish**, Export
JSON **~25 s**, Download your data **~78 s**, one like **~2 s**.
**Why:**
1. Every page load calls ~11 API endpoints for the shell (appearance, onboarding, account, badges ×2, profile,
   time, providers, health, media token…). See `components/layout/AppShell.tsx`, `AccountBanner.tsx`,
   `ThemeProvider.tsx`.
2. `/api/me/account` takes 4.8–8.9 s: it opens four separate database transactions (`routers/account.py` lines
   67–71: status, is_admin, suspension, warnings). Each transaction is ~5 round trips (`storage/database.py`:
   BEGIN, `SET LOCAL ROLE`, `set_config`, query, COMMIT). On the account page it is called twice.
3. One database round trip is ~200 ms and a new connection 1.6 s from here. The pool keeps only one connection
   ready (`ConnectionPool(min_size=1)`), so a page's 11 parallel calls open new connections.
4. The Supabase project is in **Seoul (ap-northeast-2)**; `render.yaml` puts the backend in **Singapore**; users are in
   India.
**Fix:** one `/api/me/bootstrap` call for the shell, cached across page changes; one transaction per request (set
role/user once); fewer queries per endpoint (`/me/account` as one SQL); pool `min_size` 4–5; look at the slow
endpoints (publish copies pictures one by one; export and download read every picture); move Supabase to Mumbai
(ap-south-1) or keep backend and database in the same region.

### BUG-03 · Critical (launch) · Sign-up confirmation emails will not reach customers
**Steps:** sign up with a new address. Supabase answered `Email address "…@example.com" is invalid` (example
domains are refused) and, after a few tries, `429 Too many attempts`.
**Why:** the project uses Supabase's built-in email, which only delivers to members of your Supabase team and has a
very low hourly limit (also noted in README "Known limitations (Phase 5)"). Password reset and change email use the
same emails.
**Fix:** connect your own SMTP (Supabase → Authentication → Emails → SMTP, e.g. Resend, Brevo, Amazon SES), raise
the rate limit, and test sign-up with a real address.

### BUG-04 · High · Profile "⋯" menu is partly hidden: "Report account" cannot be clicked
**Steps:** open someone's profile that has posts → press ⋯. The dashed divider line runs through the menu and the
posts grid covers its bottom; "Report account" is invisible and "Unmute" / "Block" can be unclickable.
**Why:** `.stitch-divider` has `opacity: 0.7` (`app/globals.css` line ~173), which gives it its own layer, and the
grid comes later in the page; the menu (`components/social/MoreMenu.tsx`, `absolute z-20`) sits inside the header
without a higher layer of its own.
**Fix:** give the profile header block `relative z-10` (or render the menu in a portal above the page). Check every
`MoreMenu` (profile, post, chat).

### BUG-05 · Medium · "Finish setting up your account" banner after finishing onboarding; Skip can bounce back
**Steps:** brand-new account → taken to /welcome → finish (or press Skip). Back on the dashboard the banner still
says "Finish setting up your account" until a full reload. If /welcome is the first page opened in the tab, finishing
or skipping sends the person straight back to /welcome.
**Why:** `OnboardingStrip` in `components/layout/AccountBanner.tsx` (lines ~168–205) loads the onboarding state once
when the app opens and never refreshes it; the "taken once" flag is only set when the redirect happens.
**Fix:** reload the state when the path changes away from /welcome (or after `saveOnboarding` / `skip`), and set the
"already opened" flag whenever /welcome is shown.

### BUG-06 · Medium · No app error page
A crash shows Next.js's plain, unstyled "This page couldn't load" with no menu. **Fix:** add `app/error.tsx` and
`app/global-error.tsx` in the Drapeit style with Reload / Back to dashboard and a "Report a problem" link.

### BUG-07 · Medium · Most of the app is not translated
In Hindi mode the dashboard, feed, explore, messages, profile and My Designs showed 0 Hindi words; only the menu,
settings, help and onboarding are translated. 17 of 90 components use `useT()`; the **sign-in screen is
English-only**. (Partly known: README "Known limitations (Phase 6D)".) **Fix:** move visible strings of the remaining
components into `lib/i18n.ts`, starting with sign-in, feed, post, profile, chats and the notebook.

### BUG-08 · Medium · No Content-Security-Policy or HSTS header
`next.config.ts` sends X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy, but no
`Content-Security-Policy`, and no `Strict-Transport-Security`. **Fix:** add a CSP that allows the API, Supabase
(https + wss) and Google Fonts; add HSTS on Vercel / in `next.config.ts` for https.

### BUG-09 · Medium · The notebook is extremely long on a phone
On a 390 px screen the notebook page is about 56,000 px tall (13 sections plus every output stacked).
**Fix:** on small screens show one section at a time (tabs or collapsible sections), and keep the generator list in
a bottom sheet.

### BUG-10 · Medium · Hashtags and mentions are not links
`#lehenga` chips on posts (`PostCard.tsx` ~248) and `@name` in comments are plain text. **Fix:** link tags to
`/explore?q=%23tag` (or a tag page) and mentions to `/u/<name>`.

### BUG-11 · Medium · No links / website field on profiles
**Fix:** add `website` (and optionally up to 3 links) to `profiles` (new migration), `ProfileUpdate`, the edit form
and the profile header, with `https://` validation and `rel="nofollow noopener"`.

### BUG-12 · Low · Two quick theme changes can undo each other
**Steps:** Settings → Theme: choose an app theme and, within a second, a profile theme. The saved app theme goes
back to the old one. **Why:** `AppearanceRepository.save` (`storage/appearance_repository.py` lines 52–82) reads the
row and writes all three columns back, without a lock; the second request writes the old value. **Fix:** update only
the columns that were sent (or `SELECT … FOR UPDATE`).

### BUG-13 · Low · Likes (and similar actions) are not rate-limited
40 like/unlike calls at once were all accepted. **Fix:** apply the existing `social_limiter` to likes, saves,
follows and reposts.

### BUG-14 · Low · Expected answers show as red console errors
Taken username (409), "post not found" (404), not-admin (404) and the Learning Library (503) print
"Failed to load resource" errors in the browser console. Harmless, but they hide real errors. **Fix:** let expected
cases answer 200 with a status field, or accept it as browser noise.

### BUG-15 · Low · Warning someone closes the report
After **Warn**, the report leaves the queue, so the admin cannot also **Suspend** from it.
**Fix:** keep the report open after a warning (mark it "Reviewing"), close it on Dismiss / Remove / Suspend.

### BUG-16 · Low · Suspended people still see the comment box
The banner says they are suspended, but the comment box (and Send in chats) is still shown; pressing it gives an error
(403). **Fix:** hide or disable those forms with a short note when `account.suspension` is set.

### BUG-17 · Low · Measurement box accepts letters
Tailor workspace → a measurement value box accepts "abc". **Fix:** `inputMode="decimal"` and a clear message for
non-numbers.

### BUG-18 · Low · Learning Library answers 503 for every quick search without a YouTube key
Each topic chip calls `/api/tutorials/search` and gets 503. **Fix:** do not search until a key is set (the page
already explains the free setup), or answer 200 with `connected: false`.

### BUG-19 · Low · Two clear (×) buttons in the Explore search box
The browser's own clear button shows next to the app's. **Fix:** hide the native one (`appearance: none` on
`input[type=search]::-webkit-search-cancel-button`) or use `type="text"`.

### BUG-20 · Low · Page titles that are not headings
"Page not found" (`app/not-found.tsx`) and the chat header are styled text, not headings, so screen readers cannot
jump to them. **Fix:** use `<h1>`.

### BUG-21 · Low · Development tools have security advisories
`npm audit`: `vitest` / `tinypool` (2 critical, 1 moderate). They are only used for tests on your computer, never in
the website. **Fix:** update `vitest` to 5.x when convenient and re-run the unit tests.

---

## 4. What was tested and what was not

**Tested in the browser (Playwright, `frontend/e2e/`):** sign-in for three accounts; sign-up form checks;
onboarding (finish, skip, resume); profile edit, picture upload, bad files, bio limit, HTML in bio; creating a design,
complete package, all 13 generators, spec edit and versions, studio drawing / save / PNG, fabric, tailor sheet + PDF,
cost estimate, export, duplicate, delete; publishing with each visibility and checking it from two other accounts;
edit caption; like, save, comment, reply, comment like, repost, share; restrict + approve, report a post, private
account + follow request, mute, block, explore and search; chats (send, live update, Seen, unsend, send a post,
message request); notifications and their settings; settings search, hidden words, who can comment / message,
activity, language, theme (free, Premium locked, profile theme), verification, help with screenshot, download data,
change password, deactivate and return, delete and cancel; admin (access, reports, warn, suspend, lift, verify,
problem reports, action log); security checks through the API and directly against Supabase; every page on desktop and
phone (time to content, stuck loading, sideways scrolling, crashes, empty states, signed-out access, phone menu,
buttons that do nothing).

**Not tested:** real email delivery (sign-up confirmation, reset, change email: needs SMTP); real AI / YouTube
providers (mock mode, no keys); the 30-day permanent deletion job; deployed Render / Vercel (speed there will differ);
other browsers (Safari, Firefox); screen readers beyond the accessible names the tests use.

---

## 5. Suggested fix order (three big prompts)

**Prompt 1 – Stop the breakages and make it fast.** BUG-01 (notebook crash), BUG-04 (hidden ⋯ menu), BUG-05
(onboarding banner), BUG-06 (error pages), BUG-12 (theme lost update), BUG-02 (speed: one bootstrap call for the
shell, one transaction per request, `/me/account` as one query, bigger pool, faster publish / export / download, and
the region advice). Re-run `npm run e2e` and compare the timings.

**Prompt 2 – Launch safety and settings.** BUG-03 (SMTP and sign-up email test, with the steps for the Supabase
dashboard), BUG-08 (CSP + HSTS), BUG-13 (rate limits), BUG-15 and BUG-16 (admin and suspension flow), BUG-17
(measurement input), BUG-18 (Learning Library 503s), BUG-14 (console noise), BUG-21 (update vitest).

**Prompt 3 – Instagram-level polish.** BUG-07 (translate every page, sign-in first), BUG-09 (notebook on phones),
BUG-10 (clickable tags and mentions, tag page), BUG-11 (profile links), BUG-19 and BUG-20 (small UI and accessibility
fixes). Then, as separate projects: public post pages with link previews, saved collections, Google sign-in,
two-factor sign-in, push / email notifications, PWA install, and group chats.

---

## 6. Final run with fresh accounts

FINAL_RUN_PLACEHOLDER
