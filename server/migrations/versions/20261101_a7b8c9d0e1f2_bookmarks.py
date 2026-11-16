"""Add website bookmarks."""
from alembic import op
import sqlalchemy as sa
revision = "a7b8c9d0e1f2"
down_revision = "f36a84c705d9"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("bookmarks", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("url", sa.String(2048), nullable=False), sa.Column("title", sa.String(200), nullable=False),
        sa.Column("category", sa.String(80), nullable=False), sa.Column("description", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False))

def downgrade():
    op.drop_table("bookmarks")
