"""Subprocess regression tests for scripts/backup.py and scripts/restore.py.

The scripts always run via sys.executable so each case exercises the real
CLI. Databases are scratch copies migrated to head (0005_budgets) with the
same alembic pattern used by conftest.test_app.
"""

from __future__ import annotations

import importlib.util
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
BACKUP_SCRIPT = REPO_ROOT / "scripts" / "backup.py"
RESTORE_SCRIPT = REPO_ROOT / "scripts" / "restore.py"

HEAD_REVISION = "0005_budgets"


def run_script(*args: object) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        [sys.executable, str(BACKUP_SCRIPT if False else args[0])]
        + [str(a) for a in args[1:]],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc


def segment_counts(db_path: Path, sql: str, params: dict[str, object]) -> int:
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        with engine.connect() as conn:
            return int(conn.execute(text(sql), params).scalar_one())
    finally:
        engine.dispose()


def make_migrated_db(tmp_path: Path, name: str) -> Path:
    db_path = tmp_path / name
    db_path.parent.mkdir(parents=True, exist_ok=True)
    assert not db_path.exists()
    env_vars = ("APP_ENV", "DATABASE_URL", "TRUSTED_HOSTS",
                "SESSION_SECRET", "ALLOWED_ORIGINS", "SECURE_COOKIES")
    previous = {v: os.environ.get(v) for v in env_vars}
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["TRUSTED_HOSTS"] = "testserver,localhost,127.0.0.1"
    for hidden in ("SESSION_SECRET", "ALLOWED_ORIGINS", "SECURE_COOKIES"):
        os.environ.pop(hidden, None)
    try:
        from app.config import get_settings

        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "migrations"))
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
        # conftest imported app.db, whose module body cached Settings for
        # the in-memory test URL; clear so env.py sees our scratch DB.
        get_settings.cache_clear()
        command.upgrade(cfg, "head")
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()
    return db_path


