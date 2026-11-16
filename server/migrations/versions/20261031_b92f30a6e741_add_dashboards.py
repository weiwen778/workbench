"""Persist table-linked dashboards."""
from alembic import op
import sqlalchemy as sa

revision = 'b92f30a6e741'
down_revision = 'a81e2f0d934b'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('dashboards',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('widgets', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_dashboards_user_id', 'dashboards', ['user_id'])


def downgrade():
    op.drop_table('dashboards')
