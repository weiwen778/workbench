"""Add application log center and GitHub feedback tables.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'app_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('level', sa.String(10), nullable=False),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('logger', sa.String(120), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('stack', sa.Text()),
        sa.Column('path', sa.String(500)),
        sa.Column('method', sa.String(10)),
        sa.Column('status', sa.Integer()),
        sa.Column('duration_ms', sa.Integer()),
        sa.Column('request_id', sa.String(64)),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('context', sa.JSON()),
    )
    op.create_index('ix_app_logs_created', 'app_logs', ['created_at'])
    op.create_index('ix_app_logs_level_created', 'app_logs', ['level', 'created_at'])
    op.create_index('ix_app_logs_source_created', 'app_logs', ['source', 'created_at'])
    op.create_index('ix_app_logs_request_id', 'app_logs', ['request_id'])

    op.create_table(
        'feedback_integrations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('repo', sa.String(200)),
        sa.Column('encrypted_token', sa.Text()),
        sa.Column('labels', sa.JSON(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('last_test_ok', sa.Boolean()),
        sa.Column('last_test_message', sa.String(500)),
        sa.Column('last_tested_at', sa.DateTime()),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'feedback_submissions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('issue_number', sa.Integer()),
        sa.Column('issue_url', sa.String(500)),
        sa.Column('error', sa.String(1000)),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('log_snapshot', sa.Text()),
        sa.Column('environment', sa.JSON(), nullable=False),
        sa.Column('sent_at', sa.DateTime()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_feedback_submissions_user_id', 'feedback_submissions', ['user_id'])
    op.create_index('ix_feedback_submissions_status', 'feedback_submissions', ['status'])


def downgrade():
    op.drop_index('ix_feedback_submissions_status', table_name='feedback_submissions')
    op.drop_index('ix_feedback_submissions_user_id', table_name='feedback_submissions')
    op.drop_table('feedback_submissions')
    op.drop_table('feedback_integrations')
    op.drop_index('ix_app_logs_request_id', table_name='app_logs')
    op.drop_index('ix_app_logs_source_created', table_name='app_logs')
    op.drop_index('ix_app_logs_level_created', table_name='app_logs')
    op.drop_index('ix_app_logs_created', table_name='app_logs')
    op.drop_table('app_logs')
