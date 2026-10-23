"""Removing things for good after their 30-day grace period (Phase 6D).

* Posts in "Recently deleted" for more than 30 days: the post rows and their
  picture files.
* Accounts whose owner asked for deletion more than 30 days ago: every file they
  own in Storage (design pictures, post pictures, profile picture, pictures they
  sent in chats, problem-report screenshots), then the sign-in account itself
  through Supabase's admin API. Deleting the sign-in account removes all of their
  database rows too, because every table points at auth.users with "on delete
  cascade".

`purge_due()` runs as a "system" connection (it must see everyone's rows). The app
runs it once at start-up and then every PURGE_INTERVAL_HOURS in a background
thread (`start_cleanup`).
"""

from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

from app.schemas.account import GRACE_DAYS
from app.storage.database import Database
from app.storage.files import SupabaseStorage

log = logging.getLogger(__name__)

DUE = f"now() - interval '{GRACE_DAYS} days'"


def _paths(conn: Any, query: str, value: Any) -> list[str]:
    return [r["path"] for r in conn.execute(query, (value,)).fetchall() if r["path"]]


def purge_deleted_posts(db: Database, store: SupabaseStorage) -> int:
    with db.connect(None) as conn:
        due = [r["id"] for r in conn.execute(
            f"SELECT id FROM posts WHERE status = 'deleted' AND deleted_at < {DUE}").fetchall()]
        if not due:
            return 0
        paths = _paths(conn, "SELECT storage_path AS path FROM post_images WHERE post_id = ANY(%s)", due)
        conn.execute("DELETE FROM posts WHERE id = ANY(%s)", (due,))
    store.delete(paths)
    return len(due)


def account_files(conn: Any, user_id: str) -> list[str]:
    """Every Storage file that belongs to this person."""
    return (
        _paths(conn, "SELECT a.storage_path AS path FROM assets a JOIN projects p ON p.id = a.project_id"
                     " WHERE p.owner_id = %s", user_id)
        + _paths(conn, "SELECT i.storage_path AS path FROM post_images i JOIN posts p ON p.id = i.post_id"
                       " WHERE p.author_id = %s", user_id)
        + _paths(conn, "SELECT avatar_path AS path FROM profiles WHERE id = %s", user_id)
        + _paths(conn, "SELECT image_path AS path FROM messages WHERE sender_id = %s", user_id)
        + _paths(conn, "SELECT screenshot_path AS path FROM problem_reports WHERE user_id = %s", user_id)
    )


def delete_sign_in_account(client: httpx.Client, supabase_url: str, secret_key: str, user_id: str) -> bool:
    """Supabase Auth admin API: delete the user (their rows go with it)."""
    try:
        res = client.delete(f"{supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                            headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}"})
    except httpx.HTTPError as exc:
        log.warning("Account deletion failed: %s", type(exc).__name__)
        return False
    if res.status_code in (200, 204, 404):  # 404: already gone
        return True
    log.warning("Account deletion failed: %s", res.status_code)
    return False


def purge_deleted_accounts(db: Database, store: SupabaseStorage, client: httpx.Client, supabase_url: str,
                           secret_key: str) -> int:
    with db.connect(None) as conn:
        due = [r["user_id"] for r in conn.execute(
            f"SELECT user_id FROM account_status WHERE delete_requested_at < {DUE}").fetchall()]
    done = 0
    for user_id in due:
        with db.connect(None) as conn:
            files = account_files(conn, user_id)
        store.delete(files)
        if delete_sign_in_account(client, supabase_url, secret_key, user_id):
            done += 1
    return done


def purge_due(db: Database, store: SupabaseStorage, client: httpx.Client, supabase_url: str, secret_key: str
              ) -> dict[str, int]:
    return {"posts": purge_deleted_posts(db, store),
            "accounts": purge_deleted_accounts(db, store, client, supabase_url, secret_key)}


def start_cleanup(db: Database, store: SupabaseStorage, client: httpx.Client, supabase_url: str, secret_key: str,
                  interval_hours: float) -> threading.Event:
    """Run purge_due now and then every interval_hours, until the returned event is set."""
    stop = threading.Event()

    def loop() -> None:
        while not stop.is_set():
            try:
                result = purge_due(db, store, client, supabase_url, secret_key)
                if any(result.values()):
                    log.info("Cleanup removed %d post(s) and %d account(s)", result["posts"], result["accounts"])
            except Exception:  # noqa: BLE001 - a failed run is retried next time
                log.exception("Cleanup run failed")
            stop.wait(interval_hours * 3600)

    threading.Thread(target=loop, name="cleanup", daemon=True).start()
    return stop
