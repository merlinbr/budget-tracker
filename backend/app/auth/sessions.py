from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from fastapi import Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import User, UserSession

SESSION_COOKIE_NAME = "budget_session"
CSRF_COOKIE_NAME = "XSRF-TOKEN"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_token_from_request(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    if len(token) > 200:
        request.state.invalid_session = True
        return None
    return token


def find_session(
    request: Request, db: Session, *, now: datetime | None = None
) -> UserSession | None:
    raw_token = session_token_from_request(request)
    if raw_token is None:
        if request.cookies.get(SESSION_COOKIE_NAME):
            request.state.invalid_session = True
        return None
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_session_token(raw_token)
        )
    )
    if session is None:
        request.state.invalid_session = True
        return None
    current_time = now or utc_now()
    if as_utc(session.expires_at) <= current_time:
        request.state.expired_session = True
        request.state.invalid_session = True
        return None
    return session


def issue_session(
    db: Session,
    user_id: int,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> tuple[str, UserSession]:
    current_time = now or utc_now()
    raw_token = secrets.token_urlsafe(32)
    session = UserSession(
        user_id=user_id,
        token_hash=hash_session_token(raw_token),
        created_at=current_time,
        expires_at=current_time + timedelta(days=settings.session_max_age_days),
    )
    db.add(session)
    return raw_token, session


def delete_expired_sessions(
    db: Session, *, now: datetime | None = None
) -> int:
    current_time = now or utc_now()
    result = db.execute(
        delete(UserSession)
        .where(UserSession.expires_at <= current_time)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=settings.session_max_age_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def set_csrf_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        max_age=settings.session_max_age_days * 24 * 60 * 60,
        httponly=False,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
