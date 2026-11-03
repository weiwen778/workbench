"""User-reviewed Agent change staging."""
from alembic import op
import sqlalchemy as sa
revision='e1f2a3b4c5d6'
down_revision='d0e1f2a3b4c5'
branch_labels=None
depends_on=None

def upgrade():
    inspector=sa.inspect(op.get_bind())
    if inspector.has_table('agent_changes'):
        expected={'id','user_id','token_id','request_key','title','status','operations_cipher','payload_hash','fingerprints','preview','results','version','reviewed_at','reviewed_by','error','created_at','updated_at'}
        if not expected.issubset({c['name'] for c in inspector.get_columns('agent_changes')}):
            raise RuntimeError('Existing agent_changes schema does not match this migration')
        return
    op.create_table('agent_changes',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('token_id',sa.Integer(),sa.ForeignKey('agent_tokens.id',ondelete='CASCADE'),nullable=False,index=True),
        sa.Column('request_key',sa.String(128)),sa.Column('title',sa.String(200),nullable=False),
        sa.Column('status',sa.String(16),nullable=False,index=True),sa.Column('operations_cipher',sa.Text(),nullable=False),
        sa.Column('payload_hash',sa.String(64),nullable=False),sa.Column('fingerprints',sa.JSON(),nullable=False),
        sa.Column('preview',sa.JSON(),nullable=False),sa.Column('results',sa.JSON()),sa.Column('version',sa.Integer(),nullable=False),
        sa.Column('reviewed_at',sa.DateTime()),sa.Column('reviewed_by',sa.Integer(),sa.ForeignKey('users.id')),
        sa.Column('error',sa.String(1000)),sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),
        sa.UniqueConstraint('token_id','request_key',name='uq_agent_change_request'))

def downgrade():
    op.drop_table('agent_changes')
