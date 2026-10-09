"""AutoAudit connection routes and webhook receiver over real HTTP + an isolated PostgreSQL database."""
import json
import os
import urllib.error
import urllib.request
from unittest.mock import patch

import autoaudit_routes
from autoaudit_client import AutoAuditError
from test_autoaudit_sync import SEED
from test_v4_features import V4Case

KEY, TOKEN = 'k-secret-key', 'tok-0123456789'
COMPLETED = {'group': 'sync', 'event': 'completed', 'data': {'sales_id': 57}}
CAESAR = {'id': 57, 'name': 'Caesar', 'company': 'XM Darmo', 'company_id': 1}
MARIA = {'id': 58, 'name': 'Maria', 'company': 'XM Darmo', 'company_id': 1}
KONIG = {'id': 61, 'name': 'Konig Sales', 'company': 'Konig', 'company_id': 2}


class FakeSales:
    def __init__(self, error=None):
        self.error = error

    def list_sales(self):
        if self.error:
            raise self.error
        return [dict(CAESAR), dict(MARIA), dict(KONIG)]


class RouteCase(V4Case):
    def setUp(self):
        super().setUp()
        self.fake = FakeSales()
        for item in (patch.dict(os.environ, {'AUTOAUDIT_BASE_URL': 'https://app.example.test', 'AUTOAUDIT_API_KEY': KEY,
                                             'AUTOAUDIT_WEBHOOK_TOKEN': TOKEN}),
                     patch.object(autoaudit_routes, 'from_env', lambda: self.fake)):
            item.start()
            self.addCleanup(item.stop)
        self.sql('DELETE FROM xm.autoaudit_sources')
        self.cid = self.company['company_id']
        self.link()

    def sql(self, statement, params=()):
        from db import connect
        with connect() as conn:
            cursor = conn.execute(statement, params)
            rows = cursor.fetchall() if cursor.description else []
            conn.commit()
        return rows

    def link(self, company=None, autoaudit_company_id=1, status=200, client=None):
        return self.call(client or self.admin, f'/admin/autoaudit/link/{company or self.cid}', 'PUT',
                         {'autoaudit_company_id': autoaudit_company_id}, status=status)

    def connect_source(self, client=None, sales_id=57, agent='XM Darmo Caesar', status=201):
        return self.call(client or self.boss, '/autoaudit/sources', 'POST', {'sales_id': sales_id, 'agent_name': agent}, status=status)

    def hook(self, payload=COMPLETED, token=TOKEN, status=200, raw=None):
        body = raw if raw is not None else json.dumps(payload).encode()
        request = urllib.request.Request(f'{self.base}/hooks/autoaudit/{token}', data=body, method='POST',
                                         headers={'Content-Type': 'application/json'})
        try:
            response = urllib.request.urlopen(request, timeout=30)      # no cookie jar: anonymous caller
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            data = response.read()
            self.assertEqual(response.status, status, data[:300])
            return json.loads(data) if data else None

    def requested(self, sales_id=57):
        return self.sql('SELECT count(*) n FROM xm.autoaudit_sources WHERE sales_id=%s AND check_requested_at IS NOT NULL', (sales_id,))[0]['n']

    def clear_requests(self):
        self.sql('UPDATE xm.autoaudit_sources SET check_requested_at=NULL, force_requested=false')


class CompanyLinkTests(RouteCase):
    def test_platform_admin_lists_autoaudit_companies(self):
        self.assertEqual(self.call(self.admin, '/admin/autoaudit/companies'), [{'id': 2, 'name': 'Konig'}, {'id': 1, 'name': 'XM Darmo'}])
        self.call(self.boss, '/admin/autoaudit/companies', status=403)

    def test_link_is_stored_shown_and_can_be_cleared(self):
        row = self.link(autoaudit_company_id=2)
        self.assertEqual((row['autoaudit_company_id'], row['autoaudit_company_name']), (2, 'Konig'))
        listed = next(item for item in self.call(self.admin, '/admin/companies') if item['company_id'] == self.cid)
        self.assertEqual((listed['autoaudit_company_id'], listed['autoaudit_company_name']), (2, 'Konig'))
        cleared = self.link(autoaudit_company_id=None)
        self.assertEqual((cleared['autoaudit_company_id'], cleared['autoaudit_company_name']), (None, None))

    def test_link_validates_and_is_platform_only(self):
        self.link(autoaudit_company_id=999, status=404)                  # not a company the API key can see
        self.link(company='xm-co-missing', status=404)
        self.link(client=self.boss, status=403)
        self.fake = FakeSales(AutoAuditError('AutoAudit menjawab 503', status=503))
        self.link(status=502)
        self.link(autoaudit_company_id=None)                            # clearing needs no AutoAudit call

    def test_new_company_starts_unlinked(self):
        _, _, other_boss = self.make_company('Fresh')
        body = self.call(other_boss, '/autoaudit/sources')
        self.assertEqual((body['linked'], body['autoaudit_company_name'], body['sources']), (False, None, []))
        options = self.call(other_boss, '/autoaudit/options')
        self.assertEqual((options['linked'], options['sales']), (False, []))
        self.call(other_boss, '/autoaudit/sources', 'POST', {'sales_id': 57, 'agent_name': 'X'}, status=409)


