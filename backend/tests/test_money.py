import pytest

from app.errors import APIError
from app.money import MAX_SAFE_CENTS, checked_cents


def test_checked_cents_accepts_boundaries_and_rejects_overflow():
    assert checked_cents(-MAX_SAFE_CENTS) == -MAX_SAFE_CENTS
    assert checked_cents(MAX_SAFE_CENTS) == MAX_SAFE_CENTS
    for value in (-MAX_SAFE_CENTS - 1, MAX_SAFE_CENTS + 1):
        with pytest.raises(APIError) as raised:
            checked_cents(value)
        assert raised.value.status_code == 409
        assert raised.value.code == "CONFLICT"
