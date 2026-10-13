"""Sign-in through AutoAudit. AutoAudit seals and opens the ticket; this side only asks it who the ticket is.

A company may enter while its Property module is on in AutoAudit. The ticket is kept with the
session and asked again on every request, so turning the module off ends access at once.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import activity
from tenant import provision_company, provision_workspace

TIMEOUT_SECONDS = 5
# Never matches a PBKDF2 hash, so an AutoAudit account cannot sign in with a password.
NO_PASSWORD = 'sso'


class Unavailable(Exception):
    """AutoAudit could not be asked; the request must fail closed, not sign the user out."""


def _base_url() -> str:
    return os.getenv('AUTOAUDIT_BASE_URL', '').strip().rstrip('/')


def enabled() -> bool:
    return os.getenv('XM_SSO_ENABLED', '0') == '1' and bool(_base_url())


def public_url() -> str:
    """Where the browser reaches AutoAudit; the backend may use an internal address instead."""
    return os.getenv('AUTOAUDIT_PUBLIC_URL', '').strip().rstrip('/') or _base_url()


def exchange(ticket: str):
    """Who this ticket belongs to right now: ``{actor, state, iat, exp}``, or None when AutoAudit refuses it."""
    request = urllib.request.Request(
        _base_url() + '/api/property/session', data=json.dumps({'ticket': ticket}).encode(),
        method='POST', headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise Unavailable(f'AutoAudit menjawab {response.status}')
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return None
        raise Unavailable(f'AutoAudit menjawab {exc.code}') from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise Unavailable(str(exc)) from exc


def identity_key(actor: dict) -> str:
    """Stable key of an AutoAudit account; names and emails may change, this does not."""
    role, kind = actor.get('role'), actor.get('actorType')
    if role == 'company' and isinstance(actor.get('companyId'), int) and actor['companyId'] > 0:
        return f"company:{actor['companyId']}"
    if role == 'superadmin' and kind == 'superadmin':
        return 'superadmin:root'
    if role == 'superadmin' and kind == 'child_superadmin' and isinstance(actor.get('actorId'), int) and actor['actorId'] > 0:
        return f"superadmin:{actor['actorId']}"
    raise ValueError('Identitas AutoAudit tidak dikenal')


def provision_identity(conn, actor: dict):
    """The account of this AutoAudit identity, created with its company on the first sign-in."""
    key = identity_key(actor)
    # Two first sign-ins of the same identity must not create two accounts.
    conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 13102026))', (key,))
    user = conn.execute('SELECT * FROM xm.users WHERE autoaudit_key=%s', (key,)).fetchone()
    if actor['role'] == 'company':
        company_id = actor['companyId']
        workspace = f'aa-{company_id}'
        name = (actor.get('name') or '').strip() or f'Company #{company_id}'
        is_new = not conn.execute('SELECT 1 FROM xm.app_preferences WHERE company_id=%s', (workspace,)).fetchone()
        if not user:
            user = conn.execute(
                """INSERT INTO xm.users(id, email, display_name, password_hash, role, workspace_id, autoaudit_key)
                   VALUES (%s, %s, %s, %s, 'company_admin', %s, %s) RETURNING *""",
                (uuid.uuid4(), f'company-{company_id}@sso.autoaudit.id', name, NO_PASSWORD, workspace, key)).fetchone()
        provision_company(conn, workspace, name)
        conn.execute('UPDATE xm.app_preferences SET autoaudit_company_id=%s, autoaudit_company_name=%s WHERE company_id=%s',
                     (company_id, name, workspace))
        if is_new:
            activity.record(conn, 'account', 'company.create', f'membuat company {activity.quote(name)} dari AutoAudit',
                            {'company': name, 'autoaudit_company_id': company_id}, actor=user, company_id=workspace)
    else:
        name = (actor.get('name') or '').strip() or 'Superadmin'
        if not user:
            user = conn.execute(
                """INSERT INTO xm.users(id, email, display_name, password_hash, role, autoaudit_key)
                   VALUES (%s, %s, %s, %s, 'admin', %s) RETURNING *""",
                (uuid.uuid4(), key.replace(':', '-') + '@sso.autoaudit.id', name, NO_PASSWORD, key)).fetchone()
        # Platform administrators share the administrator archive instead of each owning an empty company.
        user['workspace_id'] = provision_workspace(conn, user['id'], legacy=True)
    if user['display_name'] != name:
        conn.execute('UPDATE xm.users SET display_name=%s WHERE id=%s', (name, user['id']))
        user['display_name'] = name
    # The session is renewed every 15 minutes; only a sign-in after a real pause is a new log line.
    renewed = conn.execute(
        """UPDATE xm.activity_log SET last_at=now()
           WHERE id=(SELECT id FROM xm.activity_log WHERE action='auth.sso_login' AND actor_id=%s
                       AND last_at > now() - interval '30 minutes' ORDER BY id DESC LIMIT 1) RETURNING id""",
        (user['id'],)).fetchone()
    if not renewed:
        activity.record(conn, 'account', 'auth.sso_login', 'masuk lewat AutoAudit', actor=user, company_id=user['workspace_id'])
    return user
