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

Behavior, verified by `backend/tests/test_backup_restore.py`:

- Opens the source with SQLite `mode=ro`; a typo'd path fails instead of
  creating a new empty database (`source database not found`, exit 1).
- Uses `sqlite3.Connection.backup()`, so a **live WAL database** is safe to
  copy while the backend writes (`test_backup_live_writer_snapshot_is_consistent`).
- Validates the source and the **completed standalone staged snapshot** for
  revision `0005_budgets`, `PRAGMA integrity_check`, the required schema
  (`alembic_version` plus the Budget tables `users`, `households`,
  `household_members`, `sessions`, `accounts`, `categories`, `transactions`,
  `budgets`), and `PRAGMA foreign_key_check` before publishing; failures exit
  nonzero and print only path/revision context.
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
- Rejects identical or aliased source/target paths and direct symlink
  arguments before staging or modifying the target; the source snapshot is
  never used as the target.
- Stages a fresh copy from the snapshot, then **deletes every `sessions`
  row** — rotating `SESSION_SECRET` alone does not revoke saved session
  hashes; deleting the rows does
  (`test_restore_writes_sessions_empty_transactions_kept`).
  Historical credentials restored with the data keep their historical
  password state; reset affected accounts offline before reopening access.
- Never edits the source snapshot; its bytes are unchanged after a restore
  (`test_restore_preserves_snapshot_bytes`).
- Preserves a healthy existing target as
  `budget-pre-restore-<UTC timestamp>.sqlite` next to it before replacing it.
  Names are collision-safe, so a same-second restore never overwrites an
  earlier recovery file. If preservation fails, including because the existing
  target is corrupt or cannot pass the completed-snapshot checks, the restore
  aborts before touching the target; retain that corrupt target for manual
  recovery (there is no force-delete or raw-copy fallback).
- Publishes with `os.replace` in the target directory (no delete-then-copy
  window) and removes only the target's obsolete `-wal`/`-shm` sidecars after
  preservation succeeds.
- On POSIX, an existing target's owner UID/GID and mode are applied to the
  restored file before replacement; a new target is mode `0600`. If required
  ownership or destination access cannot be preserved, the restore aborts
  before replacement. On Windows, confidentiality relies on NTFS ACLs, not
  `chmod`; restrict the file to the administrator/service account.
- If publication or post-publication cleanup/durability fails, keep the
  verified source and pre-restore files, leave the backend stopped, and retain
  any recovery directory named by the failure for inspection. Do not restart
  until the retained files and target state have been reviewed.

### Recovery stack (separate from production)

Drill restores into a **separate Compose project and data directory** —
never the production project, never the production `data/` bind mount, and
never `down -v` on production volumes. The base `docker-compose.yml` binds
`./data`; `docker-compose.recovery.yml` requires `RECOVERY_DATA_DIR` and
rebinds `/app/data` to that path. It also uses dedicated Caddy data/config
volumes. Keep the recovery backend and Caddy stopped while preparing the
database.

Create a recovery env file with values that cannot resolve to production:

```text
mkdir recovery-data
cp .env .env.recovery
```

Edit `.env.recovery` before continuing. Keep the normal application variables
and set at least:

```text
APP_ENV=production
RECOVERY_DATA_DIR=<absolute-path-to-recovery-data>
SESSION_SECRET=<new-token_urlsafe(48)-value>
BUDGET_HOST=<recovery-hostname>
ALLOWED_ORIGINS=https://<recovery-hostname>:8444
TRUSTED_HOSTS=<recovery-hostname>
HTTPS_BIND_ADDRESS=127.0.0.1
HTTPS_PORT=8444
```

The recovery project name, env-file flag and both Compose files are part of
every command below. Before touching the recovery database, render and inspect
the effective configuration:

```text
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery config --format json
```

