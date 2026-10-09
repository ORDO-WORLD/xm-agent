"""Accounts inside one company. A company admin manages members; the platform admin may also set roles."""
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from psycopg.errors import UniqueViolation

import activity
from auth import _password_hash, current_user, public_user
from db import connect
from tenant import workspace_id

router = APIRouter(prefix='/team')


class NewMember(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=200)
    role: Literal['user', 'company_admin'] = 'user'


class EditMember(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    is_locked: bool = False
    role: Literal['user', 'company_admin'] | None = None


def can_edit(requester_role: str, target_role: str) -> bool:
    """A company admin manages members; the platform admin also manages company admins. Nobody edits a platform admin."""
    if target_role == 'admin':
        return False
    return requester_role == 'admin' or (requester_role == 'company_admin' and target_role == 'user')


@router.get('/users')
def list_members(request: Request):
    me = current_user(request)
    activity.record_view('page.open', 'membuka Tim & Akses')
    with connect() as conn:
        rows = conn.execute(
            """SELECT id, email, display_name, role, is_locked, created_at FROM xm.users
               WHERE workspace_id = current_setting('xm.workspace_id')
               ORDER BY (role = 'user'), created_at""").fetchall()
    for row in rows:
        row['editable'] = can_edit(me['role'], row['role'])
        row['is_self'] = row['id'] == me['id']
    return rows


@router.post('/users', status_code=201)
def add_member(payload: NewMember, request: Request):
    me = current_user(request)
    if payload.role != 'user' and me['role'] != 'admin':
        raise HTTPException(403, 'Hanya administrator platform yang dapat menambah super admin company.')
    if not payload.display_name.strip():
        raise HTTPException(400, 'Nama wajib diisi')
    try:
        with connect() as conn:
            user = conn.execute(
                """INSERT INTO xm.users(id, email, display_name, password_hash, role, workspace_id)
                   VALUES (%s, %s, %s, %s, %s, current_setting('xm.workspace_id')) RETURNING *""",
                (uuid.uuid4(), payload.email.strip().lower(), payload.display_name.strip(),
                 _password_hash(payload.password), payload.role)).fetchone()
            activity.record(conn, 'account', 'team.add', f"menambah akun {user['email']} sebagai {activity.ROLE_LABEL[user['role']]}",
                            {'email': user['email'], 'nama': user['display_name'], 'peran': user['role']})
            conn.commit()
            return {**public_user(user), 'editable': True, 'is_self': False}
    except UniqueViolation:
        raise HTTPException(409, 'Email sudah terdaftar')


@router.put('/users/{user_id}')
def edit_member(user_id: uuid.UUID, payload: EditMember, request: Request):
    me = current_user(request)
    if not payload.display_name.strip():
        raise HTTPException(400, 'Nama wajib diisi')
    try:
        with connect() as conn:
            target = conn.execute(
                "SELECT * FROM xm.users WHERE id = %s AND workspace_id = current_setting('xm.workspace_id') FOR UPDATE",
                (user_id,)).fetchone()
            if not target:
                raise HTTPException(404, 'Akun tidak ditemukan')
            if not can_edit(me['role'], target['role']):
                raise HTTPException(403, 'Anda tidak dapat mengubah akun ini')
            role = payload.role or target['role']
            if role != target['role'] and me['role'] != 'admin':
                raise HTTPException(403, 'Hanya administrator platform yang dapat mengubah peran akun.')
            email = payload.email.strip().lower()
            updated = conn.execute(
                """UPDATE xm.users SET email = %s, display_name = %s, is_locked = %s, password_hash = %s, role = %s
                   WHERE id = %s RETURNING *""",
                (email, payload.display_name.strip(), payload.is_locked,
                 _password_hash(payload.password) if payload.password else target['password_hash'], role, user_id)).fetchone()
            if payload.password or email != target['email']:
                conn.execute('DELETE FROM xm.sessions WHERE user_id = %s', (user_id,))
            parts = []
            if email != target['email']:
                parts.append(f'mengubah email menjadi {email}')
            if updated['display_name'] != target['display_name']:
                parts.append(f"mengubah nama menjadi {activity.quote(updated['display_name'])}")
            if updated['is_locked'] != target['is_locked']:
                parts.append('mengunci akun' if updated['is_locked'] else 'membuka kunci akun')
            if role != target['role']:
                parts.append(f'mengubah peran menjadi {activity.ROLE_LABEL[role]}')
            if payload.password:
                parts.append('mereset password')
            if parts:
                activity.record(conn, 'account', 'team.edit', f"akun {target['email']}: " + ', '.join(parts), {
                    'akun': target['email'],
                    'sebelum': {'email': target['email'], 'nama': target['display_name'], 'terkunci': target['is_locked'], 'peran': target['role']},
                    'sesudah': {'email': email, 'nama': updated['display_name'], 'terkunci': updated['is_locked'], 'peran': role},
                    'password_direset': bool(payload.password)})
            conn.commit()
            return {**public_user(updated), 'editable': True, 'is_self': updated['id'] == me['id']}
    except UniqueViolation:
        raise HTTPException(409, 'Email sudah terdaftar')
