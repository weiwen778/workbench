"""add translation favorites

Revision ID: 7d1f4c9b2e55
Revises: 2cb67a515f96
Create Date: 2026-10-29 10:12:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '7d1f4c9b2e55'
down_revision = '2cb67a515f96'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'translation_favorites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_text', sa.Text(), nullable=False),
        sa.Column('target_text', sa.Text(), nullable=False),
        sa.Column('source_lang', sa.String(length=16), nullable=False),
        sa.Column('target_lang', sa.String(length=16), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('translation_favorites', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_translation_favorites_provider'), ['provider'], unique=False)
        batch_op.create_index(batch_op.f('ix_translation_favorites_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('translation_favorites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_translation_favorites_created_at'))
        batch_op.drop_index(batch_op.f('ix_translation_favorites_provider'))
    op.drop_table('translation_favorites')
