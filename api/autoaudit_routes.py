"""Connecting a company to AutoAudit sales accounts, and the webhook that asks for an early check."""
import hmac
import json
import os
import uuid

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from psycopg.errors import UniqueViolation
from starlette.concurrency import run_in_threadpool

import activity
from autoaudit_client import AutoAuditError, companies_from, configured, from_env
from company import _companies
from db import connect

router = APIRouter()
MAX_HOOK_BYTES = 64 * 1024
COLUMNS = 'id, sales_id, sales_name, agent_name, status, dataset_updated_at, last_checked_at, last_error'


class NewSource(BaseModel):
    sales_id: int
    agent_name: str


class CompanyLink(BaseModel):
    autoaudit_company_id: int | None = None


def _require_configured():
    if not configured():
        raise HTTPException(503, 'Sambungan AutoAudit belum dikonfigurasi di server')


def _sales():
    try:
        return from_env().list_sales()
    except AutoAuditError as exc:
        raise HTTPException(502, 'AutoAudit tidak dapat dihubungi') from exc


def _source_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(404, 'Sambungan tidak ditemukan') from None


def _link(conn) -> dict:
    """The AutoAudit company this workspace may pull from; both values are None when it has none."""
    return conn.execute(
        "SELECT autoaudit_company_id, autoaudit_company_name FROM xm.app_preferences WHERE company_id=current_setting('xm.workspace_id')"
    ).fetchone() or {'autoaudit_company_id': None, 'autoaudit_company_name': None}


def _offered(link: dict) -> list[dict]:
    """Only the sales of the linked AutoAudit company are ever offered or accepted."""
    return [{'id': item['id'], 'name': item['name'], 'company': item['company']}
            for item in _sales() if item.get('company_id') == link['autoaudit_company_id']]


# ------------------------------------------------------------------ platform admin: which AutoAudit company

@router.get('/admin/autoaudit/companies')
def autoaudit_companies():
    _require_configured()
    return companies_from(_sales())


@router.put('/admin/autoaudit/link/{company_id}')
def link_company(company_id: str, payload: CompanyLink):
    name = None
    if payload.autoaudit_company_id is not None:
        _require_configured()
        match = next((item for item in companies_from(_sales()) if item['id'] == payload.autoaudit_company_id), None)
        if not match:
            raise HTTPException(404, 'Company AutoAudit tidak ditemukan')
        name = match['name']
    with connect() as conn:
        updated = conn.execute(
            """UPDATE xm.app_preferences SET autoaudit_company_id=%s, autoaudit_company_name=%s, updated_at=now()
               WHERE company_id=%s RETURNING company_id""", (payload.autoaudit_company_id, name, company_id)).fetchone()
        if not updated:
            raise HTTPException(404, 'Company tidak ditemukan')
        activity.record(conn, 'change', 'autoaudit.link',
                        f'menghubungkan company ini ke company AutoAudit {activity.quote(name)}' if name else 'melepas hubungan company ini dengan company AutoAudit',
                        {'company_autoaudit': name, 'id_autoaudit': payload.autoaudit_company_id}, company_id=company_id)
        conn.commit()
        return _companies(conn, company_id)[0]


# ------------------------------------------------------------------ company: its own connections

@router.get('/autoaudit/sources')
def list_sources():
    with connect() as conn:
        link = _link(conn)
        rows = conn.execute(
            f"SELECT {COLUMNS} FROM xm.autoaudit_sources WHERE company_id=current_setting('xm.workspace_id') ORDER BY created_at").fetchall()
    return {'configured': configured(), 'linked': link['autoaudit_company_id'] is not None,
            'autoaudit_company_name': link['autoaudit_company_name'], 'sources': rows}


@router.get('/autoaudit/options')
def options():
    _require_configured()
    with connect() as conn:
        link = _link(conn)
        # Reusing the name of earlier uploads is what lets already imported messages be recognised.
        names = conn.execute(
            """SELECT agent_name FROM xm.imports WHERE company_id=current_setting('xm.workspace_id')
               GROUP BY agent_name ORDER BY max(created_at) DESC LIMIT 20""").fetchall()
    linked = link['autoaudit_company_id'] is not None
    return {'linked': linked, 'sales': _offered(link) if linked else [], 'agent_names': [row['agent_name'] for row in names]}