def seed_budget_data(
    db_path: Path, household_name: str, extra_transactions: int = 0
) -> None:
    """Seed canonical rows directly at the SQL level (users/households/...)."""
    seed_budget_data.seq = getattr(seed_budget_data, "seq", 0)
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    now = "CURRENT_TIMESTAMP"
    password_hash = "argon2id$v=19$m=65536,t=3,p=4$" + "s" * 43
    user_suffix = household_name.lower().replace(" ", "-") + f"-{seed_budget_data.seq}"
    seed_budget_data.seq += 1
    username = f"operator-{user_suffix}"
    display = f"Operator for {household_name}"
    with engine.begin() as conn:
        household_id = conn.execute(
            text("INSERT INTO households (name, created_at, updated_at) "
                 "VALUES (:n, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
            {"n": household_name},
        ).lastrowid
        user_id = conn.execute(
            text("INSERT INTO users (username, display_name, password_hash, "
                 "is_active, created_at, updated_at) VALUES (:u, :d, :p, 1, "
                 "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
            {"u": username, "d": display, "p": password_hash},
        ).lastrowid
        conn.execute(
            text("INSERT INTO household_members (household_id, user_id, role,"
                 " created_at) VALUES (:h, :u, 'owner', CURRENT_TIMESTAMP)"),
            {"h": household_id, "u": user_id},
        )
        account_id = conn.execute(
            text("INSERT INTO accounts (household_id, name, type, "
                 "initial_balance, is_archived, created_at, updated_at) "
                 "VALUES (:h, 'Checking Account', 'checking', 1250, 0, "
                 "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
            {"h": household_id},
        ).lastrowid
        category_id = conn.execute(
            text("INSERT INTO categories (household_id, name, type, "
                 "is_archived, created_at, updated_at) VALUES "
                 "(:h, 'Groceries', 'expense', 0, CURRENT_TIMESTAMP, "
                 "CURRENT_TIMESTAMP)"),
            {"h": household_id},
        ).lastrowid
        conn.execute(
            text("INSERT INTO transactions (household_id, account_id, "
                 "category_id, amount, description, transaction_date, "
                 "created_by_user_id, created_at, updated_at) VALUES "
                 "(:h, :a, :c, -5250, 'Weekly groceries', '2026-09-01', :u, "
                 "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
            {"h": household_id, "a": account_id, "c": category_id,
             "u": user_id},
        )
        if extra_transactions:
            rows: list[dict[str, object]] = []
            for n in range(extra_transactions):
                rows.append({
                    "h": household_id, "a": account_id, "c": category_id,
                    "u": user_id, "n": n,
                })
            conn.execute(
                text("INSERT INTO transactions (household_id, account_id, "
                     "category_id, amount, description, transaction_date, "
                     "created_by_user_id, created_at, updated_at) VALUES "
                     "(:h, :a, :c, -1, :n, '2026-09-02', :u, "
                     "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
                rows,
            )
        conn.execute(
            text("INSERT INTO budgets (household_id, category_id, year, "
                 "month, limit_amount, created_at, updated_at) VALUES "
                 "(:h, :c, 2026, 9, 60000, CURRENT_TIMESTAMP, "
                 "CURRENT_TIMESTAMP)"),
            {"h": household_id, "c": category_id},
        )
        conn.execute(
            text("INSERT INTO sessions (user_id, token_hash, created_at, "
                 "expires_at) VALUES (:u, :t, CURRENT_TIMESTAMP, "
                 "datetime('now', '+30 days'))"),
            {"u": user_id, "t": user_suffix.replace("-", "")[:40] * 2},
        )
    engine.dispose()


@pytest.fixture
def seeded(tmp_path: Path) -> Path:
    db_path = make_migrated_db(tmp_path, "budget.db")
    seed_budget_data(db_path, "Ops", extra_transactions=0)
    return db_path


@pytest.fixture
def destinations(tmp_path: Path) -> Path:
    dest = tmp_path / "backups"
    dest.mkdir()
    return dest


def budget_snapshots(dest: Path) -> list[Path]:
    return sorted(dest.glob("budget-*.sqlite"))


def make_migrated_db_from_copy(
    source: Path, target: Path, extra_transactions: int
) -> None:
    """Copy source to target then set exact row counts (can't re-seed a
    second household without touching users UNIQUE constraints)."""
    assert not target.exists()
    target.write_bytes(source.read_bytes())
    if extra_transactions:
        seed_budget_data(target, "Overflow", extra_transactions=extra_transactions)


def insert_extra_txn(db_path: Path, household: int, account: int, user: int) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO transactions (household_id, account_id, category_id,"
            " amount, description, transaction_date, created_by_user_id,"
            " created_at, updated_at) VALUES (?, ?, ?, -11, 'target extra',"
            " '2026-09-05', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (household, account, 1, user),
        )
        conn.commit()
    finally:
        conn.close()


def read_snapshot_counts(snapshot: Path) -> dict[str, int]:
    conn = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        return {
            "houses": conn.execute(
                "SELECT count(*) FROM households").fetchone()[0],
            "transactions": conn.execute(
                "SELECT count(*) FROM transactions").fetchone()[0],
            "budgets": conn.execute(
                "SELECT count(*) FROM budgets").fetchone()[0],
        }
    finally:
        conn.close()


def old_stale_name() -> str:
    stamp = "19700101t000000z"
    return f"budget-{stamp}-{socket.gethostname()[:8].lower()}.sqlite"


def test_backup_module_shared_snapshot_helper(seeded, destinations, tmp_path):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    published = budget_snapshots(destinations)
    assert len(published) == 1
    assert published[0].read_bytes()  # never zero-length
    assert seeded.read_bytes() != published[0].read_bytes()
    assert published[0].read_bytes() != b""


def test_backup_snapshot_rows_match_source(seeded, destinations):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations,
                        "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    counts = read_snapshot_counts(snap)
    assert counts == {"houses": 1, "transactions": 1, "budgets": 1}


def test_backup_wrong_revision_source_fails(seeded, destinations):
    """Backup refuses a snapshot whose alembic revision isn't head."""
    set_revision(seeded, "0004_transactions")
    before = budget_snapshots(destinations)
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations,
                        "--keep-days", "30")
    assert result.returncode != 0
    assert budget_snapshots(destinations) == before
    assert HEAD_REVISION.encode() not in result.stdout.encode()


def test_backup_invalid_db_fails_no_temp_left(seeded, destinations, tmp_path):
    dud = tmp_path / "budget-junk.db"
    dud.write_bytes(b"SQLite format 3\x00" + b"garbage-not-a-db" * 4)
    result = run_script(BACKUP_SCRIPT, "--database", dud,
                        "--destination", destinations,
                        "--keep-days", "30")
    assert result.returncode != 0
    assert budget_snapshots(destinations) == []
    leftovers = [p for p in destinations.iterdir() if p.is_file()]
    assert leftovers == []


def set_revision(db_path: Path, revision: str) -> None:
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        with engine.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num = :v"),
                         {"v": revision})
    finally:
        engine.dispose()


def test_backup_retention_prunes_script_owned_only(
    seeded, destinations, tmp_path
):
    """Old script snapshots deleted; non-matching and unrelated kept."""
    stale = destinations / "budget-19700101t000000z-abcdef01.sqlite"
    stale.write_bytes(b"frozen-old-snapshot")
    unrelated = destinations / "other-thing.sqlite"
    unrelated.write_bytes(b"keep-me")
    keep_newer = destinations / (f"budget-{(datetime.now(timezone.utc) - timedelta(days=1)).strftime('%Y%m%dt%H%M%S')}"
                                 "z-abcdef99.sqlite")
    keep_newer.write_bytes(b"keep-newer")
    nested = tmp_path / "elsewhere"
    nested.mkdir()
    (nested / stale.name).write_bytes(b"not-pruned")

    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "7")
    assert result.returncode == 0, result.stderr
    assert not stale.exists(), "stale script-owned snapshot must be pruned"
    assert unrelated.exists(), "unrelated files must never be pruned"
    assert keep_newer.exists(), "fresh snapshots must be kept"
    assert (nested / stale.name).exists()


def test_backup_without_keep_days_keeps_everything(seeded, destinations):
    stale = destinations / "budget-19700101t000000z-abcdef01.sqlite"
    stale.write_bytes(b"frozen-old-snapshot")
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations)
    assert result.returncode == 0
    assert stale.exists(), "retention must not run without --keep-days"


def test_backup_keep_days_must_be_positive(seeded, destinations):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "0")
    assert result.returncode != 0
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "-3")
    assert result.returncode != 0
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "abc")
    assert result.returncode != 0
    assert budget_snapshots(destinations) == []

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

