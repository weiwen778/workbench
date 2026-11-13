"""Track uploader ownership for files."""
from alembic import op
import sqlalchemy as sa

revision = "f9a0b1c2d3e4"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("files", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_files_owner_id_users", "files", "users", ["owner_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_files_owner_id", "files", ["owner_id"])
    # Existing document projects are the only file references that carry a
    # user identity. Backfill those so legacy project attachments obey the
    # same owner checks as newly uploaded files.
    op.execute(
        """
        UPDATE files SET owner_id = (
            SELECT dp.user_id FROM document_projects dp
            JOIN file_refs fr ON fr.owner_id = dp.id
            WHERE fr.file_id = files.id AND fr.owner_type = 'document_project'
            LIMIT 1
        )
        WHERE owner_id IS NULL
        """
    )


def downgrade():
    op.drop_index("ix_files_owner_id", table_name="files")
    op.drop_constraint("fk_files_owner_id_users", "files", type_="foreignkey")
    op.drop_column("files", "owner_id")
