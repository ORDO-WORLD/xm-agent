"""Check-and-pull for AutoAudit sources. The worker calls this; imports themselves run through ingest.py unchanged."""
import hashlib
import json
import os
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import activity
from autoaudit_client import AutoAuditError, configured, from_env
from db import connect
from tenant import workspace_id, workspace_scope

OVERLAP_DAYS = 2
JAKARTA = ZoneInfo('Asia/Jakarta')


def today() -> date:
    return datetime.now(JAKARTA).date()


def start_date(last_sent: date | None, first_message: date | None) -> date | None:
    """Continue shortly before the newest message already stored; an empty source starts at its first message."""
    if last_sent:
        return last_sent - timedelta(days=OVERLAP_DAYS)
    return first_message


def chunk_ranges(start: date, end: date, days: int) -> list[tuple[date, date]]:
    ranges = []
    cursor = start
    while cursor <= end:
        last = min(cursor + timedelta(days=max(days, 1) - 1), end)
        ranges.append((cursor, last))
        cursor = last + timedelta(days=1)
    return ranges


def with_retry(action, attempts: int, delay: float, sleep=time.sleep):
    for attempt in range(1, max(attempts, 1) + 1):
        try:
            return action()
        except AutoAuditError as exc:
            if not exc.retryable or attempt >= attempts:
                raise
            sleep(delay)


def _setting(name: str, default: str) -> str:
    return os.getenv(name, '').strip() or default


# --------------------------------------------------------------------------- check-and-pull
UPLOAD_DIR = Path(os.getenv('UPLOAD_DIR', '/data/uploads'))


def _as_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def queue_import(agent_name: str, file_name: str, chats: dict) -> str | None:
    """Hand one downloaded range to the normal import queue. Returns None when there is nothing new to import."""
    if not any(chat.get('messages') for chat in chats.values() if isinstance(chat, dict)):
        return None
    # Stable serialisation: the same content always has the same SHA-256, so a repeated pull is skipped.
    body = json.dumps({'chats': chats}, ensure_ascii=False, sort_keys=True).encode('utf-8')
    digest = hashlib.sha256(body).hexdigest()
    import_id = uuid.uuid4()
    with connect() as conn:
        existing = conn.execute(
            "SELECT 1 FROM xm.imports WHERE company_id=current_setting('xm.workspace_id') AND agent_name=%s AND file_sha256=%s",
            (agent_name, digest)).fetchone()
        if existing:
            return None
        destination = UPLOAD_DIR / workspace_id() / f'{import_id}.json'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body)
        try:
            conn.execute(
                "INSERT INTO xm.imports(id, agent_name, file_name, file_path, file_sha256, source) VALUES (%s,%s,%s,%s,%s,'autoaudit')",
                (import_id, agent_name, file_name, str(destination), digest))
            conn.commit()
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    return str(import_id)


def _finish(source_id: str, status: str, error: str | None = None, dataset_updated_at: str | None = None) -> str:
    with connect() as conn:
        conn.execute(
            """UPDATE xm.autoaudit_sources SET status=%s, last_error=%s,
                 dataset_updated_at=coalesce(%s, dataset_updated_at) WHERE id=%s""",
            (status, error, dataset_updated_at, source_id))
        conn.commit()
    return status


def _pull(source: dict, client, sleep) -> str:
    source_id, agent_name, sales_id = str(source['id']), source['agent_name'], int(source['sales_id'])
    with connect() as conn:
        pending = conn.execute(
            """SELECT 1 FROM xm.imports WHERE company_id=current_setting('xm.workspace_id') AND agent_name=%s
               AND source='autoaudit' AND status IN ('queued','processing') LIMIT 1""", (agent_name,)).fetchone()
    if pending:
        # Let the previous pull finish first; a manual request stays pending for the next check.
        previous = source['status'] if source['status'] != 'pulling' else 'waiting'
        return _finish(source_id, previous, source['last_error'])
    force = bool(source['force_requested'])
    with connect() as conn:
        conn.execute('UPDATE xm.autoaudit_sources SET force_requested=false WHERE id=%s', (source_id,))
        conn.commit()
    with connect() as conn:
        linked = conn.execute(
            "SELECT autoaudit_company_id FROM xm.app_preferences WHERE company_id=current_setting('xm.workspace_id')").fetchone()
    linked_company = linked['autoaudit_company_id'] if linked else None
    if linked_company is None:
        return _finish(source_id, 'failed', 'Company ini belum dihubungkan ke company AutoAudit')
    summary = client.dataset_summary(sales_id)
    if summary.get('company_id') != linked_company:
        return _finish(source_id, 'failed', 'Sales ini di luar company AutoAudit yang dihubungkan')
    if not summary.get('has_cleaned_data'):
        return _finish(source_id, 'waiting')
    updated_at = str(summary.get('last_updated_at') or '')
    if not force and updated_at and updated_at == source['dataset_updated_at']:
        return _finish(source_id, 'current')
    # Derived from what is really stored, so a failed import is covered again by the next pull.
    with connect() as conn:
        last_sent = conn.execute(
            "SELECT max(sent_at)::date last_sent FROM xm.raw_messages WHERE company_id=current_setting('xm.workspace_id') AND agent_name=%s",
            (agent_name,)).fetchone()['last_sent']
    start = start_date(last_sent, _as_date(summary.get('first_message_date')))
    if not start:
        return _finish(source_id, 'waiting')
    attempts = int(_setting('AUTOAUDIT_RETRY_COUNT', '10'))
    delay = float(_setting('AUTOAUDIT_RETRY_SECONDS', '15'))
    queued = 0
    for first, last in chunk_ranges(start, today(), int(_setting('AUTOAUDIT_CHUNK_DAYS', '31'))):
        dataset = with_retry(lambda: client.download_range(sales_id, first, last), attempts, delay, sleep)
        queued += bool(queue_import(agent_name, f'autoaudit_sales_{sales_id}_{first}_{last}.json', dataset['chats']))
    if queued:
        activity.record_now('change', 'autoaudit.pull',
                            f"menarik data AutoAudit {source['sales_name']} ({agent_name}) dari {start} sampai {today()}: {queued} berkas baru",
                            {'sales': source['sales_name'], 'sumber': agent_name, 'dari': start, 'sampai': today(), 'berkas': queued,
                             'cara': 'sinkronisasi manual' if force else 'otomatis'})
    # Only now is the dataset considered pulled: a failure above leaves the marker untouched for the next check.
    return _finish(source_id, 'current', dataset_updated_at=updated_at or None)


