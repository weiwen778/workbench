from alembic import op
import sqlalchemy as sa
revision='c9d0e1f2a3b4'
down_revision='b8c9d0e1f2a3'
branch_labels=None
depends_on=None
def upgrade():
    op.create_table('bookmark_categories',sa.Column('id',sa.Integer(),primary_key=True),sa.Column('name',sa.String(80),nullable=False,unique=True))
    op.execute("INSERT INTO bookmark_categories (name) SELECT DISTINCT category FROM bookmarks WHERE category <> ''")
def downgrade():
    op.drop_table('bookmark_categories')
