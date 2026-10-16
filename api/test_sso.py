"""Sign-in through AutoAudit: the client, the per-request re-check, first-time creation and account limits."""
import io
import json
import os
import random
import time
import unittest
import urllib.error
import urllib.request
import uuid
from unittest.mock import patch

import sso
from harness import ServerTestCase

SSO_ENV = {'XM_SSO_ENABLED': '1', 'AUTOAUDIT_BASE_URL': 'http://autoaudit.test'}


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class SsoClientTests(unittest.TestCase):
    def test_identity_key_is_stable_per_account_kind(self):
        self.assertEqual(sso.identity_key({'role': 'company', 'companyId': 12, 'actorType': 'company', 'actorId': 12}), 'company:12')
        self.assertEqual(sso.identity_key({'role': 'superadmin', 'actorType': 'superadmin', 'actorId': None}), 'superadmin:root')
        self.assertEqual(sso.identity_key({'role': 'superadmin', 'actorType': 'child_superadmin', 'actorId': 7}), 'superadmin:7')
        for actor in ({'role': 'company'}, {'role': 'company', 'companyId': '12'}, {'role': 'superadmin', 'actorType': 'child_superadmin'},
                      {'role': 'superior', 'companyId': 12}, {}):
            with self.assertRaises(ValueError):
                sso.identity_key(actor)

    def test_enabled_needs_the_switch_and_the_address(self):
        with patch.dict(os.environ, SSO_ENV):
            self.assertTrue(sso.enabled())
            self.assertEqual(sso.public_url(), 'http://autoaudit.test')
        with patch.dict(os.environ, {**SSO_ENV, 'AUTOAUDIT_PUBLIC_URL': 'https://app.autoaudit.test/'}):
            self.assertEqual(sso.public_url(), 'https://app.autoaudit.test')
        with patch.dict(os.environ, {**SSO_ENV, 'XM_SSO_ENABLED': '0'}):
            self.assertFalse(sso.enabled())
        with patch.dict(os.environ, {**SSO_ENV, 'AUTOAUDIT_BASE_URL': ''}):
            self.assertFalse(sso.enabled())

    def test_exchange_returns_the_answer_refusal_or_outage(self):
        answer = {'actor': {'role': 'company', 'companyId': 12}, 'state': 'a' * 64, 'iat': 1, 'exp': 2}
        sent = []

        def ok(request, timeout):
            sent.append((request.full_url, json.loads(request.data), timeout))
            return FakeResponse(json.dumps(answer).encode())

        def http_error(code):
            def raiser(request, timeout):
                raise urllib.error.HTTPError(request.full_url, code, 'x', {}, io.BytesIO(b'{}'))
            return raiser

        def down(request, timeout):
            raise urllib.error.URLError('connection refused')

        with patch.dict(os.environ, SSO_ENV):
            with patch('urllib.request.urlopen', ok):
                self.assertEqual(sso.exchange('ticket-1'), answer)
            self.assertEqual(sent, [('http://autoaudit.test/api/property/session', {'ticket': 'ticket-1'}, sso.TIMEOUT_SECONDS)])
            with patch('urllib.request.urlopen', http_error(401)):
                self.assertIsNone(sso.exchange('ticket-1'))
            for broken in (http_error(500), down):
                with patch('urllib.request.urlopen', broken), self.assertRaises(sso.Unavailable):
                    sso.exchange('ticket-1')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class SsoServerCase(ServerTestCase):
    def setUp(self):
        super().setUp()
        env = patch.dict(os.environ, SSO_ENV)
        env.start()
        self.addCleanup(env.stop)
        self.company_id = random.randint(10_000_000, 99_999_999)
        self.child_id = random.randint(10_000_000, 99_999_999)
        self.companies.append(f'aa-{self.company_id}')
        self.addCleanup(self.remove_sso_accounts)
        self.answer = None      # what AutoAudit says about a ticket: dict, None (refused) or an exception
        exchange = patch.object(sso, 'exchange', self.fake_exchange)
        exchange.start()
        self.addCleanup(exchange.stop)

    def fake_exchange(self, ticket):
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer

    def remove_sso_accounts(self):
        from db import connect
        with connect() as conn:
            conn.execute("DELETE FROM xm.activity_log WHERE actor_email LIKE %s", ('%@sso.autoaudit.id',))
            conn.execute('DELETE FROM xm.users WHERE autoaudit_key IN (%s, %s)',
                         (f'company:{self.company_id}', f'superadmin:{self.child_id}'))
            conn.commit()

    def sql(self, statement, params=()):
        from db import connect
        with connect() as conn:
            cursor = conn.execute(statement, params)
            rows = cursor.fetchall() if cursor.description else []
            conn.commit()
        return rows

    def get(self, path, cookie=''):
        """One GET without following redirects. Returns (status, headers, body)."""
        opener = urllib.request.build_opener(NoRedirect)
        request = urllib.request.Request(self.base + path, headers={'Cookie': cookie} if cookie else {})
        try:
            response = opener.open(request, timeout=30)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, response.headers, response.read()

    def company_actor(self, name='PT Contoh'):
        return {'role': 'company', 'companyId': self.company_id, 'name': name, 'actorType': 'company', 'actorId': self.company_id}

    def ticket_answer(self, actor, state, age_ms=0):
        now = int(time.time() * 1000)
        return {'actor': actor, 'state': state, 'iat': now - age_ms, 'exp': now - age_ms + 900_000}

    def sign_in(self, actor):
        """Run start + callback. Returns the session cookie header."""
        status, headers, _ = self.get('/auth/sso/start')
        self.assertEqual(status, 302)
        state = headers['Set-Cookie'].split('xm_sso_state=')[1].split(';')[0]
        self.assertTrue(headers['Location'].endswith(f'/dashboard/property?state={state}'), headers['Location'])
        self.answer = self.ticket_answer(actor, state)
        status, headers, body = self.get('/auth/sso/callback?ticket=sealed-ticket', cookie=f'xm_sso_state={state}')
        self.assertEqual((status, headers['Location']), (302, '/'), body[:300])
        cookies = [value for key, value in headers.items() if key.lower() == 'set-cookie']
        return next(item.split(';')[0] for item in cookies if item.startswith('xm_session='))

    def users(self, key):
        return self.sql('SELECT * FROM xm.users WHERE autoaudit_key=%s', (key,))


