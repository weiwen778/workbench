"""Remove legacy information-hub and pet tables.

The information hub (feeds), media parser and pet modules were removed from the
application. Their schema history stays intact, but the tables are no longer
used and are dropped here.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


LEGACY_TABLES = (
    'feed_entries',
    'feed_subscriptions',
    'feed_snapshots',
    'feed_translations',
    'pets',
)


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table in LEGACY_TABLES:
        if inspector.has_table(table):
            op.drop_table(table)


def downgrade():
    # DDL intentionally mirrors the historical feeds/pets migrations so this
    # revision stays self-contained and past revisions remain untouched.
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('feed_snapshots'):
        op.create_table(
            'feed_snapshots',
            sa.Column('source_id', sa.String(40), primary_key=True),
            sa.Column('entries', sa.JSON(), nullable=False),
            sa.Column('provider', sa.String(120), nullable=False),
            sa.Column('provider_note', sa.String(300), nullable=False),
            sa.Column('upstream_updated_at', sa.DateTime()),
            sa.Column('fetched_at', sa.DateTime()),
            sa.Column('last_attempt_at', sa.DateTime()),
            sa.Column('last_success_at', sa.DateTime()),
            sa.Column('last_error', sa.String(1000)),
            sa.Column('error_code', sa.String(64)),
            sa.Column('etag', sa.String(500)),
            sa.Column('last_modified', sa.String(500)),
            sa.Column('consecutive_failures', sa.Integer(), nullable=False),
            sa.Column('next_attempt_at', sa.DateTime()),
            sa.Column('locked_until', sa.DateTime()),
        )
    if not inspector.has_table('feed_subscriptions'):
        op.create_table(
            'feed_subscriptions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('url', sa.String(2048), nullable=False),
            sa.Column('url_key', sa.String(64), nullable=False),
            sa.Column('title', sa.String(200), nullable=False),
            sa.Column('feed_kind', sa.String(16), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False),
            sa.Column('is_default', sa.Boolean(), nullable=False),
            sa.Column('default_key', sa.String(40)),
            sa.Column('etag', sa.String(500)),
            sa.Column('last_modified', sa.String(500)),
            sa.Column('last_attempt_at', sa.DateTime()),
            sa.Column('last_success_at', sa.DateTime()),
            sa.Column('last_error', sa.String(1000)),
            sa.Column('error_code', sa.String(64)),
            sa.Column('consecutive_failures', sa.Integer(), nullable=False),
            sa.Column('next_attempt_at', sa.DateTime()),
            sa.Column('locked_until', sa.DateTime()),
            sa.Column('deleted_at', sa.DateTime()),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('user_id', 'url_key', name='uq_feed_subscription_user_url'),
        )
        op.create_index('ix_feed_subscriptions_user_id', 'feed_subscriptions', ['user_id'])
        op.create_index(
            'ix_feed_subscriptions_due', 'feed_subscriptions',
            ['enabled', 'deleted_at', 'next_attempt_at'],
        )
    if not inspector.has_table('feed_entries'):
        op.create_table(
            'feed_entries',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('feed_subscriptions.id', ondelete='CASCADE'), nullable=False),
            sa.Column('entry_key', sa.String(64), nullable=False),
            sa.Column('external_id', sa.String(512), nullable=False),
            sa.Column('title', sa.String(1000), nullable=False),
            sa.Column('url', sa.String(2048), nullable=False),
            sa.Column('summary', sa.Text(), nullable=False),
            sa.Column('language', sa.String(16), nullable=False),
            sa.Column('link_kind', sa.String(16), nullable=False),
            sa.Column('discussion_url', sa.String(2048), nullable=False),
            sa.Column('published_at', sa.DateTime()),
            sa.Column('discovered_at', sa.DateTime(), nullable=False),
            sa.Column('read_at', sa.DateTime()),
            sa.Column('favorite_at', sa.DateTime()),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('subscription_id', 'entry_key', name='uq_feed_entry_subscription_key'),
        )
        op.create_index('ix_feed_entries_subscription_id', 'feed_entries', ['subscription_id'])
        op.create_index(
            'ix_feed_entries_subscription_order', 'feed_entries',
            ['subscription_id', 'published_at', 'discovered_at'],
        )
    if not inspector.has_table('feed_translations'):
        op.create_table(
            'feed_translations',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('text_hash', sa.String(64), nullable=False),
            sa.Column('target_lang', sa.String(16), nullable=False),
            sa.Column('source_text', sa.Text(), nullable=False),
            sa.Column('target_text', sa.Text(), nullable=False),
            sa.Column('provider', sa.String(20), nullable=False),
            sa.Column('model', sa.String(100)),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('text_hash', 'target_lang', name='uq_feed_translation_text_lang'),
        )
        op.create_index('ix_feed_translations_text_hash', 'feed_translations', ['text_hash'])
    if not inspector.has_table('pets'):
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
