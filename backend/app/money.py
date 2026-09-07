from typing import Annotated

from pydantic import Field


MAX_SAFE_CENTS = 9007199254740991
Cents = Annotated[int, Field(strict=True, ge=-MAX_SAFE_CENTS, le=MAX_SAFE_CENTS)]
