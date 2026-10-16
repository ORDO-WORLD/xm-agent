"""Pure/mock regressions. No server, DB schema, or external request is needed."""
import asyncio
import hashlib
import json
import os
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch
from starlette.requests import Request
from fastapi import HTTPException, Response
import sso
import property_control
import property_activity
import activity
from auth import safe_return, login, LoginRequest
from auth import current_user, _still_valid, sso_callback, sso_start, signed_out


class PropertyControlTests(unittest.TestCase):
    def test_callback_renews_same_actor_but_resets_different_actor(self):
        actor = {'role': 'company', 'actorType': 'superior', 'actorId': 3, 'companyId': 7, 'name': 'Company'}
        answer = {'actor': actor, 'iat': int(time.time()*1000), 'exp': int(time.time()*1000)+900000, 'state': 'a'*64}
        cookie = 'xm_session=old-token; xm_sso_state=' + 'a'*64 + '; xm_sso_return=/#/cocokkan?arah=buyer'
        for previous_key, destination, sql in [('superior:3', '/#/cocokkan?arah=buyer', 'UPDATE xm.sessions SET'), ('superior:99', '/', 'INSERT INTO xm.sessions')]:
            request = Request({'type': 'http', 'path': '/auth/sso/callback', 'method': 'GET', 'headers': [(b'cookie', cookie.encode())], 'query_string': b''})
            conn = MagicMock(); conn.__enter__.return_value = conn
            conn.execute.return_value.fetchone.return_value = {'id': 'old-session', 'autoaudit_key': previous_key, 'workspace_id': 'legacy'}
            with patch('auth.sso.enabled', return_value=True), patch('auth.sso.exchange', return_value=answer), patch('auth.sso.provision_identity', return_value={'id': 'member-uuid', 'workspace_id': 'legacy'}), patch('auth.connect', return_value=conn):
                response = sso_callback(request, 'ticket')
            self.assertEqual(response.headers['location'], destination)
            self.assertTrue(any(sql in call.args[0] for call in conn.execute.call_args_list))
            if previous_key != 'superior:3':
                self.assertTrue(any('DELETE FROM xm.sessions WHERE id=' in call.args[0] for call in conn.execute.call_args_list))

    def test_canonical_start_uses_forwarded_browser_origin_without_redirect_loop(self):
        request = Request({'type': 'http', 'path': '/auth/sso/start', 'method': 'GET', 'scheme': 'http', 'server': ('api', 8100), 'headers': [(b'host', b'api:8100'), (b'x-forwarded-host', b'xm.test'), (b'x-forwarded-proto', b'https')], 'query_string': b'next=%2F%23%2Fstok'})
        with patch.dict(os.environ, {'XM_SSO_ENABLED': '1', 'AUTOAUDIT_BASE_URL': 'https://aa.test', 'AUTOAUDIT_PUBLIC_URL': 'https://aa.test', 'XM_PUBLIC_BASE_URL': 'https://xm.test'}):
            response = sso_start(request)
            self.assertTrue(response.headers['location'].startswith('https://aa.test/dashboard/property?state='))
            self.assertIn('xm_sso_return=', '\n'.join(response.headers.getlist('set-cookie')))
            out = signed_out(request)
            self.assertIn(b'https://aa.test/logout?from=property', out.body)

    def test_provision_reuses_linked_workspace_and_preserves_member_lock(self):
        actor = {'role': 'company', 'actorType': 'superior', 'actorId': 3, 'companyId': 7, 'name': 'Company', 'actorName': 'Member'}
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = {'id': 'member-uuid', 'workspace_id': 'legacy-workspace', 'role': 'company_admin', 'display_name': 'Member', 'is_locked': True}
        with patch('sso.company_workspace', return_value='legacy-workspace') as workspace:
            user = sso.provision_identity(conn, actor, log_login=False)
        self.assertEqual(user['role'], 'user')
        self.assertEqual(user['workspace_id'], 'legacy-workspace')
        self.assertTrue(user['is_locked'])
        workspace.assert_called_once_with(conn, 7, 'Company')
        lookup = next(call for call in conn.execute.call_args_list if 'SELECT * FROM xm.users' in call.args[0])
        self.assertEqual(lookup.args[1], ('superior:3',))

    def test_session_validation_does_not_hold_db_connection_and_rejects_wrong_company(self):
        actor = {'role': 'company', 'actorType': 'superior', 'actorId': 3, 'companyId': 7, 'name': 'Company'}
        conn = MagicMock(); active = []
        conn.__enter__.side_effect = lambda: active.append(True) or conn
        conn.__exit__.side_effect = lambda *_: active.pop() and False
        conn.execute.return_value.fetchone.return_value = {'id': 'member-uuid', 'role': 'user', 'workspace_id': 'legacy', 'is_locked': False, 'autoaudit_key': 'superior:3', 'autoaudit_company_id': 7, 'session_id': 'session', 'sso_ticket': 'ticket'}
        def exchange(_):
            self.assertEqual(active, [])
            return {'actor': actor, 'auditEligible': True}
        request = Request({'type': 'http', 'path': '/auth/me', 'method': 'GET', 'query_string': b'', 'headers': [(b'cookie', b'xm_session=browser')]})
        with patch('auth.connect', return_value=conn), patch('sso.exchange', side_effect=exchange):
            self.assertEqual(current_user(request)['id'], 'member-uuid')
            self.assertEqual(request.state.property_actor, actor)
            self.assertTrue(request.state.property_audit_eligible)
            self.assertFalse(_still_valid('ticket', 'superior:3', 'user', 8))

    def test_identity_and_login_have_no_local_password_fallback(self):
        actor = {'role': 'company', 'actorType': 'superior', 'actorId': 3, 'companyId': 7}
        self.assertEqual(sso.identity_key(actor), 'superior:3')
        self.assertEqual(sso.actor_role(actor), 'user')
        company = {**actor, 'actorType': 'company', 'actorId': 7}
        self.assertEqual(sso.identity_key(company), 'company:7')
        self.assertEqual(sso.actor_role(company), 'company_admin')
        with patch('auth.connect') as db:
            with self.assertRaises(HTTPException) as denied:
                login(LoginRequest(email='legacy@example.com', password='password'), Response())
            self.assertEqual(denied.exception.status_code, 403)
            db.assert_not_called()

    def test_return_origin_and_path_are_allowlisted(self):
        with patch.dict(os.environ, {'AUTOAUDIT_BASE_URL': 'http://internal', 'AUTOAUDIT_PUBLIC_URL': 'https://aa.test', 'AUTOAUDIT_SSO_ORIGINS': 'https://aa2.test'}):
            self.assertEqual(sso.public_url('evil.test'), 'https://aa.test')
            self.assertEqual(sso.public_url('aa2.test'), 'https://aa2.test')
        self.assertEqual(safe_return('/#/cocokkan?arah=buyer'), '/#/cocokkan?arah=buyer')
        self.assertEqual(safe_return('//evil.test'), '/')

    def test_control_is_bound_to_body_path_method_and_query_before_db(self):
        async def exercise(change):
            raw = b'{"terms":["darmo"]}'
            async def receive():
                return {'type': 'http.request', 'body': raw, 'more_body': False}
            request = Request({'type': 'http', 'path': '/search-default', 'method': 'PUT', 'query_string': b'', 'headers': [(b'x-autoaudit-property-control', b'ticket')]}, receive)
            answer = {'method': 'PUT', 'path': '/search-default', 'query': '', 'bodyHash': hashlib.sha256(raw).hexdigest(), 'exp': time.time()*1000+60000, **change}
            with patch('sso.exchange', return_value=answer), patch('property_control.connect') as db:
                with self.assertRaises(HTTPException) as denied:
                    await property_control.resolve(request)
                self.assertEqual(denied.exception.status_code, 401)
                db.assert_not_called()
        for change in ({'method': 'POST'}, {'path': '/settings'}, {'query': 'offset=1'}, {'bodyHash': '0'*64}, {'exp': 0}):
            asyncio.run(exercise(change))

    def test_native_settings_require_sso_origin_and_existing_role_but_accounts_stay_in_aa(self):
        # Module imports construct file paths only; direct call below has all DB/network access mocked.
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'UPLOAD_DIR': directory, 'XM_EXPORT_DIR': directory, 'XM_INTEGRATION_EXPORT_DIR': directory}):
            from app import require_login
            async def check(path, method, role='company_admin', origin='http://localhost:9004'):
                headers = [(b'host', b'127.0.0.1:8100'), (b'x-forwarded-host', b'localhost:9004'), (b'x-forwarded-proto', b'http')]
                if origin: headers.append((b'origin', origin.encode()))
                req = Request({'type': 'http', 'path': path, 'method': method, 'scheme': 'http', 'query_string': b'', 'headers': headers})
                async def next_handler(_): return Response(status_code=204)
                user = {'id': 'user', 'role': role, 'workspace_id': 'aa-7', 'is_locked': False}
                def current_user(request):
                    request.state.property_actor = {'role': 'company', 'actorType': 'company', 'actorId': 7, 'companyId': 7}
                    request.state.property_audit_eligible = True
                    return user
                with patch('app.current_user', side_effect=current_user), patch('app.connect') as db:
                    response = await require_login(req, next_handler)
                    db.assert_not_called()
                    return response.status_code
            for path in ['/settings', '/stock/tracked', '/search-default', '/integration/keys']:
                self.assertEqual(asyncio.run(check(path, 'PUT')), 204)
                self.assertEqual(asyncio.run(check(path, 'PUT', origin=None)), 403)
                self.assertEqual(asyncio.run(check(path, 'PUT', origin='https://other.test')), 403)
                self.assertEqual(asyncio.run(check(path, 'PUT', role='user')), 403)
            for path in ['/team/users', '/auth/password', '/admin/companies/aa-7', '/property-control/company/lock']:
                self.assertEqual(asyncio.run(check(path, 'PUT')), 403)
            self.assertEqual(asyncio.run(check('/integration/keys', 'GET')), 204)
            self.assertEqual(asyncio.run(check('/integration/keys', 'GET', role='user')), 403)
            self.assertEqual(asyncio.run(check('/preferences', 'PUT', role='user')), 204)
            self.assertEqual(asyncio.run(check('/entities/status', 'POST')), 204)

    def test_native_setting_audit_uses_validated_actor_and_skips_login_as(self):
        request = Request({'type': 'http', 'method': 'PUT', 'path': '/preferences', 'scheme': 'http', 'headers': [(b'host', b'xm.test'), (b'origin', b'http://xm.test')]})
        request.state.property_actor = {'role': 'company', 'actorType': 'superior', 'actorId': 3, 'companyId': 7}
        request.state.property_audit_eligible = True
        for as_admin in (False, True):
            context = property_control.browser_context(request, as_admin)
            conn = MagicMock()
            conn.execute.return_value.fetchone.return_value = {'company_name': 'Company', 'id': 9}
            with activity.control_scope(context):
                activity.record(conn, 'change', 'preferences.save', 'edit', {'direction': 'private'})
            args = conn.execute.call_args.args[1]
            self.assertEqual(args[-1], None if as_admin else 'pending')
            if not as_admin:
                self.assertEqual(json.loads(args[-3])['_autoaudit']['superior_id'], 3)
                self.assertNotIn('private', json.dumps(json.loads(args[-3])['_autoaudit']))

    def test_activity_and_business_mutation_share_transaction_and_redact_relay(self):
        ctx = {'auditEligible': True, 'actor': {'role': 'company', 'actorType': 'superior', 'actorId': 3}, 'companyId': 7, 'eventId': '11111111-1111-4111-8111-111111111111'}
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = {'company_name': 'Company', 'id': 9}
        with activity.control_scope(ctx):
            activity.record(conn, 'change', 'search.personal', 'edit', {'secret': 'do-not-relay', 'terms': ['private']})
        sql, args = conn.execute.call_args.args
        self.assertIn('autoaudit_event_id', sql)
        details = json.loads(args[-3])
        self.assertNotIn('do-not-relay', json.dumps(details['_autoaudit']))
        self.assertEqual(details['_autoaudit']['superior_id'], 3)
        self.assertEqual(args[-1], 'pending')
        conn.commit.assert_not_called()

    def test_failed_delivery_never_marks_event_sent(self):
        row = {'id': 1, 'autoaudit_event_id': '11111111-1111-4111-8111-111111111111', 'details': {'_autoaudit': {'company_id': 7, 'superior_id': None, 'operation': 'search.company', 'changed_fields': []}}}
        conn = MagicMock(); conn.__enter__.return_value = conn
        conn.execute.return_value.fetchall.return_value = [row]
        with patch.dict(os.environ, {'PROPERTY_SSO_SECRET': 's'*48, 'AUTOAUDIT_BASE_URL': 'https://aa.test'}), patch('property_activity.connect', return_value=conn), patch('urllib.request.urlopen', side_effect=TimeoutError):
            self.assertEqual(property_activity.relay_batch(), 0)
        self.assertEqual(conn.execute.call_count, 1)
        conn.commit.assert_not_called()
