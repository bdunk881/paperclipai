import asyncio
import os
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Wire in your SQLAlchemy models' metadata once they exist, e.g.:
#   from app.db.base import Base
#   target_metadata = Base.metadata
target_metadata = None


def _get_url() -> str:
    """Return DATABASE_URL normalised to the asyncpg driver."""
    url = os.environ["DATABASE_URL"]
    # Normalise postgres:// → postgresql://
    url = url.replace("postgres://", "postgresql://", 1)
    # Inject asyncpg driver if not already present
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


def _do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = _get_url()
    engine = async_engine_from_config(cfg, prefix="sqlalchemy.", poolclass=NullPool)
    async with engine.connect() as conn:
        await conn.run_sync(_do_run_migrations)
    await engine.dispose()


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live DB connection (used for SQL script generation)."""
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against the live database."""
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
