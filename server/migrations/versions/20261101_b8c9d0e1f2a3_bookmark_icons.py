from alembic import op
import sqlalchemy as sa
revision='b8c9d0e1f2a3'
down_revision='a7b8c9d0e1f2'
branch_labels=None
depends_on=None
def upgrade():
    op.add_column('bookmarks',sa.Column('icon_url',sa.String(2048),nullable=False,server_default=''))
def downgrade():
    op.drop_column('bookmarks','icon_url')
