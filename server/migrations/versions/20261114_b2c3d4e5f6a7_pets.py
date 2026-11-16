"""Pets: one persistent virtual pet per user."""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(40), nullable=False, server_default='旺财'),
        sa.Column('species', sa.String(16), nullable=False, server_default='dog'),
        sa.Column('satiety', sa.Float(), nullable=False, server_default='70'),
        sa.Column('cleanliness', sa.Float(), nullable=False, server_default='90'),
        sa.Column('mood', sa.Float(), nullable=False, server_default='80'),
        sa.Column('energy', sa.Float(), nullable=False, server_default='80'),
        sa.Column('health', sa.Float(), nullable=False, server_default='100'),
        sa.Column('sleeping', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('sick_since', sa.DateTime()),
        sa.Column('sleep_started_at', sa.DateTime()),
        sa.Column('care_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_care_date', sa.Date()),
        sa.Column('last_tick_at', sa.DateTime(), nullable=False),
        sa.Column('last_fed_at', sa.DateTime()),
        sa.Column('last_washed_at', sa.DateTime()),
        sa.Column('last_played_at', sa.DateTime()),
        sa.Column('last_walked_at', sa.DateTime()),
        sa.Column('last_vet_at', sa.DateTime()),
        sa.Column('last_treated_at', sa.DateTime()),
        sa.Column('last_petted_at', sa.DateTime()),
        sa.Column('poop_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('poop_progress', sa.Float(), nullable=False, server_default='0'),
        sa.Column('neglect_since', sa.DateTime()),
        sa.Column('pet_bonus_hour', sa.DateTime()),
        sa.Column('pet_bonus_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('treats', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('daily_bonus_date', sa.Date()),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_pets_user_id', 'pets', ['user_id'], unique=True)


def downgrade():
    op.drop_index('ix_pets_user_id', table_name='pets')
    op.drop_table('pets')
