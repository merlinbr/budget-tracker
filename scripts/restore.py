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
- pre-restore snapshots never overwrite existing directory entries
- existing target WAL is checkpointed and closed before sidecar manipulation
- fsyncs staged data and relevant directory entries before/after publication
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
    serial = 0
    while True:
        suffix = f"-{serial:02x}" if serial else ""
        target = directory / f"budget-pre-restore-{stamp}{suffix}.sqlite"
        if not os.path.lexists(target):
            return target
        serial += 1


def _publish_preserve(source: Path, directory: Path, stamp: str) -> Path:
    """Publish a verified preserve snapshot without replacing any path."""
    while True:
        target = _unique_preserve_name(directory, stamp)
        try:
            os.link(source, target)
        except FileExistsError:
            continue
        except PermissionError:
            if os.path.lexists(target):
                continue
            raise
        return target


def _restore_parked_sidecars(
    parked: list[tuple[Path, Path]]
) -> None:
    """Restore parked sidecars with no-overwrite hard links."""
    errors: list[Exception] = []
    for original, saved in reversed(parked):
        try:
            if not os.path.lexists(saved):
                raise RuntimeError(f"parked sidecar is missing: {saved}")
            try:
                os.link(saved, original)
            except FileExistsError as exc:
                raise RuntimeError(
                    f"sidecar destination occupied during rollback: {original}"
                ) from exc
            except PermissionError as exc:
                if os.path.lexists(original):
                    raise RuntimeError(
                        f"sidecar destination occupied during rollback: {original}"
                    ) from exc
                raise
        except Exception as exc:
            errors.append(exc)
    if errors:
        raise RuntimeError(
            f"could not restore {len(errors)} parked sidecar(s)"
        ) from errors[0]


def _collect_sidecars(database: Path) -> list[Path]:
    sidecars: list[Path] = []
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(database) + suffix)
        if not os.path.lexists(sidecar):
            continue
        if sidecar.is_symlink():
            raise RuntimeError(f"sidecar must not be a symlink: {sidecar}")
        if not sidecar.is_file():
            raise RuntimeError(
                f"sidecar must be a regular file: {sidecar}"
            )
        sidecars.append(sidecar)
    return sidecars


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
    sidecar_dir: Path | None = None
    retain_sidecar_dir = False
    try:
        backup, database = _reject_unsafe_paths(args.backup, args.database)
        if not backup.is_file():
            raise FileNotFoundError(f"backup not found: {backup}")
        _collect_sidecars(database)

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
                published = _publish_preserve(
                    pres[0], database.parent, _utc_stamp()
                )
            finally:
                shutil.rmtree(stamp_dir, ignore_errors=True)
        if published is not None:
            _fsync_dir(database.parent)

        # Prepare the staged file fully before touching target sidecars.
        if os.name != "nt":
            if target_stat is not None:
                os.chown(staged, target_stat.st_uid, target_stat.st_gid)
                os.chmod(staged, stat.S_IMODE(target_stat.st_mode))
            else:
                os.chmod(staged, 0o600)

        _fsync_file(staged)

        # The target is offline: checkpoint and close it before moving
        # sidecars. A busy or incomplete checkpoint leaves the old target
        # untouched and aborts before any sidecar rename.
        if database.exists():
            target_conn = sqlite3.connect(database)
            try:
                checkpoint = target_conn.execute(
                    "PRAGMA wal_checkpoint(TRUNCATE)"
                ).fetchone()
                if checkpoint is None or len(checkpoint) != 3:
                    raise RuntimeError(
                        "target WAL checkpoint returned no completion status"
                    )
                busy, log_frames, checkpointed = (
                    int(value) for value in checkpoint
                )
                if busy != 0 or log_frames != checkpointed:
                    raise RuntimeError(
                        "target WAL checkpoint incomplete: "
                        f"busy={busy}, log={log_frames}, "
                        f"checkpointed={checkpointed}"
                    )
            finally:
                target_conn.close()

        sidecars = _collect_sidecars(database)

        # Park sidecars in a private same-directory filesystem staging
        # directory. Rename is atomic into a fresh 0700 directory; rollback
        # restores names with no-overwrite hard links.
        parked: list[tuple[Path, Path]] = []
        published_target = False
        try:
            if sidecars:
                sidecar_dir = Path(tempfile.mkdtemp(
                    prefix=".budget-sidecars-", dir=database.parent
                ))
                for sidecar in sidecars:
                    saved = sidecar_dir / sidecar.name
                    if os.path.lexists(saved):
                        raise RuntimeError(
                            f"sidecar parking path already exists: {saved}"
                        )
                    os.rename(sidecar, saved)
                    parked.append((sidecar, saved))
            if parked:
                if sidecar_dir is None:
                    raise RuntimeError("sidecar parking directory is missing")
                _fsync_dir(sidecar_dir)
                _fsync_dir(database.parent)
            os.replace(staged, database)
            staged = None  # ownership moved into the target
            published_target = True
        except Exception:
            if not published_target:
                try:
                    _restore_parked_sidecars(parked)
                    _fsync_dir(database.parent)
                except Exception as rollback_exc:
                    retain_sidecar_dir = True
                    raise RuntimeError(
                        "restore aborted; sidecar rollback incomplete; "
                        f"recovery directory retained at {sidecar_dir}"
                    ) from rollback_exc
            raise

        post_publication_errors: list[Exception] = []
        retained_cleanup_note = ""
        if sidecar_dir is not None:
            try:
                shutil.rmtree(sidecar_dir)
            except Exception as exc:
                post_publication_errors.append(exc)
                retain_sidecar_dir = True
                retained_cleanup_note = (
                    f"; obsolete sidecars retained at {sidecar_dir}"
                )
            else:
                sidecar_dir = None
        try:
            _fsync_dir(database.parent)
        except Exception as exc:
            post_publication_errors.append(exc)
        if post_publication_errors:
            raise RuntimeError(
                "restore published the target but post-publication cleanup "
                "or durability failed" + retained_cleanup_note
            ) from post_publication_errors[0]

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
        if sidecar_dir is not None and not retain_sidecar_dir:
            shutil.rmtree(sidecar_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