def _load_backup_module():
    spec = importlib.util.spec_from_file_location(
        "budget_backup_for_test", BACKUP_SCRIPT
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backup_wall_clock_deadline_interrupts_copy(
    seeded, destinations, monkeypatch
):
    backup = _load_backup_module()
    clock = iter((0.0, backup.BACKUP_DEADLINE_SECONDS + 1.0))

    class FakeTime:
        @staticmethod
        def monotonic() -> float:
            return next(clock)

    monkeypatch.setattr(backup, "time", FakeTime)
    with pytest.raises(TimeoutError, match="deadline"):
        backup.create_snapshot(seeded, destinations)
    assert list(destinations.iterdir()) == []


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


def test_backup_publishes_unique_names_on_repeat(seeded, destinations):
    for _ in range(2):
        result = run_script(BACKUP_SCRIPT, "--database", seeded,
                            "--destination", destinations,
                            "--keep-days", "30")
        assert result.returncode == 0, result.stderr
    snaps = budget_snapshots(destinations)
    assert len(snaps) == 2
    assert len({p.name for p in snaps}) == 2


def test_backup_failure_keeps_prior_snapshots(seeded, destinations, tmp_path):
    good = destinations / "budget-19700101t000000z-abcdef02.sqlite"
    good.write_bytes(b"prior-snapshot")

    dud = tmp_path / "budget.db"
    dud.write_text("")
    result = run_script(BACKUP_SCRIPT, "--database", dud,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode != 0
    assert [p.name for p in budget_snapshots(destinations)] == [good.name]


def test_backup_live_writer_snapshot_is_consistent(seeded, destinations):
    """A second connection committing mid-backup never tears the snapshot."""
    seed_budget_data(seeded, "Ops", extra_transactions=4000)

    def late_commit() -> None:
        deadline = time.time() + 10
        found: Path | None = None
        while time.time() < deadline and found is None:
            candidates = list(destinations.glob("budget-*.part"))
            found = candidates[0] if candidates else None
            time.sleep(0.01)
        assert found is not None, "backup never staged its temp file"
        conn = sqlite3.connect(seeded)
        try:
            conn.execute("INSERT INTO transactions (household_id, account_id,"
                         " category_id, amount, description, "
                         "transaction_date, created_by_user_id, created_at,"
                         " updated_at) VALUES (1, 1, 1, -7, 'late commit',"
                         " '2026-09-03', 1, CURRENT_TIMESTAMP, "
                         "CURRENT_TIMESTAMP)")
            conn.commit()
        finally:
            conn.close()

    writer = threading.Thread(target=late_commit)
    writer.start()
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations,
                        "--keep-days", "30")
    writer.join()
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    counts = read_snapshot_counts(snap)
    # 1 seeded batch rows (4000) + 1 initial + the late insert either fully
    # in or fully out - snapshot must never show more than exists.
    assert counts["transactions"] in (4001, 4002), counts


def test_restore_writes_sessions_empty_transactions_kept(
    seeded, destinations, tmp_path
):
    """Full restore drill validated end to end."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)

    target = tmp_path / "restored.db"
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr

    conn = sqlite3.connect(target)
    try:
        assert conn.execute(
            "SELECT count(*) FROM sessions").fetchone()[0] == 0
        assert conn.execute(
            "SELECT count(*) FROM transactions").fetchone()[0] == 1
        assert conn.execute(
            "SELECT count(*) FROM budgets").fetchone()[0] == 1
        assert conn.execute(
            "SELECT count(*) FROM households").fetchone()[0] == 1
        assert conn.execute("SELECT version_num FROM alembic_version"
                            ).fetchone()[0] == HEAD_REVISION
    finally:
        conn.close()
    assert not list(tmp_path.glob("restored.db-wal"))


def test_restore_snapshot_pre_restore_content(seeded, destinations, tmp_path):
    """budget-pre-restore-*.sqlite keeps every post-backup row."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)

    # Target starts as a separate live DB with a distinguishing extra txn.
    target = tmp_path / "existing.db"
    make_migrated_db_from_copy(seeded, target, extra_transactions=0)
    insert_extra_txn(target, 1, 1, 1)

    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr
    pres = list(target.parent.glob("budget-pre-restore-*.sqlite"))
    assert len(pres) == 1
    # The preserved copy is the *target* state: seeded rows plus the
    # distinguishing extra txn, absent from the snapshot.
    counts = read_snapshot_counts(pres[0])
    assert counts["transactions"] == 2
    assert counts["budgets"] == 1
    assert counts["houses"] == 1


def test_restore_concurrent_writes_during_copy(seeded, destinations, tmp_path):
    """Concurrent writer during restore staging still yields the backup."""

    late_transaction = {"h": 1, "a": 1, "c": 1, "u": 1}

    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations,
                        "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    # While restore copies the backup to the staging DB, a writer hammering
    # the (live) target must not corrupt the staged image.
    staging_writes = tmp_path / "live-target.db"
    make_migrated_db_from_copy(seeded, staging_writes, extra_transactions=0)
    writer = threading.Thread(
        target=_write_until_missing,
        args=(destinations, late_transaction, seeded),
    )
    writer.start()
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", staging_writes, "--confirm")
    writer.join()
    assert do_restore.returncode == 0, do_restore.stderr
    conn = sqlite3.connect(staging_writes)
    try:
        assert conn.execute(
            "SELECT count(*) FROM sessions").fetchone()[0] == 0
        assert conn.execute(
            "SELECT count(*) FROM transactions").fetchone()[0] == 1
    finally:
        conn.close()


def _write_until_missing(
    destinations: Path, params: dict[str, object], db_path: Path
) -> None:
    deadline = time.time() + 15
    while time.time() < deadline and any(
        p.name.startswith("budget-pre-restore") or p.suffix == ".part"
        for p in destinations.iterdir()
    ):
        time.sleep(0.05)


def test_restore_preserves_snapshot_bytes(seeded, destinations, tmp_path):
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    before = snap.read_bytes()
    target = tmp_path / "restored.db"
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr
    assert snap.read_bytes() == before


def test_restore_corrupt_snapshot_without_target(seeded, tmp_path):
    bad = tmp_path / "budget-bad.sqlite"
    bad.write_bytes(b"SQLite format 3\x00broken-payload" * 4)
    target = tmp_path / "target.db"
    result = run_script(RESTORE_SCRIPT, "--backup", bad,
                        "--database", target, "--confirm")
    assert result.returncode != 0
    assert not target.exists()


def test_restore_wrong_revision_refused(seeded, tmp_path):
    add_column = "ALTER TABLE users ADD COLUMN nope INTEGER"
    conn = sqlite3.connect(seeded)
    conn.execute(add_column)
    conn.commit()
    conn.close()
    set_revision(seeded, "0004_transactions")
    target = tmp_path / "target.db"
    result = run_script(RESTORE_SCRIPT, "--backup", seeded,
                        "--database", target, "--confirm")
    assert result.returncode != 0
    assert not target.exists()


def test_restore_missing_backup_refused(tmp_path):
    target = tmp_path / "target.db"
    result = run_script(RESTORE_SCRIPT, "--backup", tmp_path / "nope.sqlite",
                        "--database", target, "--confirm")
    assert result.returncode != 0
    assert not target.exists()


def test_restore_requires_confirm_flag(seeded, tmp_path):
    """--confirm omitted: fails before opening a writable target."""
    target = tmp_path / "target.db"
    result = run_script(RESTORE_SCRIPT, "--backup", seeded,
                        "--database", target)
    assert result.returncode != 0
    assert not target.exists()


def test_backup_restore_full_drill(seeded, destinations, tmp_path):
    """Sanity drill: backup, damage, restore, verify rows."""
    result = run_script(BACKUP_SCRIPT, "--database", seeded,
                        "--destination", destinations, "--keep-days", "30")
    assert result.returncode == 0, result.stderr
    (snap,) = budget_snapshots(destinations)
    target = tmp_path / "rescued.db"
    corrupt_target = tmp_path / "corrupt-then-restored.db"
    corrupt_target.write_bytes(b"not-a-db-but-it-was")
    do_restore = run_script(RESTORE_SCRIPT, "--backup", snap,
                            "--database", corrupt_target, "--confirm")
    assert do_restore.returncode == 0, do_restore.stderr
    conn = sqlite3.connect(corrupt_target)
    try:
        assert conn.execute("SELECT count(*) FROM transactions"
                            ).fetchone()[0] == 1
    finally:
        conn.close()
