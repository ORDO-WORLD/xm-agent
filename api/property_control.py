"""Scoped AutoAudit control tickets and native XM settings with a validated SSO session."""
import hashlib
import hmac
import re
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

import activity
import sso
from db import connect
from tenant import workspace_id

router = APIRouter(prefix='/property-control')

SETTINGS = {
    '/company/settings', '/search-default', '/search-default/personal', '/preferences',
    '/settings', '/glossary', '/location-index', '/location-index/preview', '/location-index/import',
    '/stock/overview', '/stock/tracked', '/autoaudit/sources', '/autoaudit/options', '/location-index/neighbors', '/property-control/members',
    '/integration/keys', '/index/recompute', '/index/status', '/matches/recompute', '/locations/import', '/property-control/company/lock',
}


def setting_path(path):
    return path in SETTINGS or bool(re.fullmatch(r'/(?:integration/keys|autoaudit/sources)/[0-9a-f-]{36}(?:/sync)?', path)) or bool(re.fullmatch(r'/property-control/members/[1-9]\d*/lock', path))


def needs_control(method, path):
    return path.startswith('/property-control/')


def browser_context(request, as_admin=False):
    """Reuse the actor freshly validated by current_user; never accept browser actor IDs."""
    origin = request.headers.get('origin')
    host = request.headers.get('x-forwarded-host', request.headers.get('host', '')).split(',')[0].strip()
    scheme = request.headers.get('x-forwarded-proto', request.url.scheme).split(',')[0].strip()
    if origin != f'{scheme}://{host}':
        raise HTTPException(403, 'Perubahan pengaturan harus berasal dari halaman XM.')
    actor = getattr(request.state, 'property_actor', None)
    if not actor:
        raise HTTPException(401, 'Sesi AutoAudit diperlukan.')
    return {'actor': actor, 'companyId': actor.get('companyId'), 'eventId': str(uuid.uuid4()),
            'auditEligible': bool(getattr(request.state, 'property_audit_eligible', False)) and not as_admin}


async def resolve(request):
    ticket = request.headers.get('x-autoaudit-property-control')
    if not setting_path(request.url.path):
        raise HTTPException(403, 'Tiket pengaturan tidak berlaku untuk aksi ini.')
    answer = await run_in_threadpool(sso.exchange, ticket, control=True)
    body = await request.body()
    if not answer or answer.get('exp', 0) <= time.time()*1000 or answer.get('method') != request.method or answer.get('path') != request.url.path or answer.get('query', '') != request.url.query or not hmac.compare_digest(answer.get('bodyHash', ''), hashlib.sha256(body).hexdigest()):
        raise HTTPException(401, 'Tiket pengaturan tidak sesuai request.')
    actor = answer['actor']
    sso.identity_key(actor)
    target = answer['companyId']
    if actor['role'] != 'superadmin' and actor['companyId'] != target:
        raise HTTPException(403, 'Company tidak sesuai akun.')
    user, workspace = await run_in_threadpool(provision_control, answer)
    if user['is_locked']:
        raise HTTPException(403, 'Akses Property terkunci.')
    request.state.property_control = answer
    request.state.xm_user = user
    return user, workspace


def provision_control(answer):
    actor, target = answer['actor'], answer['companyId']
    # Separate from HTTP validation: no DB connection spans applications or blocks the event loop.
    with connect() as conn:
        user = sso.provision_identity(conn, actor, log_login=False)
        workspace = sso.company_workspace(conn, target, answer['companyName'])
        conn.commit()
    return user, workspace


class LockPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    is_locked: bool


@router.put('/company/lock')
def lock_company(payload: LockPayload, request: Request):
    if request.state.xm_user['role'] != 'admin':
        raise HTTPException(403, 'Hanya Superadmin dapat mengunci Company.')
    ctx = request.state.property_control
    actor = {'role': 'company', 'actorType': 'company', 'actorId': ctx['companyId'], 'companyId': ctx['companyId'], 'name': ctx['companyName']}
    with connect() as conn:
        user = sso.provision_identity(conn, actor, log_login=False)
        if user['is_locked'] != payload.is_locked:
            conn.execute('UPDATE xm.users SET is_locked=%s WHERE id=%s', (payload.is_locked, user['id']))
            activity.record(conn, 'account', 'team.edit', 'mengubah kunci akses Property Company', {'user_id': str(user['id']), 'is_locked': payload.is_locked})
        conn.commit()
    return {'is_locked': payload.is_locked}


@router.get('/members')
def members(request: Request, offset: int = 0):
    if request.state.xm_user['role'] not in ('admin', 'company_admin'):
        raise HTTPException(403, 'Hanya pengelola Company.')
    with connect() as conn:
        rows = conn.execute("SELECT autoaudit_key,display_name,is_locked FROM xm.users WHERE workspace_id=%s AND autoaudit_key LIKE 'superior:%%' ORDER BY display_name,id LIMIT 51 OFFSET %s", (workspace_id(), max(0, offset))).fetchall()
    return {'members': [{'display_name': row['display_name'], 'is_locked': row['is_locked'], 'superior_id': int(row['autoaudit_key'].split(':')[1])} for row in rows[:50]], 'has_more': len(rows) > 50}


@router.put('/members/{superior_id}/lock')
def lock_member(superior_id: int, payload: LockPayload, request: Request):
    ctx = request.state.property_control
    actor = ctx.get('targetActor')
    if not actor or actor['actorId'] != superior_id or actor['companyId'] != ctx['companyId'] or actor['actorType'] != 'superior':
        raise HTTPException(403, 'Anggota tidak sesuai request.')
    if request.state.xm_user['role'] not in ('admin', 'company_admin'):
        raise HTTPException(403, 'Hanya pengelola Company.')
    with connect() as conn:
        user = sso.provision_identity(conn, actor, log_login=False)
        if user['workspace_id'] != workspace_id():
            raise HTTPException(403, 'Company anggota tidak sesuai.')
        if user['is_locked'] != payload.is_locked:
            conn.execute('UPDATE xm.users SET is_locked=%s WHERE id=%s', (payload.is_locked, user['id']))
            activity.record(conn, 'account', 'team.edit', 'mengunci akses Property' if payload.is_locked else 'membuka akses Property', {'user_id': str(user['id']), 'is_locked': payload.is_locked})
        conn.commit()
    return {'is_locked': payload.is_locked}
