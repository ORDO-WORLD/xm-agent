import os
import time

from db import connect, ensure_schema
from tenant import workspace_scope
from ingest import process_import
import activity
from autoaudit_sync import reset_stuck, run_once as sync_autoaudit


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


def process_maintenance():
    import json
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
        with connect() as conn:
            conn.execute("UPDATE xm.maintenance_jobs SET status='completed',result=%s::jsonb,finished_at=now() WHERE id=%s",(json.dumps({'documents':count,'matches':matches}),row['id']))
            activity.record(conn, 'change', 'index.done', f'selesai memproses ulang data: {activity.number(count)} data, {activity.number(matches)} match',
                            {'data': count, 'match': matches}, company_id=row['company_id'])
            conn.commit()
    except Exception as exc:
        with connect() as conn:
            conn.execute("UPDATE xm.maintenance_jobs SET status='failed',error=%s,finished_at=now() WHERE id=%s",(str(exc),row['id']))
            activity.record(conn, 'change', 'index.failed', f'gagal memproses ulang data: {str(exc)[:160]}', {'alasan': str(exc)[:500]},
                            failed=True, company_id=row['company_id'])
            conn.commit()
    return True


if __name__ == "__main__":
    ensure_schema()
    from entities import migrate_v4
    migrate_v4()
    with connect() as conn:
        conn.execute("UPDATE xm.maintenance_jobs SET status='queued' WHERE status='processing'")
        conn.commit()
    reset_stuck()
    purged_at = 0.0
    while True:
        if time.monotonic() - purged_at > 86400 or not purged_at:
            # Once a day, a batch at a time: "merely looked at" lines past their retention period.
            purged_at = time.monotonic()
            try:
                while activity.purge_views() >= 5000:
                    pass
            except Exception as exc:
                print(f'Activity purge failed: {type(exc).__name__}', flush=True)
        if process_maintenance():
            continue
        job_id = claim_job()
        if job_id:
            try:
                process_import(job_id)
            except Exception as exc:
                print(f"Import {job_id} failed: {exc}", flush=True)
        elif not sync_autoaudit():
            # Queued imports always go first; AutoAudit sources are only checked while idle.
            time.sleep(float(os.getenv("WORKER_POLL_SECONDS", "2")))

