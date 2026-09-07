import argparse
from collections.abc import Sequence
import getpass
import sys

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth.passwords import hash_password, validate_password
from .db import SessionLocal
from .models import Household, HouseholdMember, User, UserSession, utc_now


class CLIError(Exception):
    pass


def _prompt_name(label: str) -> str:
    value = input(f"{label}: ").strip()
    if not value or len(value) > 100:
        raise CLIError(f"{label} must contain 1–100 characters.")
    return value


def _prompt_username() -> str:
    username = input("Username: ").strip().lower()
    if not username or len(username) > 100:
        raise CLIError("Username must contain 1–100 characters.")
    return username


def _prompt_password() -> str:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise CLIError("Passwords do not match.")
    try:
        validate_password(password)
    except ValueError as exc:
        raise CLIError(str(exc)) from None
    return password


def _begin_immediate(db: Session) -> None:
    if db.in_transaction():
        db.rollback()
    db.connection().exec_driver_sql("BEGIN IMMEDIATE")


def _add_user(
    db: Session,
    *,
    username: str,
    display_name: str,
    password: str,
    household_id: int,
    role: str,
) -> User:
    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(
        HouseholdMember(
            household_id=household_id,
            user_id=user.id,
            role=role,
        )
    )
    return user


def _init_household(db: Session) -> int:
    household_name = _prompt_name("Household name")
    username = _prompt_username()
    display_name = _prompt_name("Display name")
    password = _prompt_password()

    _begin_immediate(db)
    if db.scalar(select(func.count()).select_from(Household)):
        raise CLIError("A household has already been initialized.")

    household = Household(name=household_name)
    db.add(household)
    db.flush()
    user = _add_user(
        db,
        username=username,
        display_name=display_name,
        password=password,
        household_id=household.id,
        role="owner",
    )
    db.commit()
    print(f"Initialized household and owner {user.username}.")
    return 0


def _create_user(db: Session) -> int:
    username = _prompt_username()
    display_name = _prompt_name("Display name")
    password = _prompt_password()

    _begin_immediate(db)
    households = db.scalars(select(Household).order_by(Household.id)).all()
    if not households:
        raise CLIError("Initialize a household first.")
    if len(households) != 1:
        raise CLIError("Exactly one household is required for CLI user creation.")

    user = _add_user(
        db,
        username=username,
        display_name=display_name,
        password=password,
        household_id=households[0].id,
        role="member",
    )
    db.commit()
    print(f"Created household member {user.username}.")
    return 0


def _reset_password(db: Session) -> int:
    username = _prompt_username()
    password = _prompt_password()

    _begin_immediate(db)
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        raise CLIError("User not found.")
    user.password_hash = hash_password(password)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    print(f"Reset password and revoked sessions for {user.username}.")
    return 0


def _cleanup_sessions(db: Session) -> int:
    result = db.execute(
        delete(UserSession)
        .where(UserSession.expires_at <= utc_now())
        .execution_options(synchronize_session=False)
    )
    db.commit()
    print(f"Removed {int(result.rowcount or 0)} expired sessions.")
    return 0


def _run(command: str) -> int:
    db = SessionLocal()
    try:
        if command == "init-household":
            return _init_household(db)
        if command == "create-user":
            return _create_user(db)
        if command == "reset-password":
            return _reset_password(db)
        return _cleanup_sessions(db)
    except (CLIError, EOFError, KeyboardInterrupt) as exc:
        db.rollback()
        message = "Input cancelled." if isinstance(exc, (EOFError, KeyboardInterrupt)) else str(exc)
        print(f"Error: {message}", file=sys.stderr)
        return 1
    except IntegrityError:
        db.rollback()
        print("Error: The requested identity already exists or conflicts with existing data.", file=sys.stderr)
        return 1
    finally:
        db.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage budget tracker identities.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in (
        "init-household",
        "create-user",
        "reset-password",
        "cleanup-sessions",
    ):
        subparsers.add_parser(command)
    args = parser.parse_args(argv)
    return _run(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
