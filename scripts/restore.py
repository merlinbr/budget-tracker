#!/usr/bin/env python3
"""Restore script: stage a backup into a fresh DB and atomically swap it into
place after archiving the previous target. Stdlib only.

Safety properties (contract):
- refuses without --confirm
- refuses snapshots whose alembic revision is not 0005_budgets
- refuses if the staged copy fails integrity/foreign-key checks
- never edits the source snapshot in place
- DELETEs all sessions rows in the staged copy (fresh logins after restore)
- snapshots the existing target first (budget-pre-restore-<UTC>.sqlite,
  retention disabled)
- failures leave the original target untouched
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
from backup import create_snapshot

HEAD_REVISION = "0005_budgets"


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%Sz")


def _query_head_revision(db: Path) -> str | None:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    return row[0] if row else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Restore a budget tracker snapshot to an offline database."
    )
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="confirmation flag; restore refuses without it",
    )
    args = parser.parse_args(argv)

    if not args.confirm:
        print(
            "restore failed: --confirm is required to overwrite a database;"
            " re-run with --confirm",
            file=sys.stderr,
        )
        return 1

    backup = Path(args.backup).resolve()
    database = Path(args.database).resolve()
    staged: Path | None = None
    try:
        if not backup.is_file():
            raise FileNotFoundError(f"backup not found: {backup}")

        revision = _query_head_revision(backup)
        if revision != HEAD_REVISION:
            have = revision if revision else "not a migrated snapshot"
            raise RuntimeError(
                f"backup {backup} has revision {have!r};"
                f" need {HEAD_REVISION!r} (run alembic upgrade head)"
            )

        # Stage a fresh standalone copy from the backup; never edit it.
        staging_dir = Path(tempfile.gettempdir()) / "budget-tracker-restores"
        staging_dir.mkdir(parents=True, exist_ok=True)
        staged = staging_dir / (
            f".budget-restore-{os.getpid()}-{_utc_stamp()}.sqlite"
        )
        src = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
        try:
            dst = sqlite3.connect(f"file:{staged}?mode=rwc", uri=True)
            try:
                src.backup(dst)
                dst.commit()
            finally:
                dst.close()
        finally:
            src.close()

        # Sessions ride the snapshot but belong to the old deployment; drop
        # every row so nobody rides an old session after the restore.
        conn = sqlite3.connect(staged)
        try:
            conn.execute("DELETE FROM sessions")
            conn.commit()
            bad = [r[0] for r in conn.execute("PRAGMA integrity_check").fetchall()]
            if bad != ["ok"]:
                raise RuntimeError(f"staged copy failed integrity_check: {bad}")
            fk = conn.execute("PRAGMA foreign_key_check").fetchall()
            if fk:
                raise RuntimeError(
                    f"staged copy failed foreign_key_check on {len(fk)} rows"
                )
            rev = conn.execute("SELECT version_num FROM alembic_version").fetchone()
            if rev is None or rev[0] != HEAD_REVISION:
                raise RuntimeError("staged copy revision mismatch")
        finally:
            conn.close()

        # Preserve the existing target before touching it. A damaged target
        # can't be snapshotted (create_snapshot validates); fall back to a
        # plain byte-level copy so the damaged file is still kept.
        published: Path | None = None
        if database.exists():
            published = database.parent / (
                f"budget-pre-restore-{_utc_stamp()}.sqlite"
            )
            stamp_dir = Path(
                tempfile.mkdtemp(prefix="budget-pre-restore-")
            )
            try:
                try:
                    create_snapshot(database, stamp_dir)
                    pres = list(stamp_dir.glob("budget-*.sqlite"))
                    if len(pres) != 1:
                        raise RuntimeError(
                            "pre-restore snapshot: expected exactly 1"
                            f" published snapshot, found {len(pres)}"
                        )
                    os.replace(pres[0], published)
                except sqlite3.DatabaseError:
                    # Damaged target: keep the bytes as-is.
                    shutil.copyfile(database, published)
            finally:
                shutil.rmtree(stamp_dir, ignore_errors=True)

        # Target survives until here; remove obsolete sidecars, then swap.
        if database.exists():
            Path(str(database) + "-wal").unlink(missing_ok=True)
            Path(str(database) + "-shm").unlink(missing_ok=True)

        os.replace(staged, database)
        staged = None  # ownership moved into the target
        if os.name != "nt":
            os.chmod(database, 0o600)

        notes = []
        if published is not None:
            notes.append(f"previous target preserved as {published}")
        print(f"restored {backup} -> {database}")
        for note in notes:
            print(note)
        return 0
    except Exception as exc:
        print(f"restore failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