Continue only when the rendered JSON shows exactly one backend bind mount to
`/app/data` whose source equals the absolute path configured in
`RECOVERY_DATA_DIR` (not the checkout's `data/`),
the Caddy service targets `/data` and `/config` through the override's
`recovery_caddy_data`/`recovery_caddy_config` volumes, whose top-level names
are `budget-recovery-caddy-data` and `budget-recovery-caddy-config`, Caddy's
one loopback mapping `127.0.0.1:8444->443`, and no backend host port. If any
value is wrong, stop and fix `.env.recovery` or the override; do not restore
or start anything.

If this recovery project already exists, stop it and verify it is stopped:

```text
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery stop backend caddy
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery ps
```

After the mount inspection, prepare ownership **before creating the new
target**; do not run a root-owned restore into a new target and plan to fix it
with a post-restore `chown`. On POSIX, use a host account whose numeric UID and
GID are both `10001` (the container runtime identity), keep the source copy
private, and run the restore as that account:

```text
# Replace placeholders before running these commands.
SERVICE_ACCOUNT=budget
SNAPSHOT=<absolute-snapshot-path>
RECOVERY_DATA_DIR=<absolute-recovery-data-path>
test "$(id -u "$SERVICE_ACCOUNT")" = 10001
test "$(id -g "$SERVICE_ACCOUNT")" = 10001
sudo install -d -o 10001 -g 10001 -m 700 "$RECOVERY_DATA_DIR"
sudo install -o 10001 -g 10001 -m 600 "$SNAPSHOT" "$RECOVERY_DATA_DIR/.restore-source.sqlite"
sudo -u "$SERVICE_ACCOUNT" -- python <repo>/scripts/restore.py --backup "$RECOVERY_DATA_DIR/.restore-source.sqlite" --database "$RECOVERY_DATA_DIR/budget.db" --confirm
```

The private source copy and any pre-restore/recovery files stay in place until
the drill is accepted. On Windows, there is no POSIX UID mapping to preserve:
use a private NTFS directory, remove inherited broad access, grant the
administrator and the Docker Desktop/engine identity that actually accesses
the bind mount, and verify the one-shot migration can read and write it.
`chmod` alone is not a Windows confidentiality check. For example:

```text
mkdir <absolute-recovery-data-path>
icacls <absolute-recovery-data-path> /inheritance:r /grant:r "<operator-account>":(OI)(CI)F
copy <absolute-snapshot-path> <absolute-recovery-data-path>\.restore-source.sqlite
python <repo>\scripts\restore.py --backup <absolute-recovery-data-path>\.restore-source.sqlite --database <absolute-recovery-data-path>\budget.db --confirm
```

For an existing target, the script preserves its owner UID/GID and mode or
aborts before replacement; a corrupt target is retained for manual recovery.
After these offline restore steps, migrate and inspect the revision with
one-shot containers. Do not start the backend before migration succeeds:

```text
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery run --rm --no-deps backend alembic upgrade head
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery run --rm --no-deps backend alembic current
```

Proceed only when `alembic current` reports `0005_budgets (head)`. Then start
the complete recovery stack and verify the resolved bindings:

```text
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery up -d
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery ps
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery port caddy 443
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery port backend 8000
```

The Caddy command must show only `127.0.0.1:8444`; the backend command must
report no published port. Keep the verified source snapshot and any
pre-restore archive until the drill is accepted. If restore or startup fails,
leave the recovery services stopped and retain the reported recovery files for
inspection; do not fall back to the production project.

Proof drill (executed with scripts/backup.py + scripts/restore.py against a
disposable directory; see backend/tests/test_backup_restore.py::test_backup_restore_full_drill):

1. `python scripts/backup.py --database <db> --destination <dir> --keep-days 30`
2. Render and inspect the recovery Compose configuration as above; do not
   touch the production `data/` directory.
3. Restore with `scripts/restore.py` into the rendered recovery data directory.
4. Run the one-shot migration and `alembic current`; only then start the
   recovery stack.
5. `python -c "import sqlite3; c=sqlite3.connect('<offline-db>'); print(c.execute('SELECT count(*) FROM sessions').fetchone()[0], c.execute('SELECT count(*) FROM transactions').fetchone()[0])"`
   → `0 1` (sessions empty, transactions preserved).
6. Expect old cookies to get **401**, fresh login to read restored values, and
   a subsequent new write to succeed.

## Worth knowing

- **CSV is not backup.** `GET /api/export/transactions.csv` is a user-facing
  spreadsheet export; only `scripts/backup.py` produces a restorable copy.

- **Never run migrations on production data without a fresh verified
  snapshot** first (`alembic upgrade head` is destructive in some upgrades).
  The backup script refuses databases on other revisions: run
  `alembic upgrade head` in a stopped backend before backing up.
- CA private key/state recovery lives in deployment documentation
  (`docs/DEPLOYMENT.md`), separate from these database snapshots.
- Keep **30 calendar days of completed snapshots**. Run a recovery drill before
  upgrades and on the operator's chosen periodic schedule; offsite copies are
  optional and are not an MVP prerequisite.

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
permissions, client CA trust and production restore remain operator release
gates. Off-host/weekly/monthly retention tiers are optional post-MVP work, not
a release gate.
