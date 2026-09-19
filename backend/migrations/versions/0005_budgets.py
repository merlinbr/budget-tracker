"""Create household-scoped monthly budgets.

Revision ID: 0005_budgets
Revises: 0004_transactions
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_budgets"
down_revision = "0004_transactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer(),
            sa.ForeignKey("households.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("limit_amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "household_id", "category_id", "year", "month",
            name="uq_budgets_household_category_period",
        ),
        sa.CheckConstraint(
            "typeof(year) = 'integer' AND year BETWEEN 1 AND 9999",
            name="ck_budgets_year",
        ),
        sa.CheckConstraint(
            "typeof(month) = 'integer' AND month BETWEEN 1 AND 12",
            name="ck_budgets_month",
        ),
        sa.CheckConstraint(
            "typeof(limit_amount) = 'integer'", name="ck_budgets_limit_integer"
        ),
        sa.CheckConstraint(
            "limit_amount BETWEEN 0 AND 9007199254740991",
            name="ck_budgets_limit_range",
        ),
    )
    op.create_index(
        "ix_budgets_household_period", "budgets", ["household_id", "year", "month"]
    )


def downgrade() -> None:
    op.drop_index("ix_budgets_household_period", table_name="budgets")
    op.drop_table("budgets")
