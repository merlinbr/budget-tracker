from typing import Annotated

from pydantic import Field

from .errors import APIError


MAX_SAFE_CENTS = 9007199254740991
Cents = Annotated[int, Field(strict=True, ge=-MAX_SAFE_CENTS, le=MAX_SAFE_CENTS)]


def checked_cents(value: int) -> int:
    if not -MAX_SAFE_CENTS <= value <= MAX_SAFE_CENTS:
        raise APIError(
            409,
            "CONFLICT",
            "The calculated balance exceeds the supported range.",
        )
    return value

