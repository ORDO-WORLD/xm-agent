"""Company-level settings and, for the platform administrator, company management."""
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from psycopg.errors import UniqueViolation

import activity
from access import permissions
from auth import _password_hash, current_user
from db import connect
from stock import tracked_phones
from tenant import owner_id, provision_company, workspace_id

router = APIRouter()


def company_row(conn):
    return conn.execute(
        """SELECT company_name, search_terms, search_locked, listing_group_by
           FROM xm.app_preferences WHERE company_id = current_setting('xm.workspace_id')""").fetchone() or {
        'company_name': None, 'search_terms': [], 'search_locked': False, 'listing_group_by': 'sender'}


def personal_terms(conn, user_key):
    row = conn.execute('SELECT preferences FROM xm.user_preferences WHERE user_id = %s', (user_key,)).fetchone()
    terms = (row['preferences'] if row else {}).get('search_terms')
    return [item for item in terms if isinstance(item, str) and item.strip()] if isinstance(terms, list) else None


def effective_terms(role, company, personal):
    """Company keywords win when locked or when a member has no personal list."""
    if role == 'user' and not company['search_locked'] and personal:
        return personal
    return list(company['search_terms'])


@router.get('/company/settings')
def get_company_settings(request: Request):
    user = current_user(request)
    with connect() as conn:
        company = company_row(conn)
        mine = personal_terms(conn, owner_id() or user['id'])
        phones = tracked_phones(conn, workspace_id())
    if request.method == 'GET' and user['role'] == 'admin' and user.get('workspace_id') != workspace_id():
        # The screen loads this when the administrator steps into a company.
        activity.record_view('company.enter', f"masuk ke company {company['company_name'] or workspace_id()}", layer='account', bump=False)
    return {
        'company_name': company['company_name'], 'listing_group_by': company['listing_group_by'],
        'search_locked': company['search_locked'], 'search_terms': company['search_terms'],
        'personal_terms': mine, 'effective_terms': effective_terms(user['role'], company, mine),
        'tracked_phones': phones, 'role': user['role'], 'permissions': permissions(user['role'], company['search_locked']),
    }


class CompanyUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=120)
    listing_group_by: Literal['sender', 'phone'] | None = None
    search_locked: bool | None = None


@router.put('/company/settings')
def put_company_settings(payload: CompanyUpdate, request: Request):
    changes = payload.model_dump(exclude_none=True)
    if 'company_name' in changes:
        changes['company_name'] = changes['company_name'].strip()
        if not changes['company_name']:
            raise HTTPException(400, 'Nama company wajib diisi.')
    if changes:
        # Column names come from the fixed model above, never from the client.
        sets = ', '.join(f'{column} = %s' for column in changes)
        with connect() as conn:
            before = company_row(conn)
            conn.execute(f"UPDATE xm.app_preferences SET {sets}, updated_at = now() WHERE company_id = current_setting('xm.workspace_id')",
                         tuple(changes.values()))
            parts = []
            if 'company_name' in changes and changes['company_name'] != before['company_name']:
                parts.append(f"mengubah nama company dari {activity.quote(before['company_name'] or '-')} ke {activity.quote(changes['company_name'])}")
            if 'listing_group_by' in changes and changes['listing_group_by'] != before['listing_group_by']:
                parts.append('mengelompokkan listing per ' + ('nomor telepon' if changes['listing_group_by'] == 'phone' else 'pengirim'))
            if 'search_locked' in changes and changes['search_locked'] != before['search_locked']:
                parts.append('mengunci kata kunci' if changes['search_locked'] else 'membuka kunci kata kunci')
            if parts:
                activity.record(conn, 'change', 'company.settings', ', '.join(parts),
                                {'sebelum': {key: before[key] for key in changes}, 'sesudah': changes})
            conn.commit()
    return get_company_settings(request)


# --- platform administrator --------------------------------------------------