@router.post('/autoaudit/sources', status_code=201)
def connect_source(payload: NewSource, request: Request):
    _require_configured()
    agent_name = payload.agent_name.strip()
    if not agent_name or len(agent_name) > 100:
        raise HTTPException(400, 'Nama sumber wajib diisi, maksimal 100 karakter')
    with connect() as conn:
        link = _link(conn)
    if link['autoaudit_company_id'] is None:
        raise HTTPException(409, 'Company ini belum dihubungkan ke company AutoAudit')
    sales = next((item for item in _offered(link) if item['id'] == payload.sales_id), None)
    if not sales:
        raise HTTPException(404, 'Sales tidak ditemukan di company AutoAudit yang dihubungkan')
    with connect() as conn:
        try:
            row = conn.execute(
                f"""INSERT INTO xm.autoaudit_sources(id, sales_id, sales_name, agent_name, check_requested_at, created_by)
                    VALUES (%s,%s,%s,%s,now(),%s) RETURNING {COLUMNS}""",
                (uuid.uuid4(), sales['id'], sales['name'], agent_name, request.state.xm_user['id'])).fetchone()
        except UniqueViolation:
            raise HTTPException(409, 'Sales ini sudah tersambung ke company ini') from None
        activity.record(conn, 'change', 'autoaudit.connect', f"menyambungkan sales AutoAudit {sales['name']} sebagai {activity.quote(agent_name)}",
                        {'sales': sales['name'], 'id_sales': sales['id'], 'sumber': agent_name})
        conn.commit()
    return row


@router.post('/autoaudit/sources/{source_id}/sync', status_code=202)
def request_sync(source_id: str):
    """Manual sync: pull whatever AutoAudit has right now, without waiting for a newer dataset."""
    _require_configured()
    with connect() as conn:
        row = conn.execute(
            f"""UPDATE xm.autoaudit_sources SET check_requested_at=now(), force_requested=true
                WHERE id=%s AND company_id=current_setting('xm.workspace_id') RETURNING {COLUMNS}""", (_source_id(source_id),)).fetchone()
        if row:
            activity.record(conn, 'change', 'autoaudit.sync', f"meminta sinkronisasi sekarang untuk sales AutoAudit {row['sales_name']}",
                            {'sales': row['sales_name'], 'sumber': row['agent_name']})
        conn.commit()
    if not row:
        raise HTTPException(404, 'Sambungan tidak ditemukan')
    return row


@router.delete('/autoaudit/sources/{source_id}', status_code=204)
def disconnect_source(source_id: str):
    """Stops future pulls only; everything already imported stays."""
    with connect() as conn:
        row = conn.execute(
            "DELETE FROM xm.autoaudit_sources WHERE id=%s AND company_id=current_setting('xm.workspace_id') RETURNING id, sales_name, agent_name",
            (_source_id(source_id),)).fetchone()
        if row:
            activity.record(conn, 'change', 'autoaudit.disconnect', f"memutus sambungan sales AutoAudit {row['sales_name']} ({row['agent_name']})",
                            {'sales': row['sales_name'], 'sumber': row['agent_name']})
        conn.commit()
    if not row:
        raise HTTPException(404, 'Sambungan tidak ditemukan')
    return Response(status_code=204)


# ------------------------------------------------------------------ inbound webhook

def _request_check(sales_id: int) -> None:
    with connect() as conn:
        # Deliberately across companies: one sales account may feed several of them.
        conn.execute('UPDATE xm.autoaudit_sources SET check_requested_at=now() WHERE sales_id=%s', (sales_id,))
        conn.commit()


@router.post('/hooks/autoaudit/{token}')
async def webhook(token: str, request: Request):
    """Public and unsigned by AutoAudit: the token is the only guard, and the body is a nudge, never data."""
    expected = os.getenv('AUTOAUDIT_WEBHOOK_TOKEN', '').strip()
    if not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(404, 'Not Found')
    body = await request.body()
    try:
        payload = json.loads(body) if len(body) <= MAX_HOOK_BYTES else None
    except ValueError:
        payload = None
    if isinstance(payload, dict) and payload.get('event') == 'completed':
        data = payload.get('data')
        sales_id = data.get('sales_id') if isinstance(data, dict) else None
        if isinstance(sales_id, int) and not isinstance(sales_id, bool):
            await run_in_threadpool(_request_check, sales_id)
    return {'ok': True}