class ConnectionTests(RouteCase):
    def test_options_only_offer_sales_of_the_linked_company(self):
        self.run_import(SEED, agent='Older Name')
        self.run_import(SEED[:1], agent='XM Darmo Caesar')
        body = self.call(self.boss, '/autoaudit/options')
        self.assertTrue(body['linked'])
        self.assertEqual(body['agent_names'], ['XM Darmo Caesar', 'Older Name'])
        self.assertEqual(body['sales'], [{'id': 57, 'name': 'Caesar', 'company': 'XM Darmo'}, {'id': 58, 'name': 'Maria', 'company': 'XM Darmo'}])
        self.link(autoaudit_company_id=2)
        self.assertEqual([item['id'] for item in self.call(self.boss, '/autoaudit/options')['sales']], [61])
        self.call(self.staff, '/autoaudit/options', status=403)          # members never see the sales list

    def test_options_report_unreachable_autoaudit(self):
        self.fake = FakeSales(AutoAuditError('AutoAudit menjawab 503', status=503))
        self.call(self.boss, '/autoaudit/options', status=502)

    def test_company_admin_connects_a_sales_of_their_company(self):
        row = self.connect_source()
        self.assertEqual((row['sales_id'], row['sales_name'], row['agent_name'], row['status']), (57, 'Caesar', 'XM Darmo Caesar', 'waiting'))
        stored = self.sql('SELECT * FROM xm.autoaudit_sources WHERE id=%s', (row['id'],))[0]
        self.assertEqual(stored['company_id'], self.cid)
        self.assertIsNotNone(stored['check_requested_at'])
        listed = self.call(self.staff, '/autoaudit/sources')
        self.assertEqual((listed['configured'], listed['linked'], listed['autoaudit_company_name']), (True, True, 'XM Darmo'))
        self.assertEqual([item['id'] for item in listed['sources']], [row['id']])
        self.call(self.admin, '/autoaudit/sources', 'POST', {'sales_id': 58, 'agent_name': 'Maria'}, owner=self.user, status=201)   # the platform admin may too

    def test_connect_validates_input(self):
        self.connect_source()
        self.connect_source(status=409)                                  # same sales twice in one company
        self.connect_source(sales_id=999, status=404)                    # not offered by the API
        self.connect_source(sales_id=61, status=404)                     # exists, but belongs to another AutoAudit company
        self.connect_source(sales_id=58, agent='   ', status=400)
        self.connect_source(sales_id=58, agent='x' * 101, status=400)
        self.connect_source(client=self.staff, sales_id=58, status=403)  # members cannot connect

    def test_sources_are_isolated_per_company(self):
        other, other_user, other_boss = self.make_company('Other')
        self.link(company=other['company_id'])
        mine = self.connect_source()
        self.assertEqual(self.call(other_boss, '/autoaudit/sources')['sources'], [])
        self.call(other_boss, f"/autoaudit/sources/{mine['id']}", 'DELETE', status=404)
        self.call(other_boss, f"/autoaudit/sources/{mine['id']}/sync", 'POST', status=404)
        theirs = self.connect_source(client=other_boss)                  # the same sales may feed another company
        self.assertNotEqual(theirs['id'], mine['id'])

    def test_disconnect_keeps_imports(self):
        self.run_import(SEED, agent='XM Darmo Caesar')
        row = self.connect_source()
        self.call(self.staff, f"/autoaudit/sources/{row['id']}", 'DELETE', status=403)
        self.call(self.boss, f"/autoaudit/sources/{row['id']}", 'DELETE', status=204)
        self.assertEqual(self.call(self.boss, '/autoaudit/sources')['sources'], [])
        self.assertEqual(len(self.call(self.boss, '/imports')), 1)
        self.assertEqual(len(self.rows(direction='property')), 2)

    def test_not_configured_reports_false_and_blocks_connect(self):
        row = self.connect_source()
        with patch.dict(os.environ, {'AUTOAUDIT_API_KEY': ''}):
            self.assertFalse(self.call(self.boss, '/autoaudit/sources')['configured'])
            self.connect_source(sales_id=58, status=503)
            self.call(self.boss, '/autoaudit/options', status=503)
            self.call(self.admin, '/admin/autoaudit/companies', status=503)
            self.call(self.boss, f"/autoaudit/sources/{row['id']}/sync", 'POST', status=503)

    def test_manual_sync_sets_force_and_request(self):
        row = self.connect_source()
        self.clear_requests()
        body = self.call(self.boss, f"/autoaudit/sources/{row['id']}/sync", 'POST', status=202)
        self.assertEqual(body['id'], row['id'])
        stored = self.sql('SELECT * FROM xm.autoaudit_sources WHERE id=%s', (row['id'],))[0]
        self.assertTrue(stored['force_requested'])
        self.assertIsNotNone(stored['check_requested_at'])
        self.call(self.staff, f"/autoaudit/sources/{row['id']}/sync", 'POST', status=403)      # members cannot
        self.call(self.boss, '/autoaudit/sources/not-a-uuid/sync', 'POST', status=404)

    def test_responses_never_contain_key_or_token(self):
        row = self.connect_source()
        texts = [json.dumps(self.call(self.boss, '/autoaudit/options')), json.dumps(self.call(self.admin, '/admin/autoaudit/companies')),
                 json.dumps(self.call(self.boss, '/autoaudit/sources')), json.dumps(row), json.dumps(self.hook())]
        for text in texts:
            self.assertNotIn(KEY, text)
            self.assertNotIn(TOKEN, text)


