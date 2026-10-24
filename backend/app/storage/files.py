"""Picture files in Supabase Storage.

Files live in a PRIVATE bucket (default "project-assets") at
"<owner_id>/<project_id>/<asset_id>.<ext>". Only this backend talks to Storage,
with the project's secret key, so the browser never needs Storage access: it
asks the backend, which checks that the picture belongs to the signed-in user.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)


class StorageError(Exception):
    """A file could not be saved or loaded. The message is safe to show."""


class SupabaseStorage:
    def __init__(self, supabase_url: str, secret_key: str, bucket: str, client: httpx.Client | None = None) -> None:
        self.base = f"{supabase_url.rstrip('/')}/storage/v1"
        self.bucket = bucket
        # New "sb_secret_..." keys go in the apikey header; Supabase also accepts the
        # same value as the bearer token. Legacy service_role keys are JWTs and work in both.
        self.headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}
        self.client = client or httpx.Client(timeout=60.0)

    def _url(self, path: str) -> str:
        return f"{self.base}/object/{self.bucket}/{quote(path)}"

    def _fail(self, action: str, res: httpx.Response | None, exc: Exception | None = None) -> StorageError:
        status = res.status_code if res is not None else "no response"
        log.warning("Storage %s failed: %s", action, status)
        hint = ""
        if res is not None and res.status_code in (400, 404) and action == "upload":
            hint = " Check that the storage bucket exists (see docs/DEPLOYMENT.md)."
        if res is not None and res.status_code in (401, 403):
            hint = " Check SUPABASE_SECRET_KEY on the backend."
        return StorageError(f"File storage could not {action} the picture.{hint}")

    def put(self, path: str, data: bytes, mime_type: str) -> None:
        try:
            res = self.client.post(self._url(path), content=data,
                                   headers={**self.headers, "Content-Type": mime_type, "x-upsert": "true"})
        except httpx.HTTPError as exc:
            raise self._fail("upload", None, exc) from exc
        if res.status_code not in (200, 201):
            raise self._fail("upload", res)

    def get(self, path: str) -> bytes:
        try:
            res = self.client.get(self._url(path), headers=self.headers)
        except httpx.HTTPError as exc:
            raise self._fail("load", None, exc) from exc
        if res.status_code == 404:
            raise StorageError("This picture is missing from file storage.")
        if res.status_code != 200:
            raise self._fail("load", res)
        return res.content

    def copy(self, source: str, destination: str) -> None:
        """Copy a file inside the bucket on the storage server (nothing is downloaded or uploaded)."""
        try:
            res = self.client.post(f"{self.base}/object/copy", headers=self.headers,
                                   json={"bucketId": self.bucket, "sourceKey": source, "destinationKey": destination})
        except httpx.HTTPError as exc:
            raise self._fail("copy", None, exc) from exc
        if res.status_code == 404:
            raise StorageError("This picture is missing from file storage.")
        if res.status_code not in (200, 201):
            raise self._fail("copy", res)

    def delete(self, paths: list[str]) -> None:
        """Best effort: a failure is logged, because the database rows are already gone."""
        if not paths:
            return
        try:
            res = self.client.request("DELETE", f"{self.base}/object/{self.bucket}", json={"prefixes": paths},
                                      headers=self.headers)
            if res.status_code not in (200, 204):
                log.warning("Storage delete of %d file(s) failed: %s", len(paths), res.status_code)
        except httpx.HTTPError as exc:
            log.warning("Storage delete of %d file(s) failed: %s", len(paths), type(exc).__name__)