class SsoCallbackTests(SsoServerCase):
    def test_first_sign_in_creates_the_company_and_its_admin_once(self):
        cookie = self.sign_in(self.company_actor())
        key, workspace = f'company:{self.company_id}', f'aa-{self.company_id}'
        user, = self.users(key)
        self.assertEqual((user['role'], user['workspace_id']), ('company_admin', workspace))
        prefs, = self.sql('SELECT * FROM xm.app_preferences WHERE company_id=%s', (workspace,))
        self.assertEqual((prefs['autoaudit_company_id'], prefs['company_name']), (self.company_id, 'PT Contoh'))

        status, _, body = self.get('/auth/me', cookie=cookie)
        me = json.loads(body)
        self.assertEqual((status, me['sso'], me['role']), (200, True, 'company_admin'))
        self.assertNotIn('sso_ticket', me)
        self.assertNotIn('autoaudit_key', me)

        self.sign_in(self.company_actor())
        self.assertEqual(len(self.users(key)), 1)
        logins = self.sql("SELECT repeat_count FROM xm.activity_log WHERE action='auth.sso_login' AND actor_id=%s", (user['id'],))
        self.assertEqual(len(logins), 1, 'renewing the session is not a new log line')

    def test_a_superadmin_user_becomes_a_platform_administrator(self):
        actor = {'role': 'superadmin', 'companyId': None, 'actorType': 'child_superadmin', 'actorId': self.child_id, 'name': 'Ops'}
        cookie = self.sign_in(actor)
        user, = self.users(f'superadmin:{self.child_id}')
        self.assertEqual((user['role'], user['display_name']), ('admin', 'Ops'))
        self.assertEqual(self.get('/admin/companies', cookie=cookie)[0], 200)

    def test_callback_refuses_a_missing_or_wrong_state_an_old_ticket_and_a_refused_ticket(self):
        state = 'a' * 64
        fresh = self.ticket_answer(self.company_actor(), state)
        cases = [
            ('', fresh),                                                            # no state cookie
            ('xm_sso_state=' + 'b' * 64, fresh),                                    # another browser's state
            (f'xm_sso_state={state}', self.ticket_answer(self.company_actor(), state, age_ms=61_000)),
            (f'xm_sso_state={state}', None),                                        # AutoAudit refuses the ticket
            (f'xm_sso_state={state}', {**fresh, 'actor': {'role': 'superior', 'companyId': self.company_id}}),
        ]
        for cookie, answer in cases:
            self.answer = answer
            status, _, _ = self.get('/auth/sso/callback?ticket=sealed-ticket', cookie=cookie)
            self.assertEqual(status, 401, (cookie, answer))
        self.assertEqual(self.users(f'company:{self.company_id}'), [])

        self.answer = sso.Unavailable('down')
        self.assertEqual(self.get('/auth/sso/callback?ticket=sealed-ticket', cookie=f'xm_sso_state={state}')[0], 503)

    def test_sso_routes_are_off_without_the_switch(self):
        with patch.dict(os.environ, {'XM_SSO_ENABLED': '0'}):
            self.assertEqual(json.loads(self.get('/auth/sso/config')[2]), {'enabled': False})
            self.assertEqual(self.get('/auth/sso/start')[0], 503)
        self.assertEqual(json.loads(self.get('/auth/sso/config')[2]), {'enabled': True})


