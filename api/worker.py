import os
import time

from db import connect, ensure_schema
from tenant import workspace_scope
from ingest import process_import
from integration import process_next_export


def claim_job():
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id FROM xm.imports
            WHERE status='queued'
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED LIMIT 1
            """
        ).fetchone()
        if row:
            conn.execute("UPDATE xm.imports SET status='processing', started_at=now() WHERE id=%s", (row["id"],))
            conn.commit()
            return str(row["id"])
    return None


def finish_maintenance(row, status, result=None, error=None):
    """Complete the active job and atomically honor ownership changes during it."""
    import json
    from matching_scope import queue_scope_recompute

    with workspace_scope(row['company_id']), connect() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(current_setting('xm.workspace_id'), 9042027))")
        job = conn.execute('SELECT result FROM xm.maintenance_jobs WHERE id=%s AND company_id=%s FOR UPDATE',
                           (row['id'], row['company_id'])).fetchone()
        if not job:
            return
        changed = bool((job['result'] or {}).get('scope_changed'))
        conn.execute('''UPDATE xm.maintenance_jobs SET status=%s,result=%s::jsonb,error=%s,finished_at=now()
          WHERE id=%s AND company_id=%s''',
          (status, json.dumps(result or {}), error, row['id'], row['company_id']))
        if changed:
            queue_scope_recompute(conn)
        conn.commit()


def process_maintenance():
    from reindex import reindex_documents
    from matcher import recompute_matches
    with connect() as conn:
        row=conn.execute("SELECT id,company_id FROM xm.maintenance_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1").fetchone()
        if not row: return False
        conn.execute("UPDATE xm.maintenance_jobs SET status='processing' WHERE id=%s",(row['id'],))
        conn.commit()
    try:
        with workspace_scope(row['company_id']):
            count=reindex_documents()
            matches=recompute_matches()
        finish_maintenance(row, 'completed', {'documents': count, 'matches': matches})
    except Exception as exc:
        finish_maintenance(row, 'failed', error=str(exc))
    return True


if __name__ == "__main__":
    ensure_schema()
    from entities import migrate_v4
    migrate_v4()
    with connect() as conn:
        conn.execute("UPDATE xm.maintenance_jobs SET status='queued' WHERE status='processing'")
        conn.commit()
    while True:
        if process_maintenance():
            continue
        job_id = claim_job()
        if job_id:
            try:
                process_import(job_id)
            except Exception as exc:
                print(f"Import {job_id} failed: {exc}", flush=True)
        elif process_next_export():
            continue
        else:
            time.sleep(float(os.getenv("WORKER_POLL_SECONDS", "2")))
