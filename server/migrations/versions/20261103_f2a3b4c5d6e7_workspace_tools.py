"""Workspace jobs, operation log and Agent review notes."""
from alembic import op
import sqlalchemy as sa
revision='f2a3b4c5d6e7'
down_revision='e1f2a3b4c5d6'
branch_labels=None
depends_on=None

def upgrade():
    op.create_index("ix_todos_list_parent_completed","todos",["list_id","parent_id","completed_at","sort_index","id"])
    op.create_index("ix_memos_live_updated","memos",["deleted_at","updated_at","id"])
    op.create_index("ix_memos_category_live_updated","memos",["category","deleted_at","updated_at","id"])
    op.create_index("ix_notes_live_updated","notes",["deleted_at","updated_at","id"])
    op.create_table('background_jobs',
        sa.Column('id',sa.Integer(),primary_key=True),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False,index=True),
        sa.Column('kind',sa.String(24),nullable=False),sa.Column('title',sa.String(200),nullable=False),sa.Column('status',sa.String(24),nullable=False,index=True),
        sa.Column('progress',sa.Integer(),nullable=False),sa.Column('processed',sa.Integer(),nullable=False),sa.Column('cancel_requested',sa.Boolean(),nullable=False),
        sa.Column('request_key',sa.String(128)),sa.Column('payload',sa.JSON(),nullable=False),sa.Column('result',sa.JSON()),sa.Column('error',sa.String(1000)),
        sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('user_id','request_key',name='uq_job_request'))
    op.create_table('operation_logs',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False,index=True),
        sa.Column('actor',sa.String(120),nullable=False),sa.Column('method',sa.String(16),nullable=False),sa.Column('path',sa.String(1000),nullable=False),sa.Column('status',sa.Integer(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False,index=True))
    op.create_table('agent_review_notes',sa.Column('change_id',sa.Integer(),sa.ForeignKey('agent_changes.id',ondelete='CASCADE'),primary_key=True),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),sa.Column('note',sa.String(1000),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False))

def downgrade():
    op.drop_index("ix_todos_list_parent_completed",table_name="todos")
    op.drop_index("ix_memos_live_updated",table_name="memos")
    op.drop_index("ix_memos_category_live_updated",table_name="memos")
    op.drop_index("ix_notes_live_updated",table_name="notes")
    op.drop_table('agent_review_notes');op.drop_table('operation_logs');op.drop_table('background_jobs')