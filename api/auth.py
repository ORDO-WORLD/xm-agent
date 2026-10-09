import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

import activity
from db import connect
from tenant import provision_workspace


router = APIRouter(prefix="/auth")
COOKIE_NAME = "xm_session"
SESSION_DAYS = 7


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${digest.hex()}"


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def seed_admin() -> None:
    email = os.getenv("XM_ADMIN_EMAIL", "admin@autoaudit.id").strip().lower()
    password = os.getenv("XM_ADMIN_PASSWORD", "secret123")
    with connect() as conn:
        migrated = conn.execute(
            """
            INSERT INTO xm.users(id, email, display_name, password_hash, role)
            VALUES (%s, %s, 'Administrator', %s, 'admin')
            ON CONFLICT (email) DO UPDATE SET role='admin', password_hash=excluded.password_hash,
                is_locked=false WHERE xm.users.role != 'admin'
            RETURNING id
            """,
            (uuid.uuid4(), email, _password_hash(password)),
        ).fetchone()
        if migrated:
            conn.execute('DELETE FROM xm.sessions WHERE user_id=%s', (migrated['id'],))
        # Backfill ownership after promotion so the existing archive stays with admin.
        for user in conn.execute('SELECT id,email,role FROM xm.users').fetchall():
            provision_workspace(conn, user['id'], legacy=user['email'] == email and user['role'] == 'admin')
        conn.commit()


def current_user(request: Request):
    # The access middleware already resolved the account for this request.
    cached = getattr(request.state, 'xm_user', None)
    if cached is not None:
        return cached
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as conn:
        return conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.role, u.is_locked, u.workspace_id, ap.company_name
            FROM xm.sessions s JOIN xm.users u ON u.id=s.user_id
            LEFT JOIN xm.app_preferences ap ON ap.company_id=u.workspace_id
            WHERE s.token_hash=%s AND s.expires_at > now()
            """,
            (token_hash,),
        ).fetchone()


@router.post("/login")
def login(payload: LoginRequest, response: Response):
    email = payload.email.strip().lower()
    with connect() as conn:
        user = conn.execute(
            """SELECT u.*, ap.company_name FROM xm.users u
               LEFT JOIN xm.app_preferences ap ON ap.company_id=u.workspace_id WHERE u.email=%s""", (email,)).fetchone()
        if not user or not _password_matches(payload.password, user["password_hash"]):
            # Only the address that was tried is kept; the password never reaches the log.
            who = {'id': user['id'] if user else None, 'display_name': user['display_name'] if user else email,
                   'email': email, 'role': user['role'] if user else None}
            activity.record(conn, 'account', 'auth.login_failed',
                            f'gagal masuk dengan email {email} ({"password salah" if user else "akun tidak ada"})',
                            {'email': email}, failed=True, actor=who, company_id=user['workspace_id'] if user else None, merge=True)
            conn.commit()
            raise HTTPException(401, "Email atau password tidak sesuai")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
        conn.execute("DELETE FROM xm.sessions WHERE expires_at <= now()")
        conn.execute(
            "INSERT INTO xm.sessions(id,user_id,token_hash,expires_at) VALUES(%s,%s,%s,%s)",
            (uuid.uuid4(), user["id"], hashlib.sha256(token.encode()).hexdigest(), expires_at),
        )
        activity.record(conn, 'account', 'auth.login', 'masuk', actor=user, company_id=user['workspace_id'])
        conn.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="strict",
        secure=os.getenv("XM_COOKIE_SECURE", "0") == "1",
        path="/",
    )
    return public_user(user)


@router.get("/me")
def me(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Sesi login diperlukan")
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with connect() as conn:
            conn.execute(
                "DELETE FROM xm.sessions WHERE token_hash=%s",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )
            user = current_user(request)
            if user:
                activity.record(conn, 'account', 'auth.logout', 'keluar', actor=user, company_id=user['workspace_id'])
            conn.commit()
    response.delete_cookie(COOKIE_NAME, path="/")



def public_user(user):
    return {key: user.get(key) for key in ('id', 'email', 'display_name', 'role', 'is_locked', 'company_name')}


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


@router.put('/password', status_code=204)
def change_password(payload: PasswordChange, request: Request):
    user = current_user(request)
    with connect() as conn:
        row = conn.execute('SELECT password_hash FROM xm.users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not row or not _password_matches(payload.current_password, row['password_hash']):
            raise HTTPException(400, 'Password saat ini tidak sesuai')
        conn.execute('UPDATE xm.users SET password_hash=%s WHERE id=%s', (_password_hash(payload.new_password), user['id']))
        token = request.cookies.get(COOKIE_NAME) or ''
        # Other devices must sign in again with the new password; this session continues.
        conn.execute('DELETE FROM xm.sessions WHERE user_id=%s AND token_hash<>%s',
                     (user['id'], hashlib.sha256(token.encode()).hexdigest()))
        activity.record(conn, 'account', 'auth.password', 'mengganti password sendiri', actor=user, company_id=user['workspace_id'])
        conn.commit()