class WebhookTests(RouteCase):
    def test_webhook_needs_no_login_and_marks_source(self):
        self.connect_source()
        self.clear_requests()
        self.assertEqual(self.hook(), {'ok': True})
        self.assertEqual(self.requested(), 1)
        self.assertFalse(self.sql('SELECT force_requested FROM xm.autoaudit_sources')[0]['force_requested'])

    def test_webhook_wrong_or_missing_token_is_404(self):
        self.connect_source()
        self.clear_requests()
        self.hook(token='wrong', status=404)
        with patch.dict(os.environ, {'AUTOAUDIT_WEBHOOK_TOKEN': ''}):
            self.hook(token=TOKEN, status=404)
            self.hook(token='', status=404)
        self.assertEqual(self.requested(), 0)

    def test_webhook_ignores_other_events_unknown_sales_and_bad_bodies(self):
        self.connect_source()
        self.clear_requests()
        for payload in ({'group': 'sync', 'event': 'started', 'data': {'sales_id': 57}},
                        {'group': 'sync', 'event': 'failed', 'data': {'sales_id': 57}},
                        {'group': 'sync', 'event': 'completed', 'data': {'sales_id': 4242}},
                        {'group': 'sync', 'event': 'completed', 'data': {'sales_id': 'abc'}},
                        {'group': 'sync', 'event': 'completed'}, [1, 2], 'text'):
            self.assertEqual(self.hook(payload), {'ok': True})
        self.assertEqual(self.hook(raw=b'not json'), {'ok': True})
        self.assertEqual(self.requested(), 0)

    def test_webhook_marks_every_company_connected_to_sales(self):
        other, _, other_boss = self.make_company('Other')
        self.link(company=other['company_id'])
        self.connect_source()
        self.connect_source(client=other_boss)
        self.connect_source(sales_id=58)
        self.clear_requests()
        self.hook()
        self.assertEqual(self.requested(57), 2)
        self.assertEqual(self.requested(58), 0)

    def test_other_paths_still_need_login(self):
        request = urllib.request.Request(f'{self.base}/autoaudit/sources')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request, timeout=30)
        self.assertEqual(ctx.exception.code, 401)
        request = urllib.request.Request(f'{self.base}/hooksx/autoaudit/{TOKEN}', data=b'{}', method='POST')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request, timeout=30)
        self.assertEqual(ctx.exception.code, 401)
