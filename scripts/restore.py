#!/usr/bin/env python3
"""Restore script: stage a backup into a fresh DB and atomically swap it into
place after archiving the previous target. Stdlib only.

Safety properties (contract):
- refuses without --confirm
- refuses snapshots whose alembic revision is not 0005_budgets
- refuses if the staged copy fails integrity/foreign-key checks
- refuses symlink and source/target alias paths before modification
- never edits the source snapshot in place
- DELETEs all sessions rows in the staged copy (fresh logins after restore)
- stages privately beside the target with mode 0700
- snapshots the existing target first, preserving ownership/mode on replacement
- corrupt existing targets abort without replacement
- pre-restore snapshots have unique names
- failures leave the original target untouched
- fsyncs the staged file and target directory after publication
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
from backup import _fsync_dir, _fsync_file, _verify_snapshot, create_snapshot

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


def _reject_unsafe_paths(backup_arg: Path, database_arg: Path) -> tuple[Path, Path]:
    """Resolve args, refusing symlinks, aliases and identical source/target."""
    for label, path in (("--backup", backup_arg), ("--database", database_arg)):
        if path.is_symlink():
            raise RuntimeError(f"{label} must not be a symlink: {path}")
    backup = backup_arg.resolve()
    database = database_arg.resolve()
    if backup == database:
        raise RuntimeError(
            "--backup and --database must not be the same file"
        )
    if backup.is_file() and database.exists() and os.path.samefile(backup, database):
        raise RuntimeError(
            "--backup and --database resolve to the same file"
        )
    return backup, database


def _unique_preserve_name(directory: Path, stamp: str) -> Path:
    target = directory / f"budget-pre-restore-{stamp}.sqlite"
    serial = 0
    while target.exists():
        serial += 1
        target = directory / f"budget-pre-restore-{stamp}-{serial:02x}.sqlite"
    return target


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

    staged: Path | None = None
    staging_dir: Path | None = None
    try:
        backup, database = _reject_unsafe_paths(args.backup, args.database)
        if not backup.is_file():
            raise FileNotFoundError(f"backup not found: {backup}")

        revision = _query_head_revision(backup)
        if revision != HEAD_REVISION:
            have = revision if revision else "not a migrated snapshot"
            raise RuntimeError(
                f"backup {backup} has revision {have!r};"
                f" need {HEAD_REVISION!r} (run alembic upgrade head)"
            )

        # Stage privately on the target filesystem: same-volume os.replace,
        # 0700 from creation (mkdtemp), nothing in shared system temp.
        staging_dir = Path(tempfile.mkdtemp(
            prefix=".budget-restore-", dir=database.parent
        ))
        staged = staging_dir / "staged.sqlite"

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

        # Sessions ride the snapshot but belong to the old deployment.
        conn = sqlite3.connect(staged)
        try:
            conn.execute("DELETE FROM sessions")
            conn.commit()
            _verify_snapshot(conn, "staged copy")
        finally:
            conn.close()

        # Preserve the existing target before touching it. A corrupt target
        # aborts the restore: retained untouched for manual recovery.
        published: Path | None = None
        target_stat: os.stat_result | None = None
        if database.exists():
            target_stat = os.stat(database)
            published = _unique_preserve_name(database.parent, _utc_stamp())
            stamp_dir = Path(tempfile.mkdtemp(
                prefix=".budget-pre-restore-", dir=database.parent
            ))
            try:
                create_snapshot(database, stamp_dir)
                pres = list(stamp_dir.glob("budget-*.sqlite"))
                if len(pres) != 1:
                    raise RuntimeError(
                        "pre-restore snapshot: expected exactly 1"
                        f" published snapshot, found {len(pres)}"
                    )
                _fsync_file(pres[0])
                os.replace(pres[0], published)
            finally:
                shutil.rmtree(stamp_dir, ignore_errors=True)

        # Target survives until here; remove obsolete sidecars, then swap.
        if database.exists():
            Path(str(database) + "-wal").unlink(missing_ok=True)
            Path(str(database) + "-shm").unlink(missing_ok=True)

        # Preserve the previous target's ownership/mode (POSIX); default 0600
        # for new targets. Applied to the staged file before publication.
        if os.name != "nt":
            if target_stat is not None:
                os.chown(staged, target_stat.st_uid, target_stat.st_gid)
                os.chmod(staged, stat.S_IMODE(target_stat.st_mode))
            else:
                os.chmod(staged, 0o600)

        _fsync_file(staged)
        os.replace(staged, database)
        staged = None  # ownership moved into the target
        _fsync_dir(database.parent)

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
        if staging_dir is not None:
            shutil.rmtree(staging_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
