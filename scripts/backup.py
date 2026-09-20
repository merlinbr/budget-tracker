#!/usr/bin/env python3
"""Backup script: publish a consistent budget-<UTC>.sqlite snapshot.

Design contract:
- stdlib only (sqlite3, argparse, pathlib, os, sys, datetime, tempfile, time).
- create_snapshot(database, destination) is importable (restore.py reuses it
  via importlib like `python scripts/restore.py` -> `from backup import
  create_snapshot`). No retention inside create_snapshot.
- Source and completed staged snapshots are checked for integrity, migration
  revision, required Budget tables, and foreign-key violations.
- Publication fsyncs the staged file before rename and the destination
  directory after rename.
- Retention: only after successful publication, only on files matching
  `budget-<UTC-timestamp>.sqlite` this script owns, never on unrelated files.
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOT_RE = re.compile(r"^budget-(\d{8}t\d{6}z)(?:-[0-9a-f]{2,8})?\.sqlite$")

REQUIRED_TABLES: tuple[str, ...] = (
    "users", "households", "household_members", "sessions",
    "accounts", "categories", "transactions", "budgets",
)
BACKUP_DEADLINE_SECONDS = 300


def _reject_symlinks(*labelled: tuple[str, Path]) -> None:
    for label, path in labelled:
        if path.is_symlink():
            raise RuntimeError(f"{label} must not be a symlink: {path}")


def _verify_snapshot(conn: sqlite3.Connection, label: str) -> None:
    """Integrity + revision + required Budget tables + foreign keys."""
    bad = [row[0] for row in conn.execute("PRAGMA integrity_check").fetchall()]
    if bad != ["ok"]:
        raise RuntimeError(f"{label} failed integrity_check: {bad}")
    try:
        rev = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.OperationalError as exc:
        raise RuntimeError(
            f"{label} must be migrated to 0005_budgets, found missing"
        ) from exc
    if rev is None or rev[0] != "0005_budgets":
        have = rev[0] if rev else "missing"
        raise RuntimeError(f"{label} must be migrated to 0005_budgets, found {have}")
    tables = {
        row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    missing = [t for t in REQUIRED_TABLES if t not in tables]
    if missing:
        raise RuntimeError(f"{label} is missing required tables: {', '.join(missing)}")
    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        raise RuntimeError(f"{label} failed foreign_key_check on {len(fk)} rows")


def _fsync_file(path: Path) -> None:
    flags = os.O_RDWR if os.name == "nt" else os.O_RDONLY
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(path: Path) -> None:
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%Sz")


def create_snapshot(database: Path, destination: Path) -> None:
    """Atomic publish a consistent SQLite snapshot into destination.

    Raises RuntimeError (with path/revision context, no row data) on failure;
    leaves no temps behind and never overwrites an existing snapshot.
    """
    database = Path(database).resolve()
    destination = Path(destination).resolve()

    if not database.is_file():
        raise FileNotFoundError(f"source database not found: {database}")

    # Validate the source before staging.
    src = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    try:
        src.execute("PRAGMA foreign_keys=ON")
        src.execute("PRAGMA busy_timeout=5000")
        _verify_snapshot(src, f"source {database}")
    finally:
        src.close()

    destination.mkdir(parents=True, exist_ok=True)

    # Stage beside the destination so the final os.replace is same-filesystem
    # and operators can see a live `.part` while the snapshot is copying.
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="budget-", suffix=".part", dir=destination, delete=False
        ) as temp:
            tmp_path = Path(temp.name)
        # Temp file lives beside the destination (same volume ⇒ atomic
        # os.replace); sourced read-only from the live DB.
        src = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
        try:
            deadline = time.monotonic() + BACKUP_DEADLINE_SECONDS

            def _progress(status: int, remaining: int, total: int) -> None:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"backup exceeded {BACKUP_DEADLINE_SECONDS}-second deadline"
                    )

            db_conn = sqlite3.connect(tmp_path)
            try:
                src.backup(
                    db_conn, pages=1, progress=_progress, sleep=0.05
                )
                db_conn.commit()
            finally:
                db_conn.close()
        finally:
            src.close()

        verify = sqlite3.connect(tmp_path)
        try:
            _verify_snapshot(verify, "staged snapshot")
        finally:
            verify.close()

        # Publish atomically. Unique names: seconds stamps collide when two
        # backups run within the same second, so retry collision-free.
        base = destination / f"budget-{_utc_stamp()}.sqlite"
        target = base
        serial = 0
        while target.exists():
            serial += 1
            target = destination / f"budget-{base.stem.split('-', 1)[1]}-{serial:02x}.sqlite"
        _fsync_file(tmp_path)
        os.replace(tmp_path, target)
        _fsync_dir(destination)
    except Exception:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise


def _prunes(dest: Path, keep_days: int) -> list[Path]:
    """Old script-owned snapshots by age parsed from the UTC stamp (not
    mtime, which survives copies and is stable across filesystems)."""
    cutoff = datetime.now(timezone.utc)
    pruned = []
    for p in sorted(dest.glob("budget-*.sqlite")):
        if p.is_symlink():
            continue
        m = SNAPSHOT_RE.match(p.name)
        if not m:
            continue
        try:
            stamp_dt = datetime.strptime(
                m.group(1), "%Y%m%dt%H%M%Sz"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if (cutoff - stamp_dt).total_seconds() > keep_days * 86400:
            pruned.append(p)
    return pruned


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backup the budget tracker SQLite database."
    )
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument(
        "--keep-days", type=int, help="prune script snapshots older than N days"
    )
    args = parser.parse_args(argv)

    if args.keep_days is not None and args.keep_days <= 0:
        parser.error("--keep-days must be a positive number of days")

    try:
        _reject_symlinks(
            ("--database", args.database), ("--destination", args.destination)
        )
        destination = args.destination.resolve()
        database = args.database.resolve()
        create_snapshot(database, destination)
    except Exception as exc:
        print(f"backup failed: {exc}", file=sys.stderr)
        return 1

    if args.keep_days is not None:
        try:
            for old in _prunes(destination, args.keep_days):
                old.unlink()
        except Exception as exc:
            # Retention failure is nonzero even though publication succeeded.
            print(f"retention failed: {exc}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
