"""Whiteboards and whiteboard image assets."""
from alembic import op
import sqlalchemy as sa

revision = 'c5d6e7f8a9b0'
down_revision = 'b4c5d6e7f8a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'whiteboards',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(120), nullable=False),
        sa.Column('scene', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_whiteboards_user_id', 'whiteboards', ['user_id'])
    op.create_index('ix_whiteboards_user_updated', 'whiteboards', ['user_id', 'updated_at', 'id'])
    op.create_table(
        'whiteboard_assets',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('id', sa.String(80), nullable=False),
        sa.Column('storage_key', sa.String(120), unique=True, nullable=False),
        sa.Column('content_type', sa.String(120), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'id'),
    )


def downgrade():
    op.drop_table('whiteboard_assets')
    op.drop_index('ix_whiteboards_user_updated', table_name='whiteboards')
    op.drop_index('ix_whiteboards_user_id', table_name='whiteboards')
    op.drop_table('whiteboards')
