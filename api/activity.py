"""Who did what, in plain sentences, for the platform administrator only.

Every action calls ``record`` with the connection of its own transaction, so a
change and its log line are stored (or rolled back) together. Things people
merely look at go through ``record_view``, which never gets in their way.
Nothing here may receive passwords, API keys, tokens or chat contents.
"""
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, HTTPException

from db import connect
from tenant import workspace_id

router = APIRouter(prefix='/admin/activity')
WIB = timezone(timedelta(hours=7))
LAYERS = ('change', 'account', 'export', 'view')
SUMMARY_LIMIT = 300
LIST_LIMIT = 50
MERGE_MINUTES = 10
SYSTEM = {'id': None, 'display_name': 'Sistem', 'email': None, 'role': 'system'}
_actor = ContextVar('xm_actor', default=None)
_UNSET = object()
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Shown in the "Jenis" filter. Every action code used anywhere must be listed here.
ACTIONS = {
    'import.upload': 'Unggah file', 'import.done': 'Impor selesai', 'import.failed': 'Impor gagal',
    'entity.status': 'Ubah status listing/buyer', 'search.company': 'Kata kunci company', 'search.personal': 'Kata kunci pribadi',
    'company.settings': 'Pengaturan company', 'match.settings': 'Toleransi dan bobot', 'glossary.save': 'Glosarium',
    'location.import': 'Indeks lokasi', 'stock.tracked': 'Nomor sales dipantau', 'stock.snapshot': 'Catat stok manual',
    'match.recompute': 'Hitung ulang match', 'index.recompute': 'Proses ulang data', 'index.done': 'Proses ulang selesai',
    'index.failed': 'Proses ulang gagal', 'autoaudit.connect': 'Sambungkan AutoAudit', 'autoaudit.disconnect': 'Putuskan AutoAudit',
    'autoaudit.sync': 'Minta sinkronisasi AutoAudit', 'autoaudit.pull': 'Tarikan AutoAudit', 'autoaudit.failed': 'Tarikan AutoAudit gagal',
    'autoaudit.link': 'Company AutoAudit',
    'auth.login': 'Masuk', 'auth.logout': 'Keluar', 'auth.login_failed': 'Gagal masuk', 'auth.password': 'Ganti password',
    'team.add': 'Tambah akun', 'team.edit': 'Ubah akun', 'company.create': 'Buat company', 'company.rename': 'Ubah nama company',
    'company.enter': 'Masuk ke company',
    'export.pdf': 'Unduh PDF', 'export.all': 'Unduh semua match', 'export.stock': 'Ekspor Excel stok',
    'page.open': 'Buka halaman', 'match.search': 'Pencarian di Cocokkan', 'match.detail': 'Buka rekomendasi',
    'stock.listings': 'Lihat listing sales', 'stock.history': 'Lihat riwayat stok',
}
STATUS_LABEL = {'ready': 'Ready', 'on_hold': 'On-hold', 'sold': 'Sold', 'deleted': 'Dihapus'}
ROLE_LABEL = {'user': 'anggota', 'company_admin': 'admin company', 'admin': 'administrator'}


@contextmanager
def actor_scope(user, as_admin=False):
    """The signed-in account of this request; ``as_admin`` when it is the administrator inside someone else's company."""
    token = _actor.set({'id': user['id'], 'display_name': user.get('display_name'), 'email': user.get('email'),
                        'role': user.get('role'), 'as_admin': bool(as_admin)})
    try:
        yield
    finally:
        _actor.reset(token)


def quote(value) -> str:
    return '"' + str(value).strip()[:80] + '"'


def listed(values, limit=3) -> str:
    """``"a", "b" dan 4 lainnya`` — enough to read, never a wall of text."""
    values = [str(item) for item in values]
    shown = ', '.join(quote(item) for item in values[:limit])
    return shown + (f' dan {len(values) - limit} lainnya' if len(values) > limit else '')


def number(value) -> str:
    return f'{int(value):,}'.replace(',', '.')


def _trim(value):
    """Details stay small: long lists end with how many were left out."""
    if isinstance(value, dict):
        return {str(key): _trim(item) for key, item in list(value.items())[:LIST_LIMIT]}
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        return [_trim(item) for item in items[:LIST_LIMIT]] + ([f'dan {len(items) - LIST_LIMIT} lainnya'] if len(items) > LIST_LIMIT else [])
    if isinstance(value, str):
        return value[:500]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:500]


def record(conn, layer, action, summary, details=None, *, failed=False, company_id=_UNSET, actor=None, merge=False, bump=True):
    """Add one line to the log inside the caller's transaction. The caller commits."""
    if layer not in LAYERS or action not in ACTIONS:
        raise ValueError(f'Aktivitas tidak dikenal: {layer}/{action}')
    who = actor or _actor.get() or SYSTEM
    company = workspace_id() if company_id is _UNSET else company_id
    name = None
    if company:
        row = conn.execute('SELECT company_name FROM xm.app_preferences WHERE company_id=%s', (company,)).fetchone()
        name = (row['company_name'] if row else None) or company
    summary = ' '.join(str(summary).split())[:SUMMARY_LIMIT]
    if merge:
        merged = conn.execute(
            f"""UPDATE xm.activity_log SET repeat_count=repeat_count+%s, last_at=now()
                WHERE id=(SELECT id FROM xm.activity_log WHERE action=%s AND summary=%s AND actor_id IS NOT DISTINCT FROM %s
                            AND actor_email IS NOT DISTINCT FROM %s AND company_id IS NOT DISTINCT FROM %s
                            AND last_at > now() - interval '{MERGE_MINUTES} minutes'
                          ORDER BY id DESC LIMIT 1) RETURNING id""",
            (1 if bump else 0, action, summary, who['id'], who.get('email'), company)).fetchone()
        if merged:
            return merged['id']
    return conn.execute(
        """INSERT INTO xm.activity_log(layer, action, actor_id, actor_name, actor_email, actor_role, company_id, company_name,
                                       as_admin, failed, summary, details)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING id""",
        (layer, action, who['id'], who.get('display_name') or who.get('email') or 'Tidak dikenal', who.get('email'), who.get('role'),
         company, name, bool(who.get('as_admin')), failed, summary, json.dumps(_trim(details or {}), default=str))).fetchone()['id']


