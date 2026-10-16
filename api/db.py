import hashlib
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from tenant import workspace_id

# Bump when the startup backfill (entities.migrate_v4) changes without schema.sql changing.
MIGRATION_VERSION = "v4"


def database_url() -> str:
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return explicit
    host = os.getenv("DATABASE_HOST", "host.docker.internal")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    database = os.getenv("POSTGRES_DB", "postgres")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def connect():
    # Docker's shared PostgreSQL has a small /dev/shm. Concurrent parallel
    # aggregates can exhaust it on the full archive; scope this to XM sessions.
    # A query whose client has gone (restart, Ctrl+C) is cancelled instead of
    # running on and holding locks that block the next startup's DDL.
    conn = psycopg.connect(database_url(), row_factory=dict_row,
                            options='-c max_parallel_workers_per_gather=0 -c work_mem=32MB'
                                    ' -c client_connection_check_interval=5s')
    conn.execute("SELECT set_config('xm.workspace_id',%s,false)", (workspace_id(),))
    return conn


def _applied_hash(conn):
    if conn.execute("SELECT to_regclass('xm.bootstrap_state') AS t").fetchone()["t"] is None:
        return None
    row = conn.execute("SELECT schema_hash FROM xm.bootstrap_state WHERE id = 1").fetchone()
    return row and row["schema_hash"]


def ensure_schema() -> None:
    """Apply schema.sql and the upgrade backfill only when they changed since the last success."""
    sql = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    digest = hashlib.sha256(f"{MIGRATION_VERSION}\n{sql}".encode()).hexdigest()
    with connect() as conn:
        # Routine restarts stop here: re-running the DDL takes exclusive table
        # locks that any long read on the archive would hold up.
        if _applied_hash(conn) == digest:
            return
        # API and worker both initialize this schema. The session lock spans the
        # DDL commit and the backfill, and is released when the connection closes.
        conn.execute("SELECT pg_advisory_lock(hashtext('xm.ensure_schema'))")
        if _applied_hash(conn) == digest:
            return
        conn.execute(sql)
        conn.commit()
        from entities import migrate_v4
        migrate_v4()
        conn.execute(
            """INSERT INTO xm.bootstrap_state(id, schema_hash, applied_at) VALUES (1, %s, now())
               ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = EXCLUDED.applied_at""",
            (digest,))
        conn.commit()
