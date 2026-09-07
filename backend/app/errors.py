import logging
from collections.abc import Mapping
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        fields: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = dict(fields) if fields else None


def _error_payload(
    code: str,
    message: str,
    fields: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if fields:
        error["fields"] = dict(fields)
    return {"error": error}


def _status_code_name(status_code: int) -> str:
    return {
        401: "AUTH_REQUIRED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
    }.get(status_code, "INTERNAL_ERROR" if status_code >= 500 else "VALIDATION_ERROR")


def _status_message(status_code: int) -> str:
    return {
        401: "Authentication is required.",
        403: "The request is not allowed.",
        404: "Resource not found.",
        409: "The request conflicts with existing data.",
        422: "The request could not be processed.",
        429: "Too many requests.",
    }.get(status_code, "The request could not be processed.")


async def api_error_handler(_request: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(exc.code, exc.message, exc.fields),
    )


async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(
            _status_code_name(exc.status_code),
            _status_message(exc.status_code),
        ),
        headers=exc.headers,
    )


async def validation_error_handler(
    _request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    fields: dict[str, str] = {}
    for item in exc.errors():
        location = item.get("loc", ())
        field = str(location[-1]) if location else "request"
        fields.setdefault(field, str(item.get("msg", "Invalid value.")))
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            "VALIDATION_ERROR",
            "The request could not be processed.",
            fields,
        ),
    )


async def unhandled_error_handler(request: Request, _exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error for %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content=_error_payload("INTERNAL_ERROR", "An internal error occurred."),
    )


def register_exception_handlers(app: Any) -> None:
    app.add_exception_handler(APIError, api_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
