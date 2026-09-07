from datetime import timedelta
import os

from app.auth.passwords import hash_password
from app.auth.sessions import hash_session_token
from app.db import SessionLocal
from app.models import Household, HouseholdMember, User, UserSession, utc_now


username = os.environ["E2E_USERNAME"]
password = os.environ["E2E_PASSWORD"]
expired_session_token = os.environ["E2E_EXPIRED_SESSION_TOKEN"]

with SessionLocal() as db:
    household = Household(name="E2E Household")
    db.add(household)
    db.flush()
    user = User(
        username=username,
        display_name="E2E User",
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(
        HouseholdMember(
            household_id=household.id,
            user_id=user.id,
            role="owner",
        )
    )
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_session_token(expired_session_token),
            expires_at=utc_now() - timedelta(seconds=1),
        )
    )
    db.commit()
