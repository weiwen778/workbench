"""Virtual table definitions; physical records remain unchanged."""
from alembic import op
import sqlalchemy as sa
revision='f36a84c705d9'
down_revision='e25f73b694c8'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('data_tables',sa.Column('kind',sa.String(16),nullable=False,server_default='physical'))
    op.add_column('data_tables',sa.Column('virtual_config',sa.JSON(),nullable=True))

def downgrade():
    op.drop_column('data_tables','virtual_config')
    op.drop_column('data_tables','kind')
