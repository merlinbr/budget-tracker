from datetime import timedelta
import hashlib

import pytest
from sqlalchemy import select

from app import cli
from app.auth.passwords import hash_password, validate_password
from app.models import Category, Household, HouseholdMember, User, UserSession, utc_now


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
        ["Household", "USER", "User", "n"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Second", "other", "Other", "n"],
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
        ["Household", "user", "User", "n"],
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
        ["Household", "user", "User", "n"],
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


EXPECTED_DEFAULT_CATEGORIES = (
    ("income", "Salary"), ("income", "Bonus"), ("income", "Other Income"),
    ("expense", "Housing"), ("expense", "Groceries"), ("expense", "Restaurants"),
    ("expense", "Car"), ("expense", "Public Transport"), ("expense", "Insurance"),
    ("expense", "Subscriptions"), ("expense", "Kids"), ("expense", "Health"),
    ("expense", "Shopping"), ("expense", "Entertainment"), ("expense", "Travel"),
    ("expense", "Utilities"), ("expense", "Other"),
)


@pytest.mark.parametrize("answer", ["", "y", "yes", "Y", "YES"])
def test_init_can_accept_default_categories(monkeypatch, test_app, answer):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Family", "owner", "Owner", answer],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0

    with factory() as db:
        household = db.scalar(select(Household))
        member = db.scalar(select(HouseholdMember))
        categories = db.scalars(select(Category).order_by(Category.id)).all()
        assert household is not None
        assert member is not None
        assert [(category.type, category.name) for category in categories] == list(
            EXPECTED_DEFAULT_CATEGORIES
        )
        assert {category.household_id for category in categories} == {
            household.id
        } == {member.household_id}


@pytest.mark.parametrize("answer", ["n", "no", "N", "NO"])
def test_init_can_decline_default_categories(monkeypatch, test_app, answer):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Family", "owner", "Owner", answer],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0
    with factory() as db:
        assert db.scalar(select(Household.id)) is not None
        assert db.scalars(select(Category)).all() == []


def test_init_default_categories_are_visible_to_owner(
    monkeypatch, test_app, client, csrf_headers
):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Family", "owner", "Owner", "y"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 0

    assert client.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse battery staple"},
        headers=csrf_headers(),
    ).status_code == 200
    response = client.get("/api/categories")
    assert response.status_code == 200
    assert [(row["type"], row["name"]) for row in response.json()] == sorted(
        EXPECTED_DEFAULT_CATEGORIES
    )


def test_init_rejects_non_yes_no_answer_without_rows(monkeypatch, test_app):
    factory = test_app.state.session_factory
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Family", "owner", "Owner", "maybe"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 1
    with factory() as db:
        assert db.scalar(select(Household.id)) is None
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(HouseholdMember.id)) is None
        assert db.scalar(select(Category.id)) is None


def test_init_rolls_back_when_default_category_seed_conflicts(
    monkeypatch, test_app
):
    factory = test_app.state.session_factory
    monkeypatch.setattr(
        cli,
        "DEFAULT_CATEGORIES",
        (("expense", "Duplicate"), ("expense", "Duplicate")),
    )
    assert run_cli(
        monkeypatch,
        factory,
        "init-household",
        ["Family", "owner", "Owner", "y"],
        ["correct horse battery staple", "correct horse battery staple"],
    ) == 1
    with factory() as db:
        assert db.scalar(select(Household.id)) is None
        assert db.scalar(select(User.id)) is None
        assert db.scalar(select(HouseholdMember.id)) is None
        assert db.scalar(select(Category.id)) is None
