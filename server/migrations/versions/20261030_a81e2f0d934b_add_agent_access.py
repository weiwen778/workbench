"""Add scoped agent access tokens and activity records."""
from alembic import op
import sqlalchemy as sa

revision = 'a81e2f0d934b'
down_revision = '9c2a1f6e4b70'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'agent_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('prefix', sa.String(20), nullable=False),
        sa.Column('scopes', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime()),
        sa.Column('revoked_at', sa.DateTime()),
    )
    op.create_index('ix_agent_tokens_user_id', 'agent_tokens', ['user_id'])
    op.create_table(
        'agent_activities',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('token_id', sa.Integer(), sa.ForeignKey('agent_tokens.id', ondelete='CASCADE'), nullable=False),
        sa.Column('method', sa.String(10), nullable=False),
        sa.Column('path', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_agent_activities_token_id', 'agent_activities', ['token_id'])
    op.create_index('ix_agent_activities_created_at', 'agent_activities', ['created_at'])


def downgrade():
    op.drop_table('agent_activities')
    op.drop_table('agent_tokens')
