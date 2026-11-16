"""Track uploader ownership for files."""
from alembic import op
import sqlalchemy as sa

revision = "f9a0b1c2d3e4"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite cannot add a foreign key in place. Batch mode recreates the
        # table while preserving its data, which is required for fresh local
        # databases created through `alembic upgrade head`.
        with op.batch_alter_table("files", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_files_owner_id_users", "users", ["owner_id"], ["id"], ondelete="SET NULL"
            )
            batch_op.create_index("ix_files_owner_id", ["owner_id"])
    else:
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
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("files", recreate="always") as batch_op:
            batch_op.drop_index("ix_files_owner_id")
            batch_op.drop_constraint("fk_files_owner_id_users", type_="foreignkey")
            batch_op.drop_column("owner_id")
    else:
        op.drop_index("ix_files_owner_id", table_name="files")
        op.drop_constraint("fk_files_owner_id_users", "files", type_="foreignkey")
        op.drop_column("files", "owner_id")
