from datetime import timedelta
import hashlib

from sqlalchemy import select

from app import cli
from app.auth.passwords import hash_password, validate_password
from app.models import Household, HouseholdMember, User, UserSession, utc_now


def run_cli(monkeypatch, session_factory, command, inputs, passwords=()):
    answers = iter(inputs)
    entered_passwords = iter(passwords)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: next(entered_passwords))
    monkeypatch.setattr(cli, "SessionLocal", session_factory)
    return cli.main([command])


def test_init_and_create_user_provision_memberships(monkeypatch, test_app):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        [" Family ", " Merlin ", " Merlin ", ""],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    assert run_cli(
        monkeypatch,
        factory,
        "create-user",
        ["SECOND", "Second User"],
        ["another correct password", "another correct password"],
    ) == 0

    with factory() as db:
        users = db.scalars(select(User).order_by(User.id)).all()
        memberships = db.scalars(select(HouseholdMember).order_by(HouseholdMember.id)).all()
        households = db.scalars(select(Household)).all()

    assert [user.username for user in users] == ["merlin", "second"]
    assert [member.role for member in memberships] == ["owner", "member"]
    assert len(households) == 1
    assert users[0].password_hash.startswith("$argon2id$")


def test_bootstrap_refuses_duplicate_and_mismatched_input_without_rows(
    monkeypatch, test_app
):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Household", "user", "User"],
        ["correct horse battery staple", "wrong confirmation"],
    ) == 1
    with factory() as db:
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(Household.id)) is None

    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Household", "USER", "User"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Second", "other", "Other"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 1
    with factory() as db:
        assert db.scalar(select(Household.id)) is not None
        assert len(db.scalars(select(User)).all()) == 1


def test_password_bounds_and_reset_revokes_sessions(monkeypatch, test_app):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Household", "user", "User"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    with factory() as db:
        user = db.scalar(select(User))
        assert user is not None
        db.add(
            UserSession(
                user_id=user.id,
                token_hash=hashlib.sha256(b"session").hexdigest(),
                expires_at=utc_now() + timedelta(days=1),
            )
        )
        db.commit()

    assert run_cli(
        monkeypatch,
        factory,
        "reset-password",
        ["USER"],
        ["new correct password", "new correct password"],
    ) == 0
    with factory() as db:
        user = db.scalar(select(User))
        assert user is not None
        assert db.scalar(select(UserSession.id)) is None
        assert user.password_hash != "new correct password"

    for password in ("short", "a" * 1025):
        try:
            validate_password(password)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid password length accepted")
    assert hash_password("twelve chars!").startswith("$argon2id$")

def test_cleanup_sessions_removes_only_expired_rows(monkeypatch, test_app):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Household", "user", "User"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    with factory() as db:
        user = db.scalar(select(User))
        assert user is not None
        db.add_all(
            [
                UserSession(
                    user_id=user.id,
                    token_hash=hashlib.sha256(b"expired").hexdigest(),
                    expires_at=utc_now() - timedelta(seconds=1),
                ),
                UserSession(
                    user_id=user.id,
                    token_hash=hashlib.sha256(b"active").hexdigest(),
                    expires_at=utc_now() + timedelta(days=1),
                ),
            ]
        )
        db.commit()

    assert run_cli(monkeypatch, factory, "cleanup-sessions", [], []) == 0
    with factory() as db:
        sessions = db.scalars(select(UserSession)).all()
        assert len(sessions) == 1
