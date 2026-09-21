# MVP Readiness Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when executing genuinely independent slices; otherwise execute inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 11 open findings from the 2026-09-20 MVP readiness review (`docs/DEPLOYMENT.md` §13) — restore/backup safety defects, trusted-host wildcard acceptance, settings-page accessibility/UX gaps, and invalid deployment documentation — without adding new features.

**Architecture:** Root-cause fixes in the existing files only: `scripts/backup.py`, `scripts/restore.py` (shared stdlib helpers, restore imports from backup), `backend/app/config.py`, the Angular settings page, and the deployment/backup docs. No new services, frameworks, migrations or runtime dependencies. This is the M6 correction pass the review calls for — not a feature milestone.

**Tech Stack:** Python 3.13+ stdlib (sqlite3, argparse, tempfile, os, stat, time), FastAPI/Pydantic Settings (backend validation), Angular 22 signals + Reactive Forms, Vitest, pytest (subprocess script tests), Docker Compose v2.

## Global Constraints

- Findings and closure criteria are authoritative: `docs/DEPLOYMENT.md` §13 (lines 283–431). Approved contracts being restored: M6 plan `docs/superpowers/plans/2026-09-19-settings-export-operations.md` §2.4 (restore safety), Task 6.1 (settings/profile contracts).
- Scripts remain **stdlib-only** and importable: `restore.py` already does `from backup import create_snapshot`; extend that import for shared constants/helpers.
- Migration head stays `0005_budgets`. No new tables, no schema changes.
- Required tables (from migrations 0002–0005): `users, households, household_members, sessions, accounts, categories, transactions, budgets` (plus `alembic_version`).
- POSIX-only behavior (chown, fsync-dir, symlink tests) must be guarded with `os.name != "nt"`; the dev host is Windows, so those tests skip locally and their real-host proof stays in §11.
- Never touch `data/budget.db` or the real `.env`. Tests use `tmp_path` scratch DBs only (existing `make_migrated_db` pattern).
- **Commit gate:** the M6 work is uncommitted working-tree changes and the handoff docs do not authorize commits — each task's commit step runs only after the user authorizes committing in this session.
- Keep runtime-reproduced findings distinct from source-reviewed risks when recording closure evidence in §13.

## File Map

| File | Change |
|---|---|
| `backend/app/config.py` | Reject `*` anywhere in a trusted host |
| `backend/tests/test_config.py` | Wildcard-alongside-exact regression case |
| `scripts/backup.py` | Staged-snapshot FK + required-table validation, symlink rejection, wall-clock deadline, fsync publication |
| `scripts/restore.py` | Alias/symlink rejection, private target-filesystem staging, ownership preservation, unique preservation names, corrupt-target abort, fsync |
| `backend/tests/test_backup_restore.py` | New regression tests; fix full-drill corrupt-target expectation |
| `frontend/src/app/features/settings/settings.page.ts` | Profile success announcement, Blob error decoding |
| `frontend/src/app/features/settings/settings.page.html` | Password field errors/associations, profile live region, date inputs outside selector branch, export feedback associations |
| `frontend/src/app/features/settings/settings.page.spec.ts` | Fix misnamed/weak tests; add regression cases |
| `docs/BACKUP_RESTORE.md` | Recovery-stack isolation rewrite, ordering, permissions text, off-host scope correction |
| `docs/DEPLOYMENT.md` | §2 binding example, §13 closure records |
| `docs/tailscale-policy.example.json` | Remove reversed host alias |
| `docker-compose.recovery.yml` | New: isolated data mount for the recovery drill |

Task order: 1 (config) and 4 (frontend) are independent. 2 → 3 share script helpers. 5 (docs) records 2/3 behavior. 6 verifies everything.

---

### Task 1: Reject wildcard trusted hosts even alongside an exact host (Finding 5)

**Files:**
- Modify: `backend/app/config.py:132-152` (`_is_exact_trusted_host`)
- Test: `backend/tests/test_config.py:163-186` (parametrize list)

**Interfaces:**
- Consumes: existing `Settings.validate_production_trusted_hosts` (unchanged).
- Produces: `_is_exact_trusted_host(host: str) -> bool` that rejects any `*` in the host.

Root cause: `urlsplit("https://*.example.internal")` returns `hostname == "*.example.internal"`, so the `parsed.hostname != host.lower()` check passes. The origin checker rejects `*` in hostnames (line 119); the host checker does not.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_config.py`, extend the parametrize list of `test_production_rejects_invalid_trusted_hosts` (line 163) with the reproduced case — a separate exact host satisfying origin matching does **not** excuse the extra wildcard:

```python
        ["*.example.internal"],
        # Reproduced blocker: extra wildcard alongside the required exact host.
        ["budget.example.internal", "*.example.internal"],
        ["budget.example.internal", "*"],
```

(`["*.example.internal"]` and `["*"]` already exist in the list; the new rows are the mixed ones.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_config.py -k invalid_trusted_hosts -q`
Expected: FAIL — the two mixed rows construct `Settings` successfully today.

- [ ] **Step 3: Fix `_is_exact_trusted_host`**

