from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..errors import APIError
from ..models import Household, HouseholdMember, User, UserSession
from ..schemas import AuthState, ChangePasswordRequest, LoginRequest
from .csrf import create_csrf_token, session_binding
from .dependencies import HouseholdContext, require_household
from .passwords import (
    hash_password,
    needs_rehash,
    verify_dummy_password,
    verify_password,
)
from .rate_limit import LoginRateLimiter, RateLimitExceeded
from .sessions import (
    SESSION_COOKIE_NAME,
    clear_auth_cookies,
    delete_expired_sessions,
    hash_session_token,
    issue_session,
    session_token_from_request,
    set_csrf_cookie,
    set_session_cookie,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if not normalized or len(normalized) > 100:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"username": "Username must contain 1–100 characters."},
        )
    return normalized


def _auth_state(db: Session, user_id: int, household_id: int) -> AuthState:
    user = db.get(User, user_id)
    household = db.get(Household, household_id)
    if user is None or household is None:
        raise APIError(401, "AUTH_REQUIRED", "Authentication is required.")
    return AuthState(
        user={
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
        },
        household={"id": household.id, "name": household.name},
    )


def _begin_immediate(db: Session) -> None:
    if db.in_transaction():
        db.rollback()
    db.connection().exec_driver_sql("BEGIN IMMEDIATE")


def _client_ip(request: Request) -> str:
    # ponytail: socket-peer buckets are shared behind Caddy; configure trusted proxy addresses before splitting client IPs.
    return request.client.host if request.client is not None else "unknown"


@router.get("/csrf", status_code=204)
def csrf_bootstrap(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    binding = session_binding(request, db)
    if getattr(request.state, "invalid_session", False):
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    set_csrf_cookie(response, create_csrf_token(binding, settings.session_secret), settings)
    response.status_code = 204
    return response


@router.post("/login", response_model=AuthState)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthState:
    username = _normalize_username(payload.username)
    limiter: LoginRateLimiter = request.app.state.login_limiter
    try:
        ticket = limiter.reserve(username, _client_ip(request))
    except RateLimitExceeded as exc:
        raise StarletteHTTPException(
            status_code=429,
            detail="Too many requests.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from None

    success = False
    try:
        _begin_immediate(db)
        user = db.scalar(select(User).where(User.username == username))
        valid_password = (
            verify_dummy_password(payload.password)
            if user is None
            else verify_password(user.password_hash, payload.password)
        )
        membership = (
            db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
            if user is not None and valid_password and user.is_active
            else None
        )
        if (
            user is None
            or not valid_password
            or not user.is_active
            or membership is None
        ):
            db.rollback()
            raise APIError(
                401,
                "INVALID_CREDENTIALS",
                "Invalid username or password.",
            )

        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(payload.password)

        presented_token = session_token_from_request(request)
        if presented_token is not None:
            previous = db.scalar(
                select(UserSession).where(
                    UserSession.token_hash == hash_session_token(presented_token)
                )
            )
            if previous is not None:
                db.delete(previous)

        delete_expired_sessions(db)
        raw_token, _session = issue_session(db, user.id, settings)
        db.commit()
        success = True
        set_session_cookie(response, raw_token, settings)
        csrf_token = create_csrf_token(
            hash_session_token(raw_token), settings.session_secret
        )
        set_csrf_cookie(response, csrf_token, settings)
        return _auth_state(db, user.id, membership.household_id)
    except Exception:
        if db.in_transaction():
            db.rollback()
        raise
    finally:
        limiter.finish(ticket, success=success)


@router.get("/me", response_model=AuthState)
def me(
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> AuthState:
    return _auth_state(db, context.user_id, context.household_id)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    request: Request,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    raw_token = session_token_from_request(request)
    if raw_token is not None:
        db.execute(
            delete(UserSession).where(
                UserSession.user_id == context.user_id,
                UserSession.token_hash == hash_session_token(raw_token),
            )
        )
    db.commit()
    clear_auth_cookies(response)
    response.status_code = 204
    return response


@router.post("/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    _begin_immediate(db)
    user = db.get(User, context.user_id)
    membership = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.user_id == context.user_id,
            HouseholdMember.household_id == context.household_id,
        )
    )
    if user is None or not user.is_active or membership is None:
        db.rollback()
        raise APIError(401, "AUTH_REQUIRED", "Authentication is required.")
    if not verify_password(user.password_hash, payload.current_password):
        db.rollback()
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"currentPassword": "Current password is incorrect."},
        )

    user.password_hash = hash_password(payload.new_password)
    db.execute(delete(UserSession).where(UserSession.user_id == context.user_id))
    db.commit()
    clear_auth_cookies(response)
    response.status_code = 204
    return response
