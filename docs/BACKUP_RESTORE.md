# Backup and Restore — Operator Guide

The Budget Tracker SQLite database is the only state that must survive an
incident. Backups and restores are **administrator operations on the host**;
there is no scheduled service, web endpoint, or browser-triggered restore in
the application.

Backups contain financial data and password hashes. Restrict directory access
to the administrator account.

## Files and scripts

| Path | Purpose |
| --- | --- |
| `scripts/backup.py` | Publish a verified standalone snapshot `budget-<UTC timestamp>.sqlite` and prune old script-owned snapshots. |
| `scripts/restore.py` | Offline recovery: stage a snapshot, drop stale sessions, archive the existing target, swap atomically. |

Both scripts use **only the Python standard library** and run with the host
Python (3.13+). They take explicit paths; nothing inside the app container
runs them.

## Daily backup

```text
python <repo>/scripts/backup.py --database <absolute-db-path> --destination <absolute-backup-directory> --keep-days 30
```

Concrete development example (replace with your real deployment values in
private operations notes — do not commit them):

```text
python C:/Users/merli/Documents/Projects/budget-tracker/scripts/backup.py --database C:/Users/merli/Documents/Projects/budget-tracker/data/budget.db --destination D:/backups/budget --keep-days 30
```

Behavior, verified by `backend/tests/test_backup_restore.py` (19 tests):

- Opens the source with SQLite `mode=ro`; a typo'd path fails instead of
  creating a new empty database (`source database not found`, exit 1).
- Uses `sqlite3.Connection.backup()`, so a **live WAL database** is safe to
  copy while the backend writes (`test_backup_live_writer_snapshot_is_consistent`).
- Validates revision `0005_budgets`, `PRAGMA integrity_check`, and
  `PRAGMA foreign_key_check` on the staged copy before publishing; failures
  exit nonzero and print only path/revision context.
- Publishes atomically as `budget-<YYYYMMDDtHHMMSSz>.sqlite`; repeated runs
  within the same second never collide or overwrite
  (`test_backup_publishes_unique_names_on_repeat`).
- Retention (`--keep-days 30`) prunes **only** files matching the snapshot
  naming this script owns, parsed from the UTC stamp in the filename, only
  after successful publication (`test_backup_retention_prunes_script_owned_only`).
  Unrelated files, symlinks, and pre-restore archives are never touched.
- Retention means **30 calendar days of completed snapshots**, not 30
  guaranteed successful runs. A missed day is an incident to investigate, not
  a rolling guarantee.
- A failed backup never prunes anything (`test_backup_failure_keeps_prior_snapshots`)
  and leaves no `.tmp` or partial files (`test_backup_invalid_db_fails_no_temp_left`).

### Scheduler (choose the host's real mechanism)

Linux (systemd timer):

