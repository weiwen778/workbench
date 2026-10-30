"""add user theme color

Revision ID: 9c2a1f6e4b70
Revises: 7d1f4c9b2e55
Create Date: 2026-10-29 11:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '9c2a1f6e4b70'
down_revision = '7d1f4c9b2e55'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('theme_color', sa.String(length=16), nullable=False, server_default='#39776f')
        )


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('theme_color')
