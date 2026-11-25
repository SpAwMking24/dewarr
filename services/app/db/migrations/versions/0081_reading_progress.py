"""Store per-user ebook reading progress for the built-in reader."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0081_reading_progress"
down_revision = "0080_member_setup"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "reading_progress",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("library_assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "work_id",
            UUID(as_uuid=True),
            sa.ForeignKey("works.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cfi", sa.Text(), nullable=True),
        sa.Column("fraction", sa.Float(), nullable=False, server_default="0"),
        sa.Column("chapter", sa.String(400), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "asset_id", name="uq_reading_progress_user_asset"),
        sa.CheckConstraint("fraction >= 0 AND fraction <= 1", name="ck_reading_progress_fraction"),
    )
    op.create_index("ix_reading_progress_user_id", "reading_progress", ["user_id"])
    op.create_index("ix_reading_progress_asset_id", "reading_progress", ["asset_id"])
    op.create_index("ix_reading_progress_work_id", "reading_progress", ["work_id"])


def downgrade():
    op.drop_index("ix_reading_progress_work_id", table_name="reading_progress")
    op.drop_index("ix_reading_progress_asset_id", table_name="reading_progress")
    op.drop_index("ix_reading_progress_user_id", table_name="reading_progress")
    op.drop_table("reading_progress")
