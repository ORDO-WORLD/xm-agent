"""Company-scoped API keys and durable PDF export jobs for workflow consumers.

The API only queues/reads jobs. The existing xm-worker renders files, holds a
PostgreSQL session lock, and can reclaim interrupted jobs after a restart.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from auth import current_user
from db import connect
from export_all import Filters, MAX_PAGES, Part, folder, group_filename, merge_pdf_parts, part, plan, temperatures
from parser import normalize_phone
from tenant import workspace_id, workspace_scope
from workspace import stock_statuses
from periods import RelativePeriod, WIB

router = APIRouter(prefix='/integration')
FILE_DIR = Path(os.getenv('XM_INTEGRATION_EXPORT_DIR', '/data/integration-exports'))
RETENTION_DAYS = max(1, int(os.getenv('XM_INTEGRATION_EXPORT_DAYS', '7')))


def is_export_path(path):
    return path == '/integration/exports' or path.startswith('/integration/exports/')


def authenticate(request):
    """Bearer keys only grant access to export routes, never ordinary app routes."""
    authorization = request.headers.get('Authorization', '')
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token.startswith('xm_wf_') or len(token) > 200:
        raise HTTPException(401, 'Token integrasi diperlukan.')
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connect() as conn:
        key = conn.execute('''SELECT k.id,k.company_id FROM xm.integration_keys k
          JOIN xm.users u ON u.id=k.created_by
          WHERE k.token_hash=%s AND k.revoked_at IS NULL AND NOT u.is_locked
          AND u.role IN ('admin','company_admin')
          AND (u.role='admin' OR u.workspace_id=k.company_id)''', (digest,)).fetchone()
        if not key:
            raise HTTPException(401, 'Token integrasi tidak valid atau sudah dicabut.')
        if request.headers.get('X-XM-User-Id'):
            raise HTTPException(403, 'Token integrasi tidak dapat mengganti company.')
        conn.execute('UPDATE xm.integration_keys SET last_used_at=now() WHERE id=%s', (key['id'],))
        conn.commit()
    return key


class KeyRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=100)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('Nama integrasi wajib diisi.')
        return value.strip()


@router.post('/keys', status_code=201)
def create_key(payload: KeyRequest, request: Request):
    token = 'xm_wf_' + secrets.token_urlsafe(32)
    with connect() as conn:
        row = conn.execute('''INSERT INTO xm.integration_keys(id,company_id,created_by,name,token_hash)
          VALUES(%s,%s,%s,%s,%s) RETURNING id,name,created_at''',
          (uuid.uuid4(), workspace_id(), current_user(request)['id'], payload.name, hashlib.sha256(token.encode()).hexdigest())).fetchone()
        conn.commit()
    return {**row, 'token': token, 'scope': 'property:export', 'company_id': workspace_id()}


@router.get('/keys')
def list_keys():
    with connect() as conn:
        rows = conn.execute('''SELECT id,name,created_at,last_used_at,revoked_at FROM xm.integration_keys
          WHERE company_id=%s ORDER BY created_at DESC''', (workspace_id(),)).fetchall()
    return {'keys': rows}


@router.delete('/keys/{key_id}')
def revoke_key(key_id: uuid.UUID):
    with connect() as conn:
        row = conn.execute('''UPDATE xm.integration_keys SET revoked_at=coalesce(revoked_at,now())
          WHERE id=%s AND company_id=%s RETURNING id''', (key_id, workspace_id())).fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, 'Token tidak ditemukan.')
    return {'ok': True}


def valid_phone(value):
    phone = normalize_phone(value)
    return phone if re.fullmatch(r'628\d{8,12}', phone) else None


class ExportRequest(Filters):
    model_config = ConfigDict(extra='forbid')
    direction: Literal['buyer', 'property'] = 'property'
    request_id: str = Field(min_length=1, max_length=200)
    statuses: str = Field(default='hot,warm', max_length=64)
    stock_status: str = Field(default='ready', max_length=64)
    phones: str = Field(default='', max_length=20000)
    recipients: dict[str, str] = Field(default_factory=dict, max_length=10000)
    recipient_names: dict[str, str] = Field(default_factory=dict, max_length=10000)
    buyer_period: RelativePeriod | None = None
    listing_period: RelativePeriod | None = None

    @field_validator('request_id')
    @classmethod
    def request_id_value(cls, value):
        if not value.strip():
            raise ValueError('request_id wajib diisi.')
        return value.strip()

    @field_validator('recipients')
    @classmethod
    def recipient_values(cls, value):
        cleaned = {}
        for key, phone in value.items():
            normalized = valid_phone(phone)
            if not normalized:
                raise ValueError(f'Nomor penerima tidak valid untuk kelompok {key[:100]}.')
            cleaned[key] = normalized
        return cleaned

    @field_validator('recipient_names')
    @classmethod
    def name_values(cls, value):
        if any(not name.strip() or len(name) > 200 for name in value.values()):
            raise ValueError('Nama penerima wajib diisi, maksimal 200 karakter.')
        return {key: name.strip() for key, name in value.items()}

    @field_validator('delivery_scope')
    @classmethod
    def scope_value(cls, value):
        return value.strip()


def job_response(row):
    expired = row.get('expires_at') and row['expires_at'] <= datetime.now(timezone.utc)
    status = 'expired' if expired else row['status']
    return {'job_id': row['id'], 'request_id': row['request_id'], 'status': status,
            'group_by': row['payload']['group_by'], 'direction': row['payload']['direction'],
            'progress': row['progress'], 'files': [{k: v for k, v in item.items() if k != 'entity_pairs'}
                                                 for item in row['files']] if status == 'completed' else [],
            'periods': {k: row['payload'].get(k, '') for k in ('buyer_date_from', 'buyer_date_to', 'listing_date_from', 'listing_date_to')},
            'error': row['error'], 'created_at': row['created_at'], 'expires_at': row['expires_at'],
            'status_url': f"/api/integration/exports/{row['id']}", 'poll_after_seconds': 3}


@router.post('/exports', status_code=202)
def create_export(payload: ExportRequest):
    if any(item not in ('hot', 'warm', 'unmatched') for item in payload.statuses.split(',')):
        raise HTTPException(400, 'Status hasil harus hot, warm, atau unmatched.')
    temperatures(payload)
    stock_statuses(payload.stock_status)
    payload.windows(payload.direction)
    if payload.delivery_scope and 'unmatched' in payload.statuses.split(','):
        raise HTTPException(400, 'Report pasangan baru hanya mendukung Hot dan Warm.')
    # Freeze the company setting so later preference changes cannot change an in-flight job.
    with connect() as conn:
        existing = conn.execute('SELECT * FROM xm.export_jobs WHERE company_id=%s AND request_id=%s',
                                (workspace_id(), payload.request_id)).fetchone()
        # Retries on another WIB date must retain the original job's windows.
        today = (existing['created_at'] if existing else datetime.now(timezone.utc)).astimezone(WIB).date()
        if existing and existing['payload'].get('_period_day'):
            from datetime import date
            today = date.fromisoformat(existing['payload']['_period_day'])
        data = payload.model_dump()
        if payload.buyer_period or payload.listing_period:
            if payload.date_from or payload.date_to:
                raise HTTPException(400, 'Gunakan periode buyer/listing tanpa tanggal sumber lama.')
            data['_period_day'] = today.isoformat()
        for kind in ('buyer', 'listing'):
            period = getattr(payload, kind + '_period')
            if period:
                if getattr(payload, kind + '_date_from') or getattr(payload, kind + '_date_to'):
                    raise HTTPException(400, f'Pilih periode relatif atau tanggal {kind}, jangan keduanya.')
                data[kind + '_date_from'], data[kind + '_date_to'] = period.resolve(today)
        # Backward-compatible requests did not have these fields in stored payloads.
        old_data = {**ExportRequest(request_id=payload.request_id).model_dump(), **existing['payload']} if existing else None
        if existing:
            candidate = {**data, 'group_by': payload.group_by or existing['payload']['group_by']}
            if old_data != candidate:
                raise HTTPException(409, 'request_id sudah digunakan dengan filter atau penerima berbeda.')
            return job_response(existing)
        if data['group_by'] is None:
            from company import company_row
            data['group_by'] = company_row(conn)['listing_group_by'] or 'sender'
        row = conn.execute('''INSERT INTO xm.export_jobs(id,company_id,request_id,payload)
          VALUES(%s,%s,%s,%s::jsonb) ON CONFLICT(company_id,request_id) DO NOTHING RETURNING *''',
          (uuid.uuid4(), workspace_id(), payload.request_id, json.dumps(data))).fetchone()
        if not row:
            row = conn.execute('SELECT * FROM xm.export_jobs WHERE company_id=%s AND request_id=%s',
                               (workspace_id(), payload.request_id)).fetchone()
            if row['payload'] != data:
                raise HTTPException(409, 'request_id sudah digunakan dengan filter atau penerima berbeda.')
        conn.commit()
    return job_response(row)


class DeliveryReceipt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    delivery_id: str = Field(min_length=1, max_length=200)

    @field_validator('delivery_id')
    @classmethod
    def clean_id(cls, value):
        if not value.strip():
            raise ValueError('ID bukti pengiriman wajib diisi.')
        return value.strip()


@router.post('/exports/{job_id}/files/{file_id}/delivered')
def confirm_delivery(job_id: uuid.UUID, file_id: uuid.UUID, payload: DeliveryReceipt):
    """The consumer calls this only after WhatsApp confirms the file was sent."""
    with connect() as conn:
        row = conn.execute('SELECT * FROM xm.export_jobs WHERE id=%s AND company_id=%s FOR UPDATE',
                           (job_id, workspace_id())).fetchone()
        if not row:
            raise HTTPException(404, 'Job export tidak ditemukan.')
        if job_response(row)['status'] != 'completed':
            raise HTTPException(409, 'Export belum selesai atau sudah kedaluwarsa.')
        item = next((item for item in row['files'] if item['file_id'] == str(file_id)), None)
        if item is None:
            raise HTTPException(404, 'File export tidak ditemukan.')
        if item['recipient_status'] != 'ready':
            raise HTTPException(409, 'Penerima file masih perlu diperiksa.')
        scope = row['payload'].get('delivery_scope', '')
        if not scope:
            raise HTTPException(409, 'Export ini tidak memiliki delivery_scope.')
        if not item.get('delivered_at'):
            for buyer, listing in item.get('entity_pairs', []):
                conn.execute('''INSERT INTO xm.match_deliveries(company_id,delivery_scope,buyer_entity_id,listing_entity_id,delivery_id)
                  VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''', (workspace_id(), scope, buyer, listing, payload.delivery_id))
            item['delivered_at'] = datetime.now(timezone.utc).isoformat()
            item['delivery_id'] = payload.delivery_id
            conn.execute('UPDATE xm.export_jobs SET files=%s::jsonb WHERE id=%s AND company_id=%s',
                         (json.dumps(row['files']), job_id, workspace_id()))
        conn.commit()
    return {'file_id': str(file_id), 'delivered_at': item['delivered_at'], 'delivery_id': item['delivery_id']}


def read_job(job_id):
    with connect() as conn:
        row = conn.execute('SELECT * FROM xm.export_jobs WHERE id=%s AND company_id=%s', (job_id, workspace_id())).fetchone()
    if not row:
        raise HTTPException(404, 'Job export tidak ditemukan.')
    return row


@router.get('/exports/{job_id}')
def export_status(job_id: uuid.UUID):
    return job_response(read_job(job_id))


def job_folder(job_id):
    # A UUID is the only filesystem component provided by a client.
    return FILE_DIR / str(job_id)


@router.get('/exports/{job_id}/files/{file_id}')
def download_file(job_id: uuid.UUID, file_id: uuid.UUID):
    row = read_job(job_id)
    result = job_response(row)
    if result['status'] == 'expired':
        raise HTTPException(410, 'File export sudah kedaluwarsa. Buat job baru.')
    if result['status'] != 'completed':
        raise HTTPException(409, 'File belum siap diunduh.')
    item = next((item for item in result['files'] if item['file_id'] == str(file_id)), None)
    path = job_folder(job_id) / f'{file_id}.pdf'
    if item is None or not path.is_file():
        raise HTTPException(404, 'File export tidak ditemukan.')
    # Retain files for repeated downloads/retries; never delete on the first GET.
    return FileResponse(path, media_type='application/pdf', filename=item['filename'])


@router.delete('/exports/{job_id}')
def cancel_export(job_id: uuid.UUID):
    read_job(job_id)
    with connect() as conn:
        conn.execute("UPDATE xm.export_jobs SET status='cancelled',files='[]',finished_at=now() WHERE id=%s AND company_id=%s AND status IN ('queued','processing')",
                     (job_id, workspace_id()))
        conn.commit()
    return job_response(read_job(job_id))


def recipient_for(group, payload):
    mapped = payload['recipients'].get(group['key'])
    if mapped:
        return mapped, 'ready', 'mapping'
    if payload['group_by'] == 'phone':
        phone = valid_phone(group['key'])
        return phone, 'ready' if phone else 'needs_review', 'group_phone' if phone else 'missing_phone'
    # A representative listing phone is NOT proof of the sender's WhatsApp identity.
    return None, 'needs_review', 'sender_mapping_required'


def update_progress(job_id, progress):
    with connect() as conn:
        row = conn.execute("UPDATE xm.export_jobs SET progress=%s::jsonb WHERE id=%s AND company_id=%s AND status='processing' RETURNING id",
                           (json.dumps(progress), job_id, workspace_id())).fetchone()
        conn.commit()
    return bool(row)


def render_job(job):
    payload = job['payload']
    filters = Filters.model_validate({key: value for key, value in payload.items() if key in Filters.model_fields})
    # Integration export has company-admin authority and does not impersonate a browser user.
    with connect() as conn:
        import workspace_cache
        if not workspace_cache.ready(conn) and conn.execute("SELECT EXISTS(SELECT 1 FROM xm.documents WHERE company_id=%s) AS found", (workspace_id(),)).fetchone()['found']:
            raise HTTPException(409, 'Hasil pencocokan sedang disiapkan. Buat job lagi setelah proses data selesai.')
    prepared = plan(filters, None)
    token = prepared['token']
    output = job_folder(job['id'])
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)
    files, page = [], 1
    groups = prepared['groups']
    progress = {'groups_total': len(groups), 'groups_done': 0, 'pages_done': 0,
                'pages_estimated': prepared['totals']['pages'] + len(groups)}
    try:
        for index, group in enumerate(groups):
            if group['pages'] + 1 > MAX_PAGES:
                raise HTTPException(400, f"Kelompok {group['title'][:100]} melebihi batas {MAX_PAGES} halaman.")
            offset, first, entity_pairs = 0, page, set()
            while offset is not None:
                if not update_progress(job['id'], progress):
                    return
                done = part(Part(**filters.model_dump(), token=token, index=index, group_key=group['key'], offset=offset, first_page=page), None)
                page += done['pages']
                entity_pairs.update(tuple(pair) for pair in done['entity_pairs'])
                offset = done['next_offset']
                progress['pages_done'] = page - 1
            parts = sorted(folder(token).glob(f'{index:05d}-*.pdf'))
            if parts:
                content, count = merge_pdf_parts(parts)
                if count > MAX_PAGES:
                    raise HTTPException(400, 'PDF kelompok melebihi batas halaman.')
                file_id = uuid.uuid4()
                metadata = {**group, 'group_by': payload['group_by'], 'direction': filters.direction, 'first_page': first}
                recipient, state, reason = recipient_for(group, payload)
                filename = group_filename(index, metadata, count)
                (output / f'{file_id}.pdf').write_bytes(content)
                files.append({'file_id': str(file_id), 'group_key': group['key'], 'group_name': group['title'],
                              'contact_name': group['contact_name'], 'contact_phone': group['phone'],
                              'recipient_phone': recipient, 'recipient_status': state, 'recipient_reason': reason,
                              'recipient_name': payload.get('recipient_names', {}).get(group['key'], group['contact_name']),
                              'entity_pairs': sorted(entity_pairs),
                              'filename': filename, 'mime': 'application/pdf', 'size_bytes': len(content),
                              'source_count': group['sources'], 'source_type': 'buyer' if filters.direction == 'buyer' else 'listing',
                              'page_count': count, 'first_page': first, 'last_page': first + count - 1,
                              'download_url': f"/api/integration/exports/{job['id']}/files/{file_id}"})
                # Finished group parts no longer need disk space.
                for item in parts:
                    item.unlink()
            progress['groups_done'] = index + 1
        with connect() as conn:
            row = conn.execute("""UPDATE xm.export_jobs SET status='completed',progress=%s::jsonb,files=%s::jsonb,
              finished_at=now(),expires_at=now()+(%s * interval '1 day') WHERE id=%s AND company_id=%s AND status='processing' RETURNING id""",
              (json.dumps(progress), json.dumps(files), RETENTION_DAYS, job['id'], workspace_id())).fetchone()
            conn.commit()
        if not row:
            shutil.rmtree(output, ignore_errors=True)
    finally:
        shutil.rmtree(folder(token), ignore_errors=True)
        # Cancelled and failed runs must never leave publishable files.
        if read_job(job['id'])['status'] != 'completed':
            shutil.rmtree(output, ignore_errors=True)


def cleanup_expired():
    with connect() as conn:
        rows = conn.execute("UPDATE xm.export_jobs SET status='expired',files='[]' WHERE status='completed' AND expires_at<=now() RETURNING id").fetchall()
        conn.commit()
    for row in rows:
        shutil.rmtree(job_folder(row['id']), ignore_errors=True)


def process_next_export():
    """A session advisory lock prevents concurrent workers from resuming the same job.

    A dead worker releases its lock automatically; a processing row is reclaimed
    by the next worker and rebuilt from the start. Jobs are polled, never pushed
    to WhatsApp here, so this recovery cannot itself send duplicate messages.
    """
    cleanup_expired()
    with connect() as claim:
        candidates = claim.execute("SELECT id FROM xm.export_jobs WHERE status IN ('queued','processing') ORDER BY created_at LIMIT 50").fetchall()
        for candidate in candidates:
            key = str(candidate['id'])
            locked = claim.execute('SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS locked', (key,)).fetchone()['locked']
            if not locked:
                continue
            try:
                job = claim.execute("UPDATE xm.export_jobs SET status='processing',started_at=now(),progress='{}',files='[]',error=NULL WHERE id=%s AND status IN ('queued','processing') RETURNING *", (candidate['id'],)).fetchone()
                claim.commit()
                if not job:
                    continue
                with workspace_scope(job['company_id']):
                    try:
                        render_job(job)
                    except Exception as exc:
                        message = str(exc.detail) if isinstance(exc, HTTPException) else 'Export gagal diproses. Periksa log worker.'
                        shutil.rmtree(job_folder(job['id']), ignore_errors=True)
                        print(f"Integration export {key} failed: {exc}", flush=True)
                        with connect() as conn:
                            conn.execute("UPDATE xm.export_jobs SET status='failed',error=%s,finished_at=now() WHERE id=%s AND company_id=%s AND status='processing'",
                                         (message[:1000], job['id'], workspace_id()))
                            conn.commit()
                return True
            finally:
                claim.execute('SELECT pg_advisory_unlock(hashtextextended(%s, 0))', (key,))
                claim.commit()
    return False
