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
    dashboard_password = os.environ["E2E_DASHBOARD_PASSWORD"]
    for width in (1280, 390):
        dashboard_household = Household(name=f"Dashboard Household {width}")
        db.add(dashboard_household)
        db.flush()
        dashboard_user = User(
            username=f"e2e-dashboard-{width}",
            display_name=f"Dashboard User {width}",
            password_hash=hash_password(dashboard_password),
            is_active=True,
        )
        db.add(dashboard_user)
        db.flush()
        db.add(
            HouseholdMember(
                household_id=dashboard_household.id,
                user_id=dashboard_user.id,
                role="owner",
            )
        )
    budgets_password = os.environ["E2E_BUDGETS_PASSWORD"]
    for width in (1280, 390):
        budgets_household = Household(name=f"Budgets Household {width}")
        db.add(budgets_household)
        db.flush()
        budgets_user = User(
            username=f"e2e-budgets-{width}",
            display_name=f"Budgets User {width}",
            password_hash=hash_password(budgets_password),
            is_active=True,
        )
        db.add(budgets_user)
        db.flush()
        db.add(
            HouseholdMember(
                household_id=budgets_household.id,
                user_id=budgets_user.id,
                role="owner",
            )
        )
    settings_password = os.environ["E2E_SETTINGS_PASSWORD"]
    for width in (1280, 390):
        settings_household = Household(name=f"Settings Household {width}")
        db.add(settings_household)
        db.flush()
        settings_user = User(
            username=f"e2e-settings-{width}",
            display_name=f"Settings User {width}",
            password_hash=hash_password(settings_password),
            is_active=True,
        )
        db.add(settings_user)
        db.flush()
        db.add(
            HouseholdMember(
                household_id=settings_household.id,
                user_id=settings_user.id,
                role="owner",
            )
        )
        sibling = User(
            username=f"e2e-settings-{width}-member",
            display_name=f"Settings Member {width}",
            password_hash=hash_password(settings_password + "-member"),
            is_active=True,
        )
        db.add(sibling)
        db.flush()
        db.add(
            HouseholdMember(
                household_id=settings_household.id,
                user_id=sibling.id,
                role="member",
            )
        )
    household_password = os.environ["E2E_HOUSEHOLD_PASSWORD"]
    for width in (1280, 390):
        workflow_household = Household(name=f"Workflow Household {width}")
        db.add(workflow_household)
        db.flush()
        workflow_user = User(
            username=f"e2e-household-{width}",
            display_name=f"Household User {width}",
            password_hash=hash_password(household_password),
            is_active=True,
        )
        db.add(workflow_user)
        db.flush()
        db.add(
            HouseholdMember(
                household_id=workflow_household.id,
                user_id=workflow_user.id,
                role="owner",
            )
        )
    db.commit()
