"""Composite indexes for live note folders and table record pages."""
from alembic import op
revision = 'd14e62a583b7'
down_revision = 'c03a81df2742'
branch_labels = None
depends_on = None
def upgrade():
    op.create_index('ix_notes_folder_live_updated', 'notes', ['folder_id', 'deleted_at', 'updated_at'])
    op.create_index('ix_records_table_live_id', 'data_records', ['table_id', 'deleted_at', 'id'])
def downgrade():
    op.drop_index('ix_records_table_live_id', table_name='data_records')
    op.drop_index('ix_notes_folder_live_updated', table_name='notes')
