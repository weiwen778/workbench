"""Typed field configuration, saved views, atomic edit journal and workbooks."""
from alembic import op
import sqlalchemy as sa
revision='e25f73b694c8'
down_revision='d14e62a583b7'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('data_fields',sa.Column('config',sa.JSON(),nullable=True))
    if op.get_bind().dialect.name=='sqlite':
        with op.batch_alter_table('data_records',recreate='always',table_kwargs={'sqlite_autoincrement':True}):pass
    op.create_table('table_views',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('table_id',sa.Integer(),sa.ForeignKey('data_tables.id',ondelete='CASCADE'),nullable=False),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('name',sa.String(100),nullable=False),sa.Column('kind',sa.String(20),nullable=False),sa.Column('config',sa.JSON(),nullable=False),sa.Column('version',sa.Integer(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False))
    op.create_table('table_changes',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('table_id',sa.Integer(),sa.ForeignKey('data_tables.id',ondelete='CASCADE'),nullable=False),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('request_id',sa.String(64),nullable=False),sa.Column('digest',sa.String(64),nullable=False),sa.Column('label',sa.String(100),nullable=False),sa.Column('schema_version',sa.Integer(),nullable=False),sa.Column('changes',sa.JSON(),nullable=False),sa.Column('reverts_id',sa.Integer(),nullable=True),sa.Column('undone_by',sa.Integer(),nullable=True),sa.Column('source',sa.String(100),nullable=False),sa.Column('action',sa.String(12),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('table_id','user_id','request_id',name='uq_table_change_request'))
    op.create_table('table_workbooks',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('table_id',sa.Integer(),sa.ForeignKey('data_tables.id',ondelete='CASCADE'),nullable=False),sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('snapshot',sa.JSON(),nullable=False),sa.Column('version',sa.Integer(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('table_id','user_id',name='uq_table_workbook_owner'))
    for name in ['table_views','table_changes','table_workbooks']:
        for col in ['table_id','user_id']:op.create_index('ix_'+name+'_'+col,name,[col])

def downgrade():
    for name in ['table_workbooks','table_changes','table_views']:op.drop_table(name)
    op.drop_column('data_fields','config')
