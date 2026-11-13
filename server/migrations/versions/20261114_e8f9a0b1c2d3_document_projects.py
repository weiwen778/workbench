"""Document workbench projects."""
from alembic import op
import sqlalchemy as sa

revision = 'e8f9a0b1c2d3'
down_revision = 'd6e7f8a9b0c1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'document_projects',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('state', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_document_projects_user_id', 'document_projects', ['user_id'])
    op.create_index(
        'ix_document_projects_user_kind_updated', 'document_projects',
        ['user_id', 'kind', 'updated_at'],
    )


def downgrade():
    op.drop_index('ix_document_projects_user_kind_updated', table_name='document_projects')
    op.drop_index('ix_document_projects_user_id', table_name='document_projects')
    op.drop_table('document_projects')
