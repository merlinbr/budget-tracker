from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(1024), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class Household(Base):
    __tablename__ = "households"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class HouseholdMember(Base):
    __tablename__ = "household_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="ck_household_members_role"),
        Index("ix_household_members_household_id", "household_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )



class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("household_id", "name", name="uq_accounts_household_name"),
        CheckConstraint(
            "type IN ('checking','savings','cash','credit_card','other')",
            name="ck_accounts_type",
        ),
        CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name="ck_accounts_name_length"
        ),
        CheckConstraint(
            "typeof(initial_balance) = 'integer' AND initial_balance BETWEEN -9007199254740991 AND 9007199254740991",
            name="ck_accounts_initial_balance",
        ),
        Index("ix_accounts_household_id", "household_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("households.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    initial_balance: Mapped[int] = mapped_column(Integer, nullable=False)
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint(
            "household_id", "type", "name", name="uq_categories_household_type_name"
        ),
        CheckConstraint(
            "type IN ('income','expense')", name="ck_categories_type"
        ),
        CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name="ck_categories_name_length"
        ),
        Index("ix_categories_household_id", "household_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("households.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint(
            "typeof(amount) = 'integer'", name="ck_transactions_amount_integer"
        ),
        CheckConstraint("amount != 0", name="ck_transactions_amount_nonzero"),
        CheckConstraint(
            "amount BETWEEN -9007199254740991 AND 9007199254740991",
            name="ck_transactions_amount_range",
        ),
        CheckConstraint(
            "description IS NULL OR length(description) <= 500",
            name="ck_transactions_description_length",
        ),
        Index("ix_transactions_household_date", "household_id", "transaction_date"),
        Index("ix_transactions_account_date", "account_id", "transaction_date"),
        Index("ix_transactions_category_date", "category_id", "transaction_date"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("households.id", ondelete="RESTRICT"), nullable=False
    )
    account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False
    )
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint(
            "household_id", "category_id", "year", "month",
            name="uq_budgets_household_category_period",
        ),
        CheckConstraint(
            "typeof(year) = 'integer' AND year BETWEEN 1 AND 9999",
            name="ck_budgets_year",
        ),
        CheckConstraint(
            "typeof(month) = 'integer' AND month BETWEEN 1 AND 12",
            name="ck_budgets_month",
        ),
        CheckConstraint(
            "typeof(limit_amount) = 'integer'", name="ck_budgets_limit_integer"
        ),
        CheckConstraint(
            "limit_amount BETWEEN 0 AND 9007199254740991",
            name="ck_budgets_limit_range",
        ),
        Index("ix_budgets_household_period", "household_id", "year", "month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("households.id", ondelete="RESTRICT"), nullable=False
    )
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    limit_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class UserSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
