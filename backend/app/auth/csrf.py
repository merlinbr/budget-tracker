import hashlib
import hmac
import secrets

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..errors import APIError
from .sessions import find_session

ANONYMOUS_BINDING = "anonymous"
_CSRF_PREFIX = b"budget-tracker-csrf:v1:"
_MAX_TOKEN_LENGTH = 256


def _message(binding: str, nonce: str) -> bytes:
    return _CSRF_PREFIX + binding.encode("ascii") + b":" + nonce.encode("ascii")


def create_csrf_token(binding: str, secret: str) -> str:
    nonce = secrets.token_urlsafe(32)
    signature = hmac.new(
        secret.encode("utf-8"), _message(binding, nonce), hashlib.sha256
    ).hexdigest()
    return f"{nonce}.{signature}"


def verify_csrf_token(token: str, binding: str, secret: str) -> bool:
    if not token or len(token) > _MAX_TOKEN_LENGTH or token.count(".") != 1:
        return False
    nonce, signature = token.split(".", 1)
    if (
        len(nonce) != 43
        or len(signature) != 64
        or not nonce.isascii()
        or any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
               for character in nonce)
        or any(character not in "0123456789abcdef" for character in signature)
    ):
        return False
    expected = hmac.new(
        secret.encode("utf-8"), _message(binding, nonce), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


def session_binding(request: Request, db: Session) -> str:
    session = find_session(request, db)
    if session is None:
        return ANONYMOUS_BINDING
    return session.token_hash


def csrf_guard(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    if request.url.path != "/api" and not request.url.path.startswith("/api/"):
        return
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return

    origin = request.headers.get("origin")
    if origin not in settings.allowed_origins:
        raise APIError(403, "FORBIDDEN", "The request origin is not allowed.")

    binding = session_binding(request, db)
    cookie_token = request.cookies.get("XSRF-TOKEN")
    header_token = request.headers.get("X-XSRF-TOKEN")
    if (
        cookie_token is None
        or header_token is None
        or len(cookie_token) > _MAX_TOKEN_LENGTH
        or len(header_token) > _MAX_TOKEN_LENGTH
        or not cookie_token.isascii()
        or not header_token.isascii()
        or not hmac.compare_digest(cookie_token, header_token)
        or not verify_csrf_token(cookie_token, binding, settings.session_secret)
    ):
        raise APIError(403, "FORBIDDEN", "The request could not be verified.")