def record_now(layer, action, summary, details=None, **options):
    """For actions that have no transaction of their own (a download, a finished job)."""
    with connect() as conn:
        record(conn, layer, action, summary, details, **options)
        conn.commit()


def record_view(action, summary, details=None, *, layer='view', bump=True):
    """Something a person looked at. Repeats within ten minutes share one line; a failure here never blocks them."""
    try:
        with connect() as conn:
            record(conn, layer, action, summary, details, merge=True, bump=bump)
            conn.commit()
    except Exception as exc:
        print(f'Activity log skipped ({action}): {type(exc).__name__}', flush=True)


def purge_views(days=None, batch=5000) -> int:
    """Drop "merely looked at" lines older than the retention period, a batch at a time."""
    days = int(days if days is not None else os.getenv('ACTIVITY_VIEW_RETENTION_DAYS', '90'))
    with connect() as conn:
        removed = conn.execute(
            """DELETE FROM xm.activity_log WHERE id IN (
                 SELECT id FROM xm.activity_log WHERE layer='view' AND last_at < now() - make_interval(days => %s) LIMIT %s)""",
            (days, batch)).rowcount
        conn.commit()
    return removed


# ------------------------------------------------------------------ reading (platform administrator only: /admin/*)

def _day(value, label):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f'{label} tidak valid.') from None


@router.get('')
def list_activity(company: str = '', actor: str = '', action: str = '', layers: str = 'change,account,export',
                  date_from: str = '', date_to: str = '', q: str = '', before: str = '', limit: int = 50):
    chosen = [item for item in dict.fromkeys(layers.split(',')) if item in LAYERS]
    clauses, params = ['layer = ANY(%s)'], [chosen]
    if company:
        clauses.append('company_id = %s')
        params.append(company)
    if actor == 'system':
        clauses.append('actor_id IS NULL AND actor_email IS NULL')
    elif actor:
        clauses.append('actor_email = %s')
        params.append(actor)
    if action:
        clauses.append('action = %s')
        params.append(action)
    if date_from:
        clauses.append('last_at >= %s')
        params.append(datetime.combine(_day(date_from, 'Tanggal awal'), time.min, WIB))
    if date_to:
        clauses.append('last_at < %s')
        params.append(datetime.combine(_day(date_to, 'Tanggal akhir') + timedelta(days=1), time.min, WIB))
    if q.strip():
        clauses.append("(summary ILIKE %s OR actor_name ILIKE %s OR coalesce(actor_email,'') ILIKE %s)")
        params += [f'%{q.strip()}%'] * 3
    if before:
        try:
            stamp, ident = before.split('_')
            clauses.append('(last_at, id) < (%s, %s)')
            params += [EPOCH + timedelta(microseconds=int(stamp)), int(ident)]
        except ValueError:
            raise HTTPException(400, 'Penanda halaman tidak valid.') from None
    limit = min(max(limit, 1), 200)
    with connect() as conn:
        rows = conn.execute(
            """SELECT id, last_at AS at, happened_at AS first_at, layer, action, actor_name, actor_email, actor_role, company_id,
                      company_name, as_admin, failed, summary, details, repeat_count
               FROM xm.activity_log WHERE """ + ' AND '.join(clauses) + ' ORDER BY last_at DESC, id DESC LIMIT %s',
            params + [limit + 1]).fetchall()
    page = rows[:limit]
    for row in page:
        row['action_label'] = ACTIONS.get(row['action'], row['action'])
    # Microseconds since 1970 keep the marker exact and free of characters a URL would mangle.
    marker = f"{(page[-1]['at'] - EPOCH) // timedelta(microseconds=1)}_{page[-1]['id']}" if len(rows) > limit else None
    return {'rows': page, 'next': marker}


@router.get('/filters')
def filters():
    with connect() as conn:
        companies = conn.execute(
            """SELECT company_id AS id, (array_agg(company_name ORDER BY id DESC))[1] AS name FROM xm.activity_log
               WHERE company_id IS NOT NULL GROUP BY company_id ORDER BY 2""").fetchall()
        actors = conn.execute(
            """SELECT actor_email AS email, (array_agg(actor_name ORDER BY id DESC))[1] AS name FROM xm.activity_log
               WHERE actor_email IS NOT NULL GROUP BY actor_email ORDER BY 2""").fetchall()
        used = {row['action'] for row in conn.execute('SELECT DISTINCT action FROM xm.activity_log').fetchall()}
    return {'companies': companies, 'actors': actors,
            'actions': [{'id': key, 'label': label} for key, label in ACTIONS.items() if key in used]}
