"""Persist explicitly created memo categories, including empty ones."""
from alembic import op
import sqlalchemy as sa
revision = 'd0e1f2a3b4c5'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade():
    inspector=sa.inspect(op.get_bind())
    if not inspector.has_table('memo_categories'):
        op.create_table('memo_categories', sa.Column('id', sa.Integer(), primary_key=True), sa.Column('name', sa.String(80), nullable=False, unique=True))
    elif not {'id','name'}.issubset({c['name'] for c in inspector.get_columns('memo_categories')}):
        raise RuntimeError('Existing memo_categories schema does not match this migration')
    op.execute("INSERT INTO memo_categories (name) SELECT DISTINCT category FROM memos WHERE deleted_at IS NULL AND category IS NOT NULL AND category <> '' AND NOT EXISTS (SELECT 1 FROM memo_categories c WHERE c.name=memos.category)")



def downgrade():
    op.drop_table('memo_categories')
