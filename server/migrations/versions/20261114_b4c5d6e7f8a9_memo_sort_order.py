"""Memo manual sort order."""
from alembic import op
import sqlalchemy as sa

revision = 'b4c5d6e7f8a9'
down_revision = 'a3b4c5d6e7f8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('memos', sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'))
    op.create_index('ix_memos_sort_order', 'memos', ['sort_order'])
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        'SELECT id FROM memos WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC'
    )).all()
    for index, (memo_id,) in enumerate(rows):
        bind.execute(sa.text('UPDATE memos SET sort_order = :order WHERE id = :id'), {'order': index, 'id': memo_id})


def downgrade():
    op.drop_index('ix_memos_sort_order', table_name='memos')
    op.drop_column('memos', 'sort_order')
