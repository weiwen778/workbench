"""Account-specific names for the two check-in navigation items."""
from alembic import op
import sqlalchemy as sa

revision = 'c03a81df2742'
down_revision = 'b92f30a6e741'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('users', sa.Column('checkin_shop_label', sa.String(40), nullable=False, server_default='店铺打卡'))
    op.add_column('users', sa.Column('checkin_social_label', sa.String(40), nullable=False, server_default='社媒打卡'))

def downgrade():
    with op.batch_alter_table('users') as batch:
        batch.drop_column('checkin_social_label')
        batch.drop_column('checkin_shop_label')
