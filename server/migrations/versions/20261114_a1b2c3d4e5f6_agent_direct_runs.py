"""Direct Agent writes: token policy and the undoable run journal."""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'a0b1c2d3e4f5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('agent_tokens', sa.Column('write_mode', sa.String(10), nullable=False, server_default='review'))
    op.add_column('agent_tokens', sa.Column('policy', sa.JSON(), nullable=True))
    op.create_table(
        'agent_runs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_id', sa.Integer(), sa.ForeignKey('agent_tokens.id', ondelete='CASCADE'), nullable=False),
        sa.Column('request_key', sa.String(128)),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='applied'),
        sa.Column('undo_status', sa.String(16), nullable=False, server_default='available'),
        sa.Column('operations_cipher', sa.Text(), nullable=False),
        sa.Column('plan_cipher', sa.Text(), nullable=False),
        sa.Column('payload_hash', sa.String(64), nullable=False),
        sa.Column('preview', sa.JSON(), nullable=False),
        sa.Column('results', sa.JSON()),
        sa.Column('operation_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('result_status', sa.Integer(), nullable=False, server_default='200'),
        sa.Column('error', sa.String(1000)),
        sa.Column('undo_error', sa.String(1000)),
        sa.Column('undone_at', sa.DateTime()),
        sa.Column('undone_by', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('token_id', 'request_key', name='uq_agent_run_request'),
    )
    op.create_index('ix_agent_runs_user_id', 'agent_runs', ['user_id'])
    op.create_index('ix_agent_runs_token_id', 'agent_runs', ['token_id'])
    op.create_index('ix_agent_runs_status', 'agent_runs', ['status'])
    op.create_index('ix_agent_runs_undo_status', 'agent_runs', ['undo_status'])


def downgrade():
    op.drop_index('ix_agent_runs_undo_status', table_name='agent_runs')
    op.drop_index('ix_agent_runs_status', table_name='agent_runs')
    op.drop_index('ix_agent_runs_token_id', table_name='agent_runs')
    op.drop_index('ix_agent_runs_user_id', table_name='agent_runs')
    op.drop_table('agent_runs')
    op.drop_column('agent_tokens', 'policy')
    op.drop_column('agent_tokens', 'write_mode')