In `backend/app/config.py`, `_is_exact_trusted_host`, add a `*` rejection next to the existing character checks (after line 137's `any(char in host ...)` check, or folded into it):

```python
def _is_exact_trusted_host(host: str) -> bool:
    if (
        not host
        or host != host.strip()
        or not host.isascii()
        or "*" in host
        or any(char in host for char in "/:?@#")
    ):
        return False
```

(Remove `"*"` from the `host in {"*", ...}` set membership test on line 140 — it is now unreachable; keep the loopback names.)

- [ ] **Step 4: Run the full config suite**

Run: `cd backend && python -m pytest tests/test_config.py -q`
Expected: PASS, including all prior trusted-host cases (they already reject URLs, paths, loopback, whitespace).

- [ ] **Step 5: Commit** (after user authorizes commits)

```bash
git add backend/app/config.py backend/tests/test_config.py
git commit -m "fix: reject wildcard patterns in production TRUSTED_HOSTS alongside exact hosts"
```

---

### Task 2: Harden backup verification, path safety, deadline and publication (Finding 4)

**Files:**
- Modify: `scripts/backup.py`
- Test: `backend/tests/test_backup_restore.py`

**Interfaces:**
- Produces (consumed by Task 3):
  - `REQUIRED_TABLES: tuple[str, ...]` module constant in `backup.py`.
  - `_verify_snapshot(conn: sqlite3.Connection, label: str) -> None` — raises `RuntimeError` on integrity/revision/table/FK failure of an open snapshot connection.
  - `_fsync_file(path: Path) -> None` and `_fsync_dir(path: Path) -> None` (dir is a no-op on Windows).

Current defects: revision-only DB publishes (no required-table check), FK checked on the source connection only, no symlink rejection, the progress deadline counts handler invocations (not wall-clock), no fsync at publication.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_backup_restore.py` (after `test_backup_keep_days_must_be_positive`):

```python
def _make_revision_only_db(db_path: Path) -> Path:
    """DB whose only table is alembic_version at head — not a Budget DB."""
    assert not db_path.exists()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        conn.execute("INSERT INTO alembic_version VALUES (:v)", {"v": HEAD_REVISION})
        conn.commit()
    finally:
        conn.close()
    return db_path


def test_backup_rejects_revision_only_database(tmp_path, destinations):
    """Reproduced blocker: alembic_version=0005 alone must not publish."""
    dud = _make_revision_only_db(tmp_path / "budget.db")
    result = run_script(BACKUP_SCRIPT, "--database", dud,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode != 0
    assert budget_snapshots(destinations) == []
    leftovers = [p for p in destinations.iterdir() if p.is_file()]
    assert leftovers == []


def test_backup_rejects_missing_required_table(seeded, destinations):
    """Migrated head revision but budgets table dropped -> refuse."""
    conn = sqlite3.connect(seeded)
    try:
        conn.execute("DROP TABLE budgets")
        conn.commit()
    finally:
        conn.close()
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode != 0
    assert budget_snapshots(destinations) == []


@pytest.mark.skipif(os.name == "nt", reason="symlink privileges; real-host POSIX check stays open")
def test_backup_rejects_symlink_source(seeded, destinations, tmp_path):
    link = tmp_path / "linked.db"
    link.symlink_to(seeded)
    result = run_script(BACKUP_SCRIPT, "--database", link,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode != 0
    assert "symlink" in result.stderr.lower()
    assert budget_snapshots(destinations) == []


@pytest.mark.skipif(os.name == "nt", reason="symlink privileges; real-host POSIX check stays open")
def test_backup_rejects_symlink_destination(seeded, tmp_path):
    real_dest = tmp_path / "real-backups"
    real_dest.mkdir()
    link = tmp_path / "linked-backups"
    link.symlink_to(real_dest)
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", link, "--keep-days", "30")
    assert result.returncode != 0
    assert "symlink" in result.stderr.lower()
    assert list(real_dest.iterdir()) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_backup_restore.py -k "revision_only or missing_required or symlink" -q`
Expected: `test_backup_rejects_revision_only_database` and `test_backup_rejects_missing_required_table` FAIL (returncode 0 today); symlink tests SKIP on Windows.

- [ ] **Step 3: Implement in `scripts/backup.py`**

Add imports `stat` is not needed here; add `time` to the import list. Then:

```python
REQUIRED_TABLES = (
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
    rev = conn.execute("SELECT version_num FROM alembic_version").fetchone()
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
    fd = os.open(path, os.O_RDONLY)
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
```

In `create_snapshot`, after the `resolve()` calls (line 38):

```python
    _reject_symlinks(("--database", Path(args_database_unresolved)) ...)
```

Note: `resolve()` erases symlink information, so reject on the **unresolved** arguments. Change `create_snapshot` to check before resolving — cleanest is to do the symlink check in `main()` on `args.database` / `args.destination` before calling `create_snapshot` (keeps `create_snapshot(database, destination)` importable for restore, which passes its own already-verified paths):

```python
    # in main(), after parsing, before create_snapshot:
    _reject_symlinks(
        ("--database", args.database), ("--destination", args.destination)
    )
```

Replace the source validation block (lines 44–65) with `_verify_snapshot` on the source connection (keeping the friendlier "run alembic upgrade head" message is not required — the unified message is fine), and replace the staged verify block (lines 97–106) with:

```python
        verify = sqlite3.connect(tmp_path)
        try:
            _verify_snapshot(verify, "staged snapshot")
        finally:
            verify.close()
```

Replace the invocation-count deadline (lines 81–87) with a wall-clock bound:

```python
            deadline = time.monotonic() + BACKUP_DEADLINE_SECONDS

            def _progress() -> int:
                return -1 if time.monotonic() >= deadline else 0

            src.set_progress_handler(_progress, 1)
```

Add durable publication before/after the `os.replace` (line 116):

```python
        _fsync_file(tmp_path)
        os.replace(tmp_path, target)
        _fsync_dir(destination)
```

Update the module docstring: staged validation now includes foreign-key and required-table checks on the completed snapshot; publication is fsynced.

- [ ] **Step 4: Run the backup test suite**

Run: `cd backend && python -m pytest tests/test_backup_restore.py -q`
Expected: PASS — all existing tests (row match, retention, live writer, unique names, failure cleanliness) plus the new rejections. The live-writer test still passes because staging beside the destination is unchanged.

- [ ] **Step 5: Commit** (after user authorizes commits)

```bash
git add scripts/backup.py backend/tests/test_backup_restore.py
git commit -m "fix: backup validates completed snapshot (FK + required tables), rejects symlinks, bounds busy duration, fsyncs publication"
```

---

### Task 3: Restore safety contract — aliases, staging, ownership, preservation, corrupt-target abort (Findings 2 and 3)

**Files:**
- Modify: `scripts/restore.py` (near-total rewrite of `main`'s body after argparse)
- Test: `backend/tests/test_backup_restore.py` (new tests + fix `test_backup_restore_full_drill`)

**Interfaces:**
- Consumes from Task 2: `from backup import REQUIRED_TABLES, _fsync_dir, _fsync_file, _verify_snapshot` (extend the existing `from backup import create_snapshot` line).
- Produces: same CLI (`--backup`, `--database`, `--confirm`), same exit semantics (0 success, 1 refusal/abort, target untouched on any pre-replacement failure).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_backup_restore.py`:

```python
def test_restore_rejects_identical_paths(seeded, destinations, tmp_path):
    """Reproduced blocker: same file for --backup and --database."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    before = snap.read_bytes()
    result = run_script(RESTORE_SCRIPT, "--backup", snap,
                        "--database", snap, "--confirm")
    assert result.returncode != 0
    assert "same" in result.stderr.lower()
    assert snap.read_bytes() == before, "source snapshot bytes must be preserved"
    conn = sqlite3.connect(f"file:{snap}?mode=ro", uri=True)
    try:
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 1
    finally:
        conn.close()


def test_restore_rejects_aliased_paths(seeded, destinations, tmp_path):
    """Different argument strings resolving to one file (relative path alias)."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    before = snap.read_bytes()
    alias = snap.parent / (".." / snap.parent.name / snap.name)
    result = run_script(RESTORE_SCRIPT, "--backup", snap,
                        "--database", alias, "--confirm")
    assert result.returncode != 0
    assert snap.read_bytes() == before


@pytest.mark.skipif(os.name == "nt", reason="symlink privileges; real-host POSIX check stays open")
def test_restore_rejects_symlink_target(seeded, destinations, tmp_path):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    real = tmp_path / "real-target.db"
    real.write_bytes(b"placeholder")
    link = tmp_path / "linked-target.db"
    link.symlink_to(real)
    result = run_script(RESTORE_SCRIPT, "--backup", snap,
                        "--database", link, "--confirm")
    assert result.returncode != 0
    assert "symlink" in result.stderr.lower()
    assert link.is_symlink() and real.read_bytes() == b"placeholder"


def test_restore_corrupt_target_aborts_without_replacement(seeded, destinations, tmp_path):
    """Approved contract: corrupt target -> safe abort, never raw-copy/replace."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"SQLite format 3\x00broken-payload" * 4)
    before = corrupt.read_bytes()
    result = run_script(RESTORE_SCRIPT, "--backup", snap,
                        "--database", corrupt, "--confirm")
    assert result.returncode != 0
    assert corrupt.read_bytes() == before, "corrupt target must be retained untouched"


def test_restore_preservation_names_unique_same_second(seeded, destinations, tmp_path):
    """Two restores in one second into one directory never overwrite preserves."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    target_a = tmp_path / "existing-a.db"
    target_b = tmp_path / "existing-b.db"
    make_migrated_db_from_copy(seeded, target_a, extra_transactions=0)
    make_migrated_db_from_copy(seeded, target_b, extra_transactions=0)
    for target in (target_a, target_b):
        do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                                "--database", target, "--confirm")
        assert do_restore.returncode == 0, do_restore.stderr
    pres = sorted(tmp_path.glob("budget-pre-restore-*.sqlite"))
    assert len(pres) == 2, "same-second preserves must coexist, not overwrite"
    assert len({p.name for p in pres}) == 2


@pytest.mark.skipif(os.name == "nt", reason="POSIX ownership/mode; real-host check stays open")
def test_restore_preserves_target_mode_and_owner(seeded, destinations, tmp_path):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    target = tmp_path / "owned.db"
    make_migrated_db_from_copy(seeded, target, extra_transactions=0)
    os.chmod(target, 0o640)
    st_before = os.stat(target)
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr
    st_after = os.stat(target)
    assert stat.S_IMODE(st_after.st_mode) == 0o640
    assert (st_after.st_uid, st_after.st_gid) == (st_before.st_uid, st_before.st_gid)


def test_restore_stages_privately_on_target_filesystem(seeded, destinations, tmp_path):
    """Staging dir lives beside the target (same filesystem), mode 0o700."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    target_dir = tmp_path / "target-fs"
    target_dir.mkdir()
    target = target_dir / "budget.db"

    seen: dict[str, object] = {}

    def watch_staging() -> None:
        import time as _t
        deadline = _t.time() + 15
        while _t.time() < deadline:
            dirs = list(target_dir.glob(".budget-restore-*"))
            if dirs:
                seen["dir"] = dirs[0]
                return
            _t.sleep(0.01)

    watcher = threading.Thread(target=watch_staging)
    watcher.start()
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    watcher.join()
    assert do_restore.returncode == 0, do_restore.stderr
    assert "dir" in seen, "restore must stage beside the target, not in system temp"
    if os.name != "nt":
        assert stat.S_IMODE(os.stat(seen["dir"]).st_mode) == 0o700
    assert not list(target_dir.glob(".budget-restore-*")), "no staging leftovers"
```

Add `import stat` to the test file's imports.

**Also fix the existing contradicting test** — `test_backup_restore_full_drill` (line 548) currently expects a corrupt target to be replaced successfully. Replace its corrupt-target section:

```python
def test_backup_restore_full_drill(seeded, destinations, tmp_path):
    """Sanity drill: backup, damage, restore, verify rows."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    target = tmp_path / "rescued.db"
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr
    conn = sqlite3.connect(target)
    try:
        assert conn.execute("SELECT count(*) FROM transactions"
                            ).fetchone()[0] == 1
    finally:
        conn.close()
```

(The corrupt-target abort is now covered by `test_restore_corrupt_target_aborts_without_replacement`; drop the `corrupt-then-restored.db` lines from the drill.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_backup_restore.py -k "restore" -q`
Expected: new alias/corrupt/unique/staging tests FAIL against current code (same-path restore currently succeeds; corrupt target currently gets raw-copied and replaced; second-resolution preserve names can collide; staging is `/tmp/budget-tracker-restores`). `test_backup_restore_full_drill` FAILs until Step 3 makes corrupt-target abort real (it currently asserts success on a corrupt target — that assertion must already be replaced per Step 1).

- [ ] **Step 3: Implement in `scripts/restore.py`**

Update the docstring contract (staging beside target, private 0700, ownership preserved, corrupt target aborts, unique preserve names, fsync publication). Extend the import:

```python
from backup import _fsync_dir, _fsync_file, _verify_snapshot, create_snapshot
```

Add helpers:

```python
import stat


def _reject_unsafe_paths(backup_arg: Path, database_arg: Path) -> tuple[Path, Path]:
    """Resolve args, refusing symlinks, aliases and identical source/target."""
    for label, path in (("--backup", backup_arg), ("--database", database_arg)):
        if path.is_symlink():
            raise RuntimeError(f"{label} must not be a symlink: {path}")
    backup = backup_arg.resolve()
    database = database_arg.resolve()
    if backup == database:
        raise RuntimeError(
            "--backup and --database must be different files"
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
```

Rewrite `main`'s body after the `--confirm` check:

```python
    backup, database = _reject_unsafe_paths(args.backup, args.database)
    staged: Path | None = None
    staging_dir: Path | None = None
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
```

Keep the existing `notes`/`print` success block and the `except`/`finally` structure; the `finally` must clean the staging **directory**:

```python
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)
        if staging_dir is not None:
            shutil.rmtree(staging_dir, ignore_errors=True)
```

Notes on `os.chown`: it does not exist on Windows — the `os.name != "nt"` guard covers it. `os.chown` to the *previous target's own* uid/gid needs no privileges when run as that user or root; a permission failure aborts the restore before replacement, which is the approved preserve-or-abort behavior.

- [ ] **Step 4: Run the full script test suite**

Run: `cd backend && python -m pytest tests/test_backup_restore.py -q`
Expected: PASS — existing drills (`test_restore_writes_sessions_empty_transactions_kept`, `test_restore_snapshot_pre_restore_content`, `test_restore_concurrent_writes_during_copy`, `test_restore_preserves_snapshot_bytes`, refusal tests) plus all new tests. `test_restore_snapshot_pre_restore_content` still passes because preservation still uses `create_snapshot` and lands as `budget-pre-restore-<UTC>.sqlite` next to the target.

- [ ] **Step 5: Commit** (after user authorizes commits)

```bash
git add scripts/restore.py backend/tests/test_backup_restore.py
git commit -m "fix: restore meets safety contract - reject aliases/symlinks, private target-fs staging, preserved ownership, unique preserves, corrupt-target abort"
```

---

### Task 4: Settings page — password field errors, profile announcement, Blob error decoding, independent date export (Findings 8–11)

**Files:**
- Modify: `frontend/src/app/features/settings/settings.page.ts`
- Modify: `frontend/src/app/features/settings/settings.page.html`
- Test: `frontend/src/app/features/settings/settings.page.spec.ts`

**Interfaces:**
- Consumes: backend error envelope `{ error: { code, message, fields?: Record<string, string> } }` (see `backend/app/errors.py`).
- Produces: `profileAnnouncement = signal<string | null>(null)`; `private async decodeBlobError(error: unknown): Promise<string | null>`; date inputs rendered unconditionally in the Data card.

- [ ] **Step 1: Write the failing tests**

Replace/extend in `frontend/src/app/features/settings/settings.page.spec.ts`:

Fix the misnamed date-only test (current line 217 test only checks unfiltered export — it must check **date-only** export and the date inputs surviving selector failure):

```ts
  it("selector failure still leaves date-only export usable with date inputs visible", () => {
    http.expectOne("/api/household").flush(householdDetails);
    const accountsRequest = http.expectOne((r) => r.url === "/api/accounts");
    accountsRequest.flush(
      { error: { code: "CONFLICT", message: "The calculated amount exceeds the supported range." } },
      { status: 409, statusText: "Conflict" },
    );
    http.expectOne((r) => r.url === "/api/categories").flush(categories);
    fixture.detectChanges();
    expect(root.textContent).toContain("Could not load account and category filters.");
    // Date inputs live outside the selector ready branch.
    const fromDate = input("#export-from");
    expect(fromDate).toBeTruthy();
    const dataCard = [...root.querySelectorAll("section")].find((el) =>
      el.textContent?.includes("Download this household's transactions"),
    )!;
    expect(button("Retry", dataCard).disabled).toBeFalsy();
    expect(button("Download CSV").disabled).toBeFalsy();
    fromDate.value = "2026-09-01";
    fromDate.dispatchEvent(new Event("change", { bubbles: true }));
    fixture.detectChanges();
    button("Download CSV").click();
    const exportRequest = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    expect(exportRequest.request.params.get("from")).toBe("2026-09-01");
    expect(exportRequest.request.params.get("accountId")).toBeNull();
    exportRequest.flush(new Blob(["date,description\r\n"], { type: "text/csv" }));
    fixture.detectChanges();
    expect(root.textContent).toContain("Download started.");
  });
```

Fix the Blob-decoding test (current line 286 supplies a `ProgressEvent`, not a JSON Blob — flush a real JSON Blob with a 422 status so `error.error` is a Blob):

```ts
  it("decodes a JSON error Blob into message and field explanations without downloading", async () => {
    readyHousehold();
    button("Download CSV").click();
    const request = http.expectOne((r) => r.url === "/api/export/transactions.csv");
    request.flush(
      new Blob([JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request could not be processed.",
          fields: { from: "Year must be between 1900 and 2100." },
        },
      })], { type: "application/json" }),
      { status: 422, statusText: "Unprocessable Entity" },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain("The request could not be processed.");
    expect(root.textContent).toContain("Year must be between 1900 and 2100.");
    expect(root.textContent).not.toContain("Download started.");
    expect(button("Download CSV").disabled).toBeFalsy();
    // Export feedback is associated with the controls.
    expect(root.querySelector("#download-csv")!.getAttribute("aria-describedby")).toContain("export-error");
  });
```

New password-field test (Finding 8 — short matching passwords must produce identified, associated errors):

```ts
  it("identifies required/length password errors per field without submitting", () => {
    readyHousehold();
    type("#settings-current-password", "");
    type("#settings-new-password", "short");
    type("#settings-confirm-password", "short");
    button("Change password").click();
    fixture.detectChanges();
    http.expectNone((r) => r.url === "/api/auth/change-password");
    const current = input("#settings-current-password");
    const next = input("#settings-new-password");
    expect(current.getAttribute("aria-invalid")).toBe("true");
    expect(next.getAttribute("aria-invalid")).toBe("true");
    expect(current.getAttribute("aria-describedby")).toContain("current-password-error");
    expect(next.getAttribute("aria-describedby")).toContain("new-password-error");
    expect(root.querySelector("#current-password-error")!.textContent).toContain("at least 12 characters");
    expect(root.querySelector("#new-password-error")!.textContent).toContain("12 to 1024 characters");
  });
```

New profile announcement test (Finding 9):

```ts
  it("announces successful profile save in the status live region", () => {
    readyHousehold();
    type("#settings-display-name", "Merlin Renamed");
    button("Save profile").click();
    const request = http.expectOne((r) => r.method === "PATCH");
    request.flush({ id: 1, username: "merlin", displayName: "Merlin Renamed" });
    fixture.detectChanges();
    const live = root.querySelector<HTMLElement>("#profile-status")!;
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain("Profile saved.");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --watch=false -- settings.page`
Expected: the four new/changed tests FAIL (no `#profile-status` region, no per-field password errors, date inputs missing when selectors error, Blob errors produce only the fallback message).

- [ ] **Step 3: Fix the template** (`settings.page.html`)

Profile card — give the success live region an id and content (replace the empty `<p>` at line 30):

```html
      @if (profileError(); as message) {
        <p id="profile-error" class="message error" role="alert" aria-live="assertive">{{ message }}</p>
      } @else {
        <p id="profile-status" class="message success" role="status" aria-live="polite">{{ profileAnnouncement() ?? "" }}</p>
      }
```

Password card — render per-field hints and fix associations (replace lines 38–79):

- current-password input: `aria-describedby="current-password-error password-error-summary"`, `aria-invalid` driven by `passwordFieldHint('currentPassword')`.
- new-password input: `aria-describedby="new-password-error new-password-hint"`, `[attr.aria-invalid]="passwordFieldHint('newPassword') ? 'true' : null"`, and add the missing error paragraph:

```html
        <p id="new-password-error" class="field-error" aria-live="polite">
          {{ passwordFieldHint("newPassword") ?? "" }}
        </p>
```

- current-password field gets its own hint paragraph (server `passwordFieldError` stays in the summary at the form level):

```html
        <p id="current-password-error" class="field-error" aria-live="polite">
          {{ passwordFieldHint("currentPassword") ?? "" }}
        </p>
```

Keep `#password-error-summary` for the server message. Note `passwordFieldHint` returns `null` until touched; the submit handler already calls `markAllAsTouched()`.

Data card — move the two date fields **out** of the selector `@switch` so they always render; only account/category selects stay in the `ready` branch, and associate export feedback:

```html
    <div class="filters">
      <div class="field">
        <label for="export-from">From date</label>
        <input id="export-from" type="date" (change)="applyFilter('from', $any($event.target).value)" [value]="filters().from ?? ''" [disabled]="downloading()" aria-describedby="export-error" />
      </div>
      <div class="field">
        <label for="export-to">To date</label>
        <input id="export-to" type="date" (change)="applyFilter('to', $any($event.target).value)" [value]="filters().to ?? ''" [disabled]="downloading()" aria-describedby="export-error" />
      </div>
      @let selectorView = selectorState();
      @switch (selectorView.kind) {
        @case ("loading") { <p role="status" aria-live="polite">Loading filters…</p> }
        @case ("error") {
          <p class="message error" role="alert">{{ selectorView.message }}
            <button type="button" (click)="retrySelectors()" [disabled]="downloading()">Retry</button>
          </p>
        }
        @case ("ready") {
          <div class="field">
            <label for="export-account">Account</label>
            <select id="export-account" (change)="applyFilter('accountId', $any($event.target).value)" [value]="filters().accountId ?? ''" [disabled]="downloading()">
              <option value="">All accounts</option>
              @for (account of selectorView.accounts; track account.id) {
                <option [value]="account.id">{{ account.name }} @if (account.isArchived) { (archived) }</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="export-category">Category</label>
            <select id="export-category" (change)="applyFilter('categoryId', $any($event.target).value)" [value]="filters().categoryId ?? ''" [disabled]="downloading()">
              <option value="">All categories</option>
              @for (category of selectorView.categories; track category.id) {
                <option [value]="category.id">{{ category.name }} @if (category.isArchived) { (archived) }</option>
              }
            </select>
          </div>
        }
      }
    </div>
    <button id="download-csv" type="button" (click)="downloadCsv()" [disabled]="downloading()" aria-describedby="export-error">
      {{ downloading() ? "Downloading…" : "Download CSV" }}
    </button>
```

(The existing `export-error` paragraph and `exportAnnouncement` region below stay unchanged.)

- [ ] **Step 4: Fix the component** (`settings.page.ts`)

Add the announcement signal next to `exportAnnouncement`:

```ts
  readonly profileAnnouncement = signal<string | null>(null);
```

In `saveProfile`: clear it on entry (`this.profileAnnouncement.set(null);` next to `this.profileError.set(null)`) and set it on success (in the `next` handler, next to `this.profileError.set(null)`):

```ts
          this.profileAnnouncement.set("Profile saved.");
```

In `downloadCsv`'s `error` handler, decode Blob bodies before falling back:

```ts
        error: (error: unknown) => {
          if (this.destroyRef.destroyed) return;
          this.downloading.set(false);
          void this.decodeBlobError(error).then((decoded) => {
            if (this.destroyRef.destroyed) return;
            this.exportError.set(
              decoded ?? this.errorMessage(error, "Could not download the CSV."),
            );
          });
        },
```

Add the decoder (shared envelope shape from `backend/app/errors.py`):

```ts
  private async decodeBlobError(error: unknown): Promise<string | null> {
    if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
      return null;
    }
    try {
      const parsed = JSON.parse(await error.error.text()) as {
        error?: { message?: unknown; fields?: Record<string, unknown> };
      };
      const message = parsed.error?.message;
      if (typeof message !== "string") return null;
      const explanations = Object.values(parsed.error?.fields ?? {})
        .filter((v): v is string => typeof v === "string");
      return explanations.length
        ? `${message} ${explanations.join(" ")}`
        : message;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 5: Run the settings spec, then the whole frontend suite**

Run: `cd frontend && npm test -- --watch=false -- settings.page`
Expected: PASS (new + corrected tests, plus all existing ones — the old "selector overflow" assertions about the retry button and unfiltered download remain valid inside the corrected test).

Run: `cd frontend && npm test -- --watch=false`
Expected: PASS (71+ tests, count grows with the new cases).

- [ ] **Step 6: Commit** (after user authorizes commits)

```bash
git add frontend/src/app/features/settings/settings.page.ts frontend/src/app/features/settings/settings.page.html frontend/src/app/features/settings/settings.page.spec.ts
git commit -m "fix: settings page per-field password errors, profile save announcement, Blob error decoding, selector-independent date export"
```

---

### Task 5: Deployment documentation — recovery isolation, binding, Tailscale alias, scope statements (Findings 1, 6, 7)

**Files:**
- Create: `docker-compose.recovery.yml`
- Modify: `docs/BACKUP_RESTORE.md` (recovery stack section lines 159–187, permissions lines 145–157, validation claims lines 41–43, scope line 227)
- Modify: `docs/DEPLOYMENT.md` (§2 lines 46, 71; release-hold note lines 9–12)
- Modify: `docs/tailscale-policy.example.json`

**Interfaces:**
- Consumes: Task 2/3 script behavior (staged FK/table validation, ownership preservation, corrupt-target abort).
- Produces: a recovery drill that resolves to an isolated data directory and runs restore → migrate → start in that order.

- [ ] **Step 1: Create `docker-compose.recovery.yml`** (root)

The base `docker-compose.yml` hardcodes `./data:/app/data`; Compose merges `volumes` keyed by container path, so this override rebinding is the minimal fix:

```yaml
# Recovery-only override: isolate the backend's data directory from the
# production ./data bind mount. Use with a separate project name, e.g.
#   docker compose -p budget-recovery -f docker-compose.yml \
#     -f docker-compose.recovery.yml --env-file .env.recovery ...
services:
  backend:
    volumes:
      - ./recovery-data:/app/data
```

- [ ] **Step 2: Verify the override resolves to an isolated mount**

Run: `docker compose -p budget-recovery-test -f docker-compose.yml -f docker-compose.recovery.yml config --format json | python -c "import json,sys; c=json.load(sys.stdin); print([v['source'] for v in c['services']['backend']['volumes']])"`
Expected: output contains the checkout's `recovery-data` directory (absolute), **not** the checkout's `data` directory. Then remove the probe: `docker compose -p budget-recovery-test down` (nothing was started; `config` only renders).

- [ ] **Step 3: Rewrite the recovery-stack section in `docs/BACKUP_RESTORE.md`** (lines 159–187)

Replace with restore-before-start ordering and the override file:

```markdown
### Recovery stack (separate from production)

Drill restores into a **separate Compose project with its own data directory** —
never the production project, and never `down -v` on production volumes. The
base `docker-compose.yml` binds `./data`; the `docker-compose.recovery.yml`
override rebinds the backend volume to `./recovery-data` so the recovery stack
can never touch production data.

```text
# one-time setup: isolated recovery env and data directory
mkdir recovery-data
cp .env .env.recovery            # then edit .env.recovery for the recovery host values

# 1. Restore the snapshot into the recovery data directory FIRST, offline:
python <repo>/scripts/restore.py --backup <absolute-snapshot-path> --database <repo>/recovery-data/budget.db --confirm

# 2. Then run migrations with a one-shot container and check the revision:
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery run --rm backend alembic upgrade head
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery run --rm backend alembic current

# 3. Only then start the recovery backend:
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery up -d backend
```

Verify isolation before every drill: the resolved config must bind
`recovery-data`, not `data`:

```text
docker compose -p budget-recovery -f docker-compose.yml -f docker-compose.recovery.yml --env-file .env.recovery config | grep -A3 volumes
```
```

Keep the proof drill (steps 1–5 at lines 177–187) but point its "Start the recovery backend" step at the override-based command above.

- [ ] **Step 4: Correct the remaining `BACKUP_RESTORE.md` statements**

- Line 227 ("actual server scheduler, permissions, **off-host retention** ... remain operator release gates"): off-host retention is **not** a release gate — approved M6 plan §2.4 requires 30-calendar-day retention only. Reword to: "The actual server scheduler, permissions, client CA trust and production restore remain operator release gates. Off-host/weekly/monthly retention tiers are post-MVP, not a gate."
- Lines 41–43 (backup behavior claims): after Task 2 the claims are true — extend to also state required-table and staged foreign-key checks on the **completed snapshot**.
- Lines 145–157 (restore permissions): the restore now preserves the previous target's owner UID/GID and mode automatically (POSIX); delete the "run `chown 10001:10001` after a restore" instruction and replace with: "Restore preserves the previous target's owner and mode; a restore into a directory the service user cannot read/write aborts before replacement." Keep the Windows NTFS-ACL sentence.
- The pre-restore preservation bullet (lines 145–148): add that same-second collisions never overwrite (unique names) and that a **corrupt target aborts** the restore and is retained untouched for manual recovery (no raw-copy fallback).

- [ ] **Step 5: Fix `docs/DEPLOYMENT.md` §2 binding (Finding 6)**

- Line 46 table row → `| HTTPS_BIND_ADDRESS | the single host address Caddy publishes HTTPS on | intended LAN or tailnet address, never 0.0.0.0 for convenience |`
- Line 71 example → `HTTPS_BIND_ADDRESS=192.168.1.10` (one address).
- Add after the env block:

```markdown
To publish HTTPS on more than one interface (e.g. LAN + tailnet), do not
comma-separate `HTTPS_BIND_ADDRESS` — a single Compose port mapping accepts
one address. Add an override file with one explicit mapping per address and
verify the resolved config:

```yaml
# docker-compose.multi-bind.yml
services:
  caddy:
    ports:
      - "192.168.1.10:443:443"
      - "100.90.50.6:443:443"
```

```text
docker compose -f docker-compose.yml -f docker-compose.multi-bind.yml config
```
```

- Update the release-hold note (lines 9–12): remove "Do not follow the comma-separated binding example in §2" once §2 no longer contains it (keep the pointer to §13).

- [ ] **Step 6: Fix `docs/tailscale-policy.example.json`** (Finding 7)

The `hosts` entry maps IP → alias (reversed) and nothing references the alias. Delete the `hosts` block entirely (grants use tags):

```json
{
	"groups": {
		"group:household": ["household-user@example.com"]
	},
	"tagOwners": {
		"tag:budget": ["autogroup:admin"]
	},
	"grants": [
		{
			"src": ["group:household"],
			"dst": ["tag:budget"],
			"ip": ["tcp:443"]
		},
		{
			"src": ["group:household"],
			"dst": ["tag:emby"],
			"ip": ["tcp:8096"]
		}
	],
	"tests": [
		{
			"action": "accept",
			"src": "household-user@example.com",
			"accept": ["tag:budget:443"]
		}
	]
}
```

Validate it parses: `python -c "import json; json.load(open('docs/tailscale-policy.example.json'))"`.

- [ ] **Step 7: Commit** (after user authorizes commits)

```bash
git add docker-compose.recovery.yml docs/BACKUP_RESTORE.md docs/DEPLOYMENT.md docs/tailscale-policy.example.json
git commit -m "docs: isolated recovery override, single-address binding guidance, corrected tailscale example and retention scope"
```

---

### Task 6: Full verification and §13 closure records

**Files:**
- Modify: `docs/DEPLOYMENT.md` §13 (lines 283–431)
- Modify: `state.md` (reconcile overstated completion per §13 preamble)

- [ ] **Step 1: Run the complete suites**

```text
cd backend && python -m pytest
cd frontend && npm test -- --watch=false
cd frontend && npm run build
```

Expected: all PASS. Record exact counts. (Playwright's 16 scenarios are unaffected by these changes but re-run `npx playwright test` if the settings page is covered there — it is; run it.)

- [ ] **Step 2: Record closure evidence in `docs/DEPLOYMENT.md` §13**

For each finding 1–11: check the box, and under it add one line of corrective evidence — the test name(s) that now fail on the old behavior, the config probe, or the doc diff. Keep the distinction the review demands: findings 5, 8, 9, 10, 11 were runtime-reproduced (cite the corrected regression test); findings 1, 3, 4, 6, 7 are doc/source corrections (cite the diff and the compose/config validation); finding 2 was reproduced (cite `test_restore_rejects_identical_paths`).

Leave the §11 real-host rows and the "user release review" step open — those need the actual host, and this plan does not close them.

- [ ] **Step 3: Reconcile `state.md`**

Update the M6 status to "correction pass applied 2026-09-20; findings 1–11 closed with repository evidence; real-host deployment gates remain open" — replacing the earlier "only external deployment gates remain" overstatement.

- [ ] **Step 4: Commit** (after user authorizes commits)

```bash
git add docs/DEPLOYMENT.md state.md
git commit -m "docs: record MVP readiness finding closures with evidence; reconcile state"
```

---

## Self-Review

**Spec coverage** — findings → tasks: 1→Task 5 (Step 3); 2→Task 3; 3→Task 3; 4→Task 2 (+BACKUP_RESTORE claim correction in Task 5 Step 4); 5→Task 1; 6→Task 5 (Step 5); 7→Task 5 (Step 6); 8→Task 4; 9→Task 4; 10→Task 4; 11→Task 4. Test-contract corrections the review named: wildcard-alongside-exact (Task 1), date-only vs unfiltered + Blob-vs-ProgressEvent specs (Task 4 Step 1), corrupt-target replacement expectation (Task 3 Step 1). Scope statement corrections: off-host retention (Task 5 Step 4). Real-host §11 rows explicitly left open (Task 6 Step 2). No feature work added (recurring/import/goals untouched).

**Known ceilings** (deliberate, `ponytail:`-style): symlink/ownership tests skip on Windows — their real-host POSIX proof stays an open §11 row; the backup wall-clock deadline (300 s) has no cheap runtime test (a slow backup can't be simulated deterministically via the subprocess harness) — verified by source review and the unchanged live-writer test. The busy-deadline bound and cross-filesystem `[INFERENCE]` risks from finding 3 are addressed structurally (target-fs staging makes `os.replace` same-volume by construction).

**Type consistency** — `REQUIRED_TABLES`, `_verify_snapshot`, `_fsync_file`, `_fsync_dir` are defined in Task 2 and consumed by name in Task 3; `profileAnnouncement`/`#profile-status` and `decodeBlobError` names match between Task 4's tests and implementation; the recovery override path `./recovery-data` is consistent across Task 5 steps.