class NewCompany(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    admin_name: str = Field(min_length=1, max_length=100)
    admin_email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RenameCompany(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _companies(conn, only=None):
    rows = conn.execute(
        """WITH ids AS (SELECT DISTINCT workspace_id AS company_id FROM xm.users WHERE workspace_id IS NOT NULL)
           SELECT i.company_id, ap.company_name, ap.search_locked, ap.listing_group_by, ap.autoaudit_company_id, ap.autoaudit_company_name,
                  (SELECT count(*) FROM xm.document_groups g WHERE g.company_id = i.company_id AND g.document_type = 'buyer_request' AND g.status <> 'deleted') AS buyers,
                  (SELECT count(*) FROM xm.document_groups g WHERE g.company_id = i.company_id AND g.document_type = 'property_listing' AND g.status <> 'deleted') AS listings
           FROM ids i LEFT JOIN xm.app_preferences ap ON ap.company_id = i.company_id
           WHERE (%s::text IS NULL OR i.company_id = %s) ORDER BY ap.company_name NULLS LAST, i.company_id""", (only, only)).fetchall()
    users = conn.execute(
        """SELECT id, email, display_name, role, is_locked, created_at, workspace_id FROM xm.users
           WHERE workspace_id IS NOT NULL ORDER BY (role = 'user'), created_at""").fetchall()
    by_company = {}
    for user in users:
        by_company.setdefault(user['workspace_id'], []).append({key: user[key] for key in ('id', 'email', 'display_name', 'role', 'is_locked', 'created_at')})
    result = []
    for row in rows:
        members = by_company.get(row['company_id'], [])
        # The account the platform admin acts as when entering this company's workspace.
        owner = next((u for u in members if u['role'] == 'company_admin'), None) or (members[0] if members else None)
        result.append({**row, 'name': row['company_name'] or row['company_id'], 'users': members,
                       'owner_id': owner['id'] if owner else None})
    return result


@router.get('/admin/companies')
def list_companies():
    activity.record_view('page.open', 'membuka Perusahaan')
    with connect() as conn:
        return _companies(conn)


@router.post('/admin/companies', status_code=201)
def create_company(payload: NewCompany):
    company_id = 'xm-co-' + str(uuid.uuid4())
    try:
        with connect() as conn:
            conn.execute(
                """INSERT INTO xm.users(id, email, display_name, password_hash, role, workspace_id)
                   VALUES (%s, %s, %s, %s, 'company_admin', %s)""",
                (uuid.uuid4(), payload.admin_email.strip().lower(), payload.admin_name.strip(),
                 _password_hash(payload.password), company_id))
            provision_company(conn, company_id, payload.name.strip())
            activity.record(conn, 'account', 'company.create',
                            f'membuat company {activity.quote(payload.name.strip())} dengan admin {payload.admin_email.strip().lower()}',
                            {'company': payload.name.strip(), 'admin': payload.admin_email.strip().lower()}, company_id=company_id)
            conn.commit()
            return _companies(conn, company_id)[0]
    except UniqueViolation:
        raise HTTPException(409, 'Email sudah terdaftar')


@router.put('/admin/companies/{company_id}')
def rename_company(company_id: str, payload: RenameCompany):
    with connect() as conn:
        before = conn.execute('SELECT company_name FROM xm.app_preferences WHERE company_id = %s FOR UPDATE', (company_id,)).fetchone()
        updated = conn.execute('UPDATE xm.app_preferences SET company_name = %s, updated_at = now() WHERE company_id = %s RETURNING company_id',
                               (payload.name.strip(), company_id)).fetchone()
        if not updated:
            raise HTTPException(404, 'Company tidak ditemukan')
        if before['company_name'] != payload.name.strip():
            activity.record(conn, 'account', 'company.rename',
                            f"mengubah nama company dari {activity.quote(before['company_name'] or company_id)} ke {activity.quote(payload.name.strip())}",
                            {'sebelum': before['company_name'], 'sesudah': payload.name.strip()}, company_id=company_id)
        conn.commit()
        return _companies(conn, company_id)[0]
