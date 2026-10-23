"""Download PostgreSQL programs for running the backend tests (one time, ~13 MB).

Uses the open-source `pgserver` package from PyPI, which bundles PostgreSQL 16.
The wheel is only unpacked (not installed) into backend/.pgtest; the tests start a
temporary database from there and delete it afterwards. Nothing else is changed.

    python scripts/get_test_postgres.py

Linux/macOS: you can instead install PostgreSQL and set PG_BIN to its bin folder,
or point TEST_DATABASE_URL at an empty PostgreSQL server.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

VERSION = "0.1.4"
PLATFORMS = {"win32": "win_amd64"}
TARGET = Path(__file__).resolve().parent.parent / ".pgtest"


def main() -> int:
    platform = PLATFORMS.get(sys.platform)
    if platform is None:
        print("This helper only supports Windows. On Linux/macOS install PostgreSQL and set PG_BIN, "
              "or set TEST_DATABASE_URL (see docs/DEPLOYMENT.md).")
        return 1
    if (TARGET / "bin").exists():
        print(f"Already there: {TARGET}")
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([sys.executable, "-m", "pip", "download", f"pgserver=={VERSION}", "--no-deps",
                        "--only-binary=:all:", "--python-version", "3.12", "--platform", platform, "-d", tmp],
                       check=True)
        wheel = next(Path(tmp).glob("pgserver-*.whl"))
        with zipfile.ZipFile(wheel) as z:
            members = [m for m in z.namelist() if m.startswith("pgserver/pginstall/")]
            z.extractall(tmp, members)
        shutil.move(str(Path(tmp) / "pgserver" / "pginstall"), str(TARGET))
    print(f"PostgreSQL test programs are in {TARGET}. Now run: python -m pytest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