class SsoSessionTests(SsoServerCase):
    def session_rows(self, user_id):
        return self.sql('SELECT id FROM xm.sessions WHERE user_id=%s', (user_id,))

    def test_every_request_asks_autoaudit_again(self):
        cookie = self.sign_in(self.company_actor())
        user, = self.users(f'company:{self.company_id}')

        self.answer = sso.Unavailable('down')
        self.assertEqual(self.get('/auth/me', cookie=cookie)[0], 503)
        self.assertEqual(len(self.session_rows(user['id'])), 1, 'an outage keeps the session')

        self.answer = self.ticket_answer({**self.company_actor(), 'companyId': self.company_id + 1}, 'x')
        self.assertEqual(self.get('/auth/me', cookie=cookie)[0], 401)
        self.assertEqual(self.session_rows(user['id']), [], 'a ticket of another identity ends the session')

    def test_a_refused_ticket_ends_the_session(self):
        cookie = self.sign_in(self.company_actor())
        user, = self.users(f'company:{self.company_id}')
        self.answer = None      # the module was switched off in AutoAudit
        self.assertEqual(self.get('/auth/me', cookie=cookie)[0], 401)
        self.assertEqual(self.session_rows(user['id']), [])

    def test_password_sessions_never_ask_autoaudit(self):
        self.answer = AssertionError('a password session must not be re-checked')
        self.call(self.admin, '/auth/me')

    def test_an_autoaudit_account_cannot_use_a_password(self):
        from auth import _password_hash
        self.sign_in(self.company_actor())
        user, = self.users(f'company:{self.company_id}')
        self.sql('UPDATE xm.users SET password_hash=%s WHERE id=%s', (_password_hash('reset-by-admin-1'), user['id']))
        anonymous = urllib.request.build_opener()
        self.call(anonymous, '/auth/login', 'POST', {'email': user['email'], 'password': 'reset-by-admin-1'}, status=401)


class SsoAccountLimitTests(SsoServerCase):
    def test_autoaudit_companies_are_labelled_and_cannot_add_members(self):
        self.sign_in(self.company_actor())
        user, = self.users(f'company:{self.company_id}')
        _, _, native_client = self.make_company('Native')

        member = {'email': f'isol-{uuid.uuid4().hex}@example.com', 'display_name': 'Anggota', 'password': 'member-pass-123'}
        refused = self.call(self.admin, '/team/users', 'POST', member, owner=user, status=403)
        self.assertEqual(refused['detail'], 'Akun company ini dikelola dari AutoAudit.')
        self.call(native_client, '/team/users', 'POST', member, status=201)

        companies = {row['company_id']: row for row in self.call(self.admin, '/admin/companies')}
        mine = companies[f'aa-{self.company_id}']
        self.assertEqual((mine['source'], mine['users'][0]['sso']), ('autoaudit', True))
        self.assertEqual(companies[self.companies[-1]]['source'], 'xm')


if __name__ == '__main__':
    unittest.main()
