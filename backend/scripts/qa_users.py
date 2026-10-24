"""Create and delete the throw-away accounts used by the browser tests (frontend/e2e).

    python scripts/qa_users.py create <out.json>   # 3 confirmed accounts; the first one is an admin
    python scripts/qa_users.py cleanup             # delete every QA account and everything it made

Only accounts whose email matches qa-drapeit-%@example.com are ever touched. Accounts are made with
Supabase's admin API (already confirmed, so no email is sent). Settings come from backend/.env; keys are
never printed.
"""

from __future__ import annotations

import json
import secrets
import sys
import time
from pathlib import Path

import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import load_settings  # noqa: E402

EMAIL_PATTERN = "qa-drapeit-%@example.com"
NAMES = ["a", "b", "c"]


def _admin_headers(secret_key: str) -> dict[str, str]:
    return {"apikey": secret_key, "Authorization": f"Bearer {secret_key}", "Content-Type": "application/json"}


def create(out_file: str) -> None:
    s = load_settings()
    run = time.strftime("%m%d%H%M%S")
    users = []
    with httpx.Client(timeout=30) as http:
        for name in NAMES:
            email = f"qa-drapeit-{run}-{name}@example.com"
            password = "Qa-" + secrets.token_urlsafe(12)
            res = http.post(f"{s.supabase_url}/auth/v1/admin/users", headers=_admin_headers(s.supabase_secret_key),
                            json={"email": email, "password": password, "email_confirm": True})
            if res.status_code >= 300:
                sys.exit(f"Could not create {email}: HTTP {res.status_code} {res.text[:200]}")
            users.append({"name": name, "email": email, "password": password, "id": res.json()["id"],
                          "username": f"qa_{name}_{run}"})
    with psycopg.connect(s.database_url, autocommit=True) as conn:
        conn.execute("insert into public.admin_users (user_id, note) values (%s, 'QA test admin')", (users[0]["id"],))
    Path(out_file).write_text(json.dumps({"run": run, "users": users}, indent=1), encoding="utf-8")
    print(f"created {len(users)} QA accounts (run {run}); {users[0]['email']} is an admin")


def cleanup() -> None:
    s = load_settings()
    with psycopg.connect(s.database_url, autocommit=True) as conn:
        ids = [str(r[0]) for r in conn.execute("select id from auth.users where email like %s", (EMAIL_PATTERN,))]
        if not ids:
            print("no QA accounts left")
            return
        q = lambda sql: [r[0] for r in conn.execute(sql, (ids,)) if r[0]]  # noqa: E731
        paths = (
            q("select a.storage_path from public.assets a join public.projects p on p.id = a.project_id"
              " where p.owner_id::text = any(%s)")
            + q("select i.storage_path from public.post_images i join public.posts p on p.id = i.post_id"
                " where p.author_id::text = any(%s)")
            + q("select avatar_path from public.profiles where id::text = any(%s)")
            + q("select image_path from public.messages where sender_id::text = any(%s)")
            + q("select screenshot_path from public.problem_reports where user_id::text = any(%s)")
        )
        chats = q("select distinct conversation_id from public.conversation_members where user_id::text = any(%s)")
        # Rows that would otherwise stay behind with an empty user (on delete set null).
        conn.execute("delete from public.reports where reporter_id::text = any(%s) or reported_user_id::text = any(%s)",
                     (ids, ids))
        conn.execute("delete from public.admin_actions where admin_id::text = any(%s) or target_user_id::text = any(%s)",
                     (ids, ids))
        conn.execute("delete from public.conversations where id = any(%s)", (chats,))
    with httpx.Client(timeout=60) as http:
        for start in range(0, len(paths), 100):
            res = http.request("DELETE", f"{s.supabase_url}/storage/v1/object/{s.storage_bucket}",
                               headers=_admin_headers(s.supabase_secret_key), json={"prefixes": paths[start:start + 100]})
            if res.status_code >= 300:
                print(f"warning: storage delete returned HTTP {res.status_code}")
        for uid in ids:
            res = http.delete(f"{s.supabase_url}/auth/v1/admin/users/{uid}", headers=_admin_headers(s.supabase_secret_key))
            if res.status_code >= 300:
                print(f"warning: could not delete user {uid}: HTTP {res.status_code}")
    with psycopg.connect(s.database_url, autocommit=True) as conn:
        left = conn.execute("select count(*) from auth.users where email like %s", (EMAIL_PATTERN,)).fetchone()[0]
    print(f"deleted {len(ids)} QA accounts, {len(paths)} stored files, {len(chats)} chats; QA accounts left: {left}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "create":
        create(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "cleanup":
        cleanup()
    else:
        sys.exit(__doc__)
