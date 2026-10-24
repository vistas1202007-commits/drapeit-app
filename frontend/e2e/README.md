# Browser tests (Playwright)

These tests click through the whole app in a real Chrome window, on a desktop size (1280 px) and a phone size
(390 px), with three throw-away accounts. They talk to the **real Supabase project** in `backend/.env`.

## What they need

- The backend running on port 8000 and the website on port 3000. For realistic speed use the production build:
  `npm run build && npm start` (in `frontend/`) and the `uvicorn` command from the main README (in `backend/`).
- Google Chrome installed (the tests use it instead of downloading their own browsers).
- `backend/.env` filled in (the accounts are made with the Supabase secret key; nothing is printed).

## Run

```bash
cd frontend
npm run e2e            # everything: sign-in, all flows (desktop), all pages (desktop and phone)
npm run e2e:desktop    # only the desktop project
npm run e2e:mobile     # only the phone-size page checks
npm run e2e:cleanup    # delete the QA accounts and everything they made
```

To delete the accounts automatically at the end of a run, set `E2E_CLEANUP=1` first
(PowerShell: `$env:E2E_CLEANUP = "1"`). One real sign-up is tried only with `E2E_SIGNUP=1`, because Supabase allows
only a few sign-ups per hour.

## The QA accounts

`backend/scripts/qa_users.py` makes three confirmed accounts called `qa-drapeit-<time>-a|b|c@example.com`
(no email is sent). **a** is an admin, **b** and **c** are ordinary people. Cleanup only ever touches emails that match
`qa-drapeit-%@example.com`: it removes their pictures from Storage, their reports, chats and admin log rows, then the
accounts themselves (the rest goes with them).

## Files

| Path | What it checks |
| --- | --- |
| `auth.setup.ts` | signs each account in through the real sign-in screen |
| `flows/01` … `flows/09` | sign-up and onboarding, profile, designs (notebook, studio, fabric, tailor, cost), publishing with each visibility, likes / comments / saves / reposts / safety tools, chats and notifications, every settings page, admin actions, and security (one person reaching another's data) |
| `pages/all-pages.e2e.ts` | every page on desktop and phone: time until content, stuck loading messages, sideways scrolling, crashes, empty states, signed-out access, the phone menu, buttons that do nothing |
| `support/qa.ts` | shared helpers; findings (console errors, failed requests, slow pages) go to `e2e/.results/findings.jsonl` |

Results, screenshots and traces stay in `e2e/.results/` and sessions in `e2e/.auth/`; both are ignored by git.
Traces contain sign-in tokens, so do not share them.
