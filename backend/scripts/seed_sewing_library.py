"""Load the sewing library (technique modules and fabric rules) into the database.

    python scripts/seed_sewing_library.py              # copy the library files into the database
    python scripts/seed_sewing_library.py --check      # only check the library files, change nothing
    python scripts/seed_sewing_library.py --no-embeddings

Run migration 0012 in the Supabase SQL editor first. Running this again is safe: only modules whose
text changed are updated, and modules that were removed from the files are removed from the database.

If GEMINI_API_KEY is set in backend/.env, each new or changed module is also turned into an embedding
(free within Google's free tier), which lets the guide find techniques by meaning. Without a key the
library still works: the guide finds techniques by the garment features it recognised.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import load_settings  # noqa: E402
from app.knowledge import all_fabric_rules, all_modules, check_library  # noqa: E402
from app.providers.registry import build_providers  # noqa: E402
from app.storage.database import Database  # noqa: E402
from app.storage.knowledge_repository import KnowledgeRepository  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="only check the library files; do not touch the database")
    parser.add_argument("--no-embeddings", action="store_true", help="do not create embeddings even if a Gemini key is set")
    args = parser.parse_args()

    modules, rules = all_modules(), all_fabric_rules()
    problems = check_library(modules, rules)
    print(f"Library files: {len(modules)} technique modules, {len(rules)} fabric rules.")
    if problems:
        print("Problems found:\n" + "\n".join(f"- {p}" for p in problems))
        return 1
    if args.check:
        print("The library files are sound.")
        return 0

    settings = load_settings()
    embedder = None if args.no_embeddings else build_providers(settings).embedder
    db = Database(settings.database_url, max_size=2, min_size=1)
    try:
        counts = KnowledgeRepository(db).sync(modules, rules, embedder)
    finally:
        db.close()
    print(f"Added {counts['added']}, updated {counts['updated']}, unchanged {counts['unchanged']}, "
          f"removed {counts['removed']}. Fabric rules written: {counts['rules']}.")
    if embedder is None:
        print("No embeddings made (no Gemini key, or --no-embeddings). The guide still works without them.")
    else:
        print(f"Embeddings made or refreshed: {counts['embedded']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