def sync_source(source_id: str, client, sleep=time.sleep) -> str:
    """Check one connected sales account and pull what is new. Never raises; the outcome is the stored status."""
    with connect() as conn:
        source = conn.execute('SELECT * FROM xm.autoaudit_sources WHERE id=%s', (source_id,)).fetchone()
        if not source:
            return 'missing'
        conn.execute("UPDATE xm.autoaudit_sources SET status='pulling', check_requested_at=NULL, last_checked_at=now() WHERE id=%s",
                     (source_id,))
        conn.commit()
    try:
        with workspace_scope(source['company_id']):
            status = _pull(source, client, sleep)
    except AutoAuditError as exc:
        status = _finish(str(source_id), 'failed', str(exc)[:300])
    except Exception as exc:
        status = _finish(str(source_id), 'failed', f'{type(exc).__name__}: {exc}'[:300])
    if status == 'failed':
        _log_failure(source)
    return status


def _log_failure(source: dict) -> None:
    """A failing source is retried every few minutes; only a new failure, or a new reason, becomes a log line."""
    try:
        with workspace_scope(source['company_id']), connect() as conn:
            now = conn.execute('SELECT last_error FROM xm.autoaudit_sources WHERE id=%s', (source['id'],)).fetchone()
            reason = (now['last_error'] if now else None) or 'alasan tidak diketahui'
            if source['status'] == 'failed' and source['last_error'] == reason:
                return
            activity.record(conn, 'change', 'autoaudit.failed', f"gagal menarik data AutoAudit {source['sales_name']}: {reason}",
                            {'sales': source['sales_name'], 'sumber': source['agent_name'], 'alasan': reason}, failed=True)
            conn.commit()
    except Exception as exc:
        print(f'Activity log skipped (autoaudit.failed): {type(exc).__name__}', flush=True)


def claim_due() -> str | None:
    """One source that was asked for (webhook, manual) or has not been checked for AUTOAUDIT_CHECK_SECONDS."""
    with connect() as conn:
        row = conn.execute(
            """UPDATE xm.autoaudit_sources SET last_checked_at=now(), check_requested_at=NULL
               WHERE id=(SELECT id FROM xm.autoaudit_sources
                         WHERE status<>'pulling' AND (check_requested_at IS NOT NULL OR last_checked_at IS NULL
                               OR last_checked_at < now() - make_interval(secs => %s))
                         ORDER BY (check_requested_at IS NULL), check_requested_at, last_checked_at NULLS FIRST
                         FOR UPDATE SKIP LOCKED LIMIT 1)
               RETURNING id""", (float(_setting('AUTOAUDIT_CHECK_SECONDS', '600')),)).fetchone()
        conn.commit()
    return str(row['id']) if row else None


def run_once(client=None, sleep=time.sleep) -> bool:
    """Worker tick: sync at most one due source. False when there was nothing to do."""
    try:
        if client is None:
            if not configured():
                return False
            client = from_env()
        source_id = claim_due()
        if not source_id:
            return False
        status = sync_source(source_id, client, sleep)
        print(f'AutoAudit source {source_id}: {status}', flush=True)
        return True
    except Exception as exc:
        print(f'AutoAudit sync tick failed: {type(exc).__name__}', flush=True)
        return False


def reset_stuck() -> None:
    """A worker that died mid-pull leaves 'pulling' behind; check those again right away."""
    with connect() as conn:
        conn.execute("UPDATE xm.autoaudit_sources SET status='waiting', check_requested_at=now() WHERE status='pulling'")
        conn.commit()
