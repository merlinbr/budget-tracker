"""Create household-scoped accounts and categories.

Revision ID: 0003_accounts_categories
Revises: 0002_identity
Create Date: 2026-09-08
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_accounts_categories"
down_revision = "0002_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer(),
            sa.ForeignKey("households.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("initial_balance", sa.Integer(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("household_id", "name", name="uq_accounts_household_name"),
        sa.CheckConstraint(
            "type IN ('checking','savings','cash','credit_card','other')",
            name="ck_accounts_type",
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name="ck_accounts_name_length"
        ),
        sa.CheckConstraint(
            "typeof(initial_balance) = 'integer' AND initial_balance BETWEEN -9007199254740991 AND 9007199254740991",
            name="ck_accounts_initial_balance",
        ),
    )
    op.create_index("ix_accounts_household_id", "accounts", ["household_id"])
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer(),
            sa.ForeignKey("households.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "household_id", "type", "name", name="uq_categories_household_type_name"
        ),
        sa.CheckConstraint(
            "type IN ('income','expense')", name="ck_categories_type"
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 100", name="ck_categories_name_length"
        ),
    )
    op.create_index("ix_categories_household_id", "categories", ["household_id"])


def downgrade() -> None:
    op.drop_index("ix_categories_household_id", table_name="categories")
    op.drop_table("categories")
    op.drop_index("ix_accounts_household_id", table_name="accounts")
    op.drop_table("accounts")
