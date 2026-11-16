"""Information hub snapshots, subscriptions, entries and translation cache."""
from alembic import op
import sqlalchemy as sa

revision = 'd6e7f8a9b0c1'
down_revision = 'c5d6e7f8a9b0'
branch_labels = None
depends_on = None


def upgrade():
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


def downgrade():
    op.drop_index('ix_feed_translations_text_hash', table_name='feed_translations')
    op.drop_table('feed_translations')
    op.drop_index('ix_feed_entries_subscription_order', table_name='feed_entries')
    op.drop_index('ix_feed_entries_subscription_id', table_name='feed_entries')
    op.drop_table('feed_entries')
    op.drop_index('ix_feed_subscriptions_due', table_name='feed_subscriptions')
    op.drop_index('ix_feed_subscriptions_user_id', table_name='feed_subscriptions')
    op.drop_table('feed_subscriptions')
    op.drop_table('feed_snapshots')
