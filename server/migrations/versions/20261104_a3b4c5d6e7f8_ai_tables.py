"""Encrypted AI credentials and reviewed extraction drafts."""
from alembic import op
import sqlalchemy as sa
revision='a3b4c5d6e7f8'
down_revision='f2a3b4c5d6e7'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('ai_connections',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('encrypted_config',sa.Text()),sa.Column('default_model',sa.String(32),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False))
    op.create_table('ai_extractions',sa.Column('id',sa.String(32),primary_key=True),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),sa.Column('table_id',sa.Integer(),sa.ForeignKey('data_tables.id'),nullable=False),sa.Column('schema_version',sa.Integer(),nullable=False),sa.Column('model',sa.String(32),nullable=False),sa.Column('encrypted_result',sa.Text()),sa.Column('status',sa.String(20),nullable=False),sa.Column('record_ids',sa.JSON(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False))
    op.create_index('ix_ai_extractions_user_id','ai_extractions',['user_id'])
    op.create_index('ix_ai_extractions_table_id','ai_extractions',['table_id'])

def downgrade():
    op.drop_table('ai_extractions');op.drop_table('ai_connections')