```ini
# /etc/systemd/system/budget-backup.service
[Unit]
Description=Budget Tracker daily backup
[Service]
Type=oneshot
User=budget
ExecStart=/usr/bin/python3 /opt/budget-tracker/scripts/backup.py --database /srv/budget/data/budget.db --destination /srv/budget-backups --keep-days 30

# /etc/systemd/system/budget-backup.timer
[Unit]
Description=Run Budget Tracker backup daily
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

```text
systemctl daemon-reload && systemctl enable --now budget-backup.timer
systemctl list-timers budget-backup.timer
```

Windows Task Scheduler (if the server is Windows):

```text
schtasks /Create /SC DAILY /ST 03:30 /TN "Budget backup" /TR "python C:\path\to\scripts\backup.py --database C:\path\to\data\budget.db --destination D:\backups\budget --keep-days 30"
```

Rules, regardless of mechanism:

- **No overlap**: one backup run against one destination at a time. A long run
  must not trigger the next day's run in parallel (systemd timers skip while
  the service runs; cron users should use a lock file, e.g. `flock`).
- **Check the exit status and log**, not just the absence of errors:
  `0` = published and retained; `1` = failed; stderr states the reason.
- **Monitor free disk space** on the destination. Each snapshot is a complete
  database copy (~the size of `budget.db`; about 30 copies under
  `--keep-days 30`).
- One writer per destination directory; backups erased by a second machine
  pointing at the same directory silently defeat retention.

### Weekly confidence check

```sh
python3 -c"import sqlite3;c=sqlite3.connect('$(ls -1 /srv/budget-backups/budget-*.sqlite|tail -1)');print(c.execute('PRAGMA integrity_check').fetchone())"
```

If a scheduled run has not produced a new snapshot in over `keep-days`, treat
the pipeline as failed.

## Offline restore

**Restore is an offline operation.** A SQLite lock cannot prove that no idle
backend process exists; `--confirm` is the operator's attestation to:

1. Stop the backend container (`docker compose stop backend`) and verify it is
   stopped (`docker compose ps`).
2. Stop any backup scheduler (to keep it from running mid-restore).
3. Confirm no other database user (CLI shells, notebooks) holds the file open.

```text
python <repo>/scripts/restore.py --backup <absolute-snapshot-path> --database <absolute-offline-db-path> --confirm
```

Verified behavior (`backend/tests/test_backup_restore.py`):

- Refuses without `--confirm` **before** opening a writable target
  (`test_restore_requires_confirm_flag`).
- Refuses missing/corrupt snapshots and snapshots whose revision is not
  `0005_budgets`; the target is left untouched
  (`test_restore_missing_backup_refused`, `test_restore_corrupt_snapshot_without_target`,
  `test_restore_wrong_revision_refused`). Older/newer snapshots require the
  matching application release and an explicit migration procedure, not
  schema guessing.
- Stages a fresh copy from the snapshot, then **deletes every `sessions`
  row** — rotating `SESSION_SECRET` alone does not revoke saved session
  hashes; deleting the rows does
  (`test_restore_writes_sessions_empty_transactions_kept`).
  Historical credentials restored with the data keep their historical
  password state; reset affected accounts offline before reopening access.
- Never edits the source snapshot; its bytes are unchanged after a restore
  (`test_restore_preserves_snapshot_bytes`).
- Preserves a damaged or healthy existing target as
  `budget-pre-restore-<UTC timestamp>.sqlite` next to it before replacing it;
  if preservation fails, the restore aborts without touching the target.
  Keep pre-restore files until the drill is accepted, then prune manually.
- Publishes with `os.replace` in the target directory (no delete-then-copy
  window) and removes only the target's obsolete `-wal`/`-shm` sidecars after
  preservation succeeds.
- On POSIX, the restored file is `0600`. Preserve target owner UID/GID if the
  previous file had non-root ownership: `chown 10001:10001 <database>` after
  a restore into a directory owned by UID 10001 (the container's runtime
  user), so the backend can write again. On Windows, confidentiality relies
  on NTFS ACLs, not `chmod`; restrict the file to the administrator/service
  account.

### Recovery stack (separate from production)

Drill restores into a **separate Compose project with its own volumes** —
never the production project, and never `down -v` on production volumes:

```text
# example: production project name budget; recovery project budget-recovery
docker compose -p budget-recovery -f docker-compose.yml --env-file .env.recovery up -d backend
```

While the backend is still offline, run migrations once with a one-shot
container, then inspect the revision and start:

```text
docker compose -p budget-recovery run --rm backend alembic upgrade head
docker compose -p budget-recovery exec backend alembic current
```

Proof drill (executed with scripts/backup.py + scripts/restore.py against a
disposable directory; see backend/tests/test_backup_restore.py::test_backup_restore_full_drill):

1. `python scripts/backup.py --database <db> --destination <dir> --keep-days 30`
2. Damage or discard the live database.
3. `python scripts/restore.py --backup <snapshot> --database <offline-db> --confirm`
4. `python -c "import sqlite3; c=sqlite3.connect('<offline-db>'); print(c.execute('SELECT count(*) FROM sessions').fetchone()[0], c.execute('SELECT count(*) FROM transactions').fetchone()[0])"`
   → `0 1` (sessions empty, transactions preserved).
5. Start the recovery backend with the restored database, expect old cookies
   to get **401**, fresh login to read restored values, and a subsequent new
   write to succeed.

## Worth knowing

- **CSV is not backup.** `GET /api/export/transactions.csv` is a user-facing
  spreadsheet export; only `scripts/backup.py` produces a restorable copy.

- **Never run migrations on production data without a fresh verified
  snapshot** first (`alembic upgrade head` is destructive in some upgrades).
  The backup script refuses databases on other revisions: run
  `alembic upgrade head` in a stopped backend before backing up.
- CA private key/state recovery lives in deployment documentation
  (`docs/DEPLOYMENT.md`), separate from these database snapshots.
- Drill at least **monthly and before every upgrade**: backup → restore into
  the recovery stack → login → totals match → delete pre-restore archives.

## Disposable recovery evidence

On 2026-09-20, the host scripts ran against an isolated production-shaped
Compose database, never the repository's `data/budget.db`. A backup completed
while the primary service was available; a verified snapshot contained the
expected `0005_budgets` revision and two accounts, including a write made
before the verified run.

Restore into a separate recovery data mount produced:

```text
revision=0005_budgets
sessions=0
transactions=1
budgets=[(1,5000)]
```

The recovery HTTPS stack then rejected the old primary cookie with `401`.
Fresh login read the restored dashboard values, and a new recovery transaction
returned `201`. Primary and recovery containers were recreated with their
isolated data mounts intact; all disposable containers, volumes, snapshots and
screenshots were removed after verification.

This proves the reachable local drill only. The actual server scheduler,
permissions, off-host retention, client CA trust and production restore remain
operator release gates.
