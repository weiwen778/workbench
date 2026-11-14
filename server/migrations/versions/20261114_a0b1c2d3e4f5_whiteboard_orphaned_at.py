"""Track when a whiteboard asset loses its last scene reference."""
from alembic import op
import sqlalchemy as sa

revision = "a0b1c2d3e4f5"
down_revision = "f9a0b1c2d3e4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("whiteboard_assets", sa.Column("orphaned_at", sa.DateTime(), nullable=True))
    op.create_index("ix_whiteboard_assets_orphaned_at", "whiteboard_assets", ["orphaned_at"])
    # Existing assets have no reliable orphan timestamp. Preserve their age as
    # the best available estimate; the maintenance pass will re-evaluate refs.
    op.execute("UPDATE whiteboard_assets SET orphaned_at = created_at WHERE orphaned_at IS NULL")


def downgrade():
    op.drop_index("ix_whiteboard_assets_orphaned_at", table_name="whiteboard_assets")
    op.drop_column("whiteboard_assets", "orphaned_at")
