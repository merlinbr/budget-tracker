"""Create household-scoped transactions.

Revision ID: 0004_transactions
Revises: 0003_accounts_categories
Create Date: 2026-09-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_transactions"
down_revision = "0003_accounts_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer(),
            sa.ForeignKey("households.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "typeof(amount) = 'integer'", name="ck_transactions_amount_integer"
        ),
        sa.CheckConstraint("amount != 0", name="ck_transactions_amount_nonzero"),
        sa.CheckConstraint(
            "amount BETWEEN -9007199254740991 AND 9007199254740991",
            name="ck_transactions_amount_range",
        ),
        sa.CheckConstraint(
            "description IS NULL OR length(description) <= 500",
            name="ck_transactions_description_length",
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "ix_transactions_household_date",
        "transactions",
        ["household_id", "transaction_date"],
    )
    op.create_index(
        "ix_transactions_account_date",
        "transactions",
        ["account_id", "transaction_date"],
    )
    op.create_index(
        "ix_transactions_category_date",
        "transactions",
        ["category_id", "transaction_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_category_date", table_name="transactions")
    op.drop_index("ix_transactions_account_date", table_name="transactions")
    op.drop_index("ix_transactions_household_date", table_name="transactions")
    op.drop_table("transactions")
