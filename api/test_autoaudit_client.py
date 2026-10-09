"""AutoAudit HTTP client: response shapes, retry classification and secret hygiene (no network)."""
import io
import json
import unittest
import urllib.error
from datetime import date

from autoaudit_client import AutoAuditClient, AutoAuditError, companies_from

KEY = 'k-secret'


class Reply:
    def __init__(self, body, status=200, ctype='application/json; charset=utf-8'):
        self.status = status
        self.headers = {'Content-Type': ctype}
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def client_for(*replies):
    seen = []
    queue = list(replies)

    def opener(request, timeout=None):
        seen.append(request)
        reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(reply, Exception):
            raise reply
        return reply
    return AutoAuditClient('https://app.example.test/', KEY, opener=opener), seen


def http_error(status, body=b'{"success":false,"error":{"code":"boom","message":"x"}}'):
    return urllib.error.HTTPError('https://app.example.test/x', status, 'err', {}, io.BytesIO(body))


def error_for(status):
    reply = Reply({'success': True}, status=202) if status == 202 else http_error(status)
    client, _ = client_for(reply)
    try:
        client.download_range(57, date(2026, 9, 1), date(2026, 9, 2))
    except AutoAuditError as exc:
        return exc
    raise AssertionError('expected AutoAuditError')


def sale(sales_id, name, company):
    return {'id': sales_id, 'name': name, 'company': {'id': 2 if company == 'Konig' else 1, 'name': company}, 'dataset': {}}


class AutoAuditClientTests(unittest.TestCase):
    def test_list_sales_follows_pagination(self):
        pages = [Reply({'success': True, 'data': [sale(57, 'Caesar', 'XM Darmo'), sale(58, 'Maria', 'XM Darmo')],
                        'pagination': {'page': 1, 'total_pages': 2}}),
                 Reply({'success': True, 'data': [sale(61, 'Konig', 'Konig')], 'pagination': {'page': 2, 'total_pages': 2}})]
        client, seen = client_for(*pages)
        rows = client.list_sales()
        self.assertEqual([s['id'] for s in rows], [57, 58, 61])
        self.assertEqual(rows[0], {'id': 57, 'name': 'Caesar', 'company': 'XM Darmo', 'company_id': 1})
        self.assertEqual(companies_from(rows), [{'id': 2, 'name': 'Konig'}, {'id': 1, 'name': 'XM Darmo'}])
        self.assertEqual(len(seen), 2)
        self.assertIn('page=2', seen[1].full_url)

    def test_requests_carry_bearer_key_and_never_put_it_in_url(self):
        client, seen = client_for(Reply({'success': True, 'data': [], 'pagination': {}}))
        client.list_sales()
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer ' + KEY)
        self.assertNotIn(KEY, seen[0].full_url)
        self.assertTrue(seen[0].full_url.startswith('https://app.example.test/api/v1/integrations/sales?'))

    def test_dataset_summary_returns_dataset_block(self):
        client, seen = client_for(Reply({'success': True, 'data': {'id': 57, 'company': {'id': 7, 'name': 'XM Darmo'}, 'dataset': {
            'has_cleaned_data': True, 'last_updated_at': '2026-10-09T01:14:00.000Z'}}}))
        summary = client.dataset_summary(57)
        self.assertEqual(summary['last_updated_at'], '2026-10-09T01:14:00.000Z')
        self.assertEqual(summary['company_id'], 7)                  # lets the sync verify the sales still belongs to the linked company
        self.assertTrue(seen[0].full_url.endswith('/api/v1/integrations/sales/57'))

    def test_download_unwraps_data_dataset(self):
        body = {'success': True, 'download_format': 'json',
                'data': {'sales_id': 57, 'dataset': {'chats': {'c1': {'name': 'Grup', 'messages': []}}}}}
        client, seen = client_for(Reply(body))
        self.assertEqual(list(client.download_range(57, date(2026, 9, 14), date(2026, 10, 9))['chats']), ['c1'])
        self.assertIn('/sales/57/artifacts/download?', seen[-1].full_url)
        self.assertIn('start_date=2026-09-14', seen[-1].full_url)
        self.assertIn('end_date=2026-10-09', seen[-1].full_url)

    def test_download_rejects_non_json_and_missing_chats(self):
        for body, ctype in [(b'PK\x03\x04', 'application/zip'), (b'<html>', 'text/html'),
                            (b'{"success":true,"data":{"dataset":{}}}', 'application/json'),
                            (b'{"success":true,"data":{"dataset":{"chats":[]}}}', 'application/json'),
                            (b'[1,2]', 'application/json')]:
            client, _ = client_for(Reply(body, ctype=ctype))
            with self.assertRaises(AutoAuditError) as ctx:
                client.download_range(57, date(2026, 9, 1), date(2026, 9, 2))
            self.assertTrue(ctx.exception.retryable, body)

    def test_auth_errors_are_not_retryable_and_server_errors_are(self):
        self.assertFalse(error_for(401).retryable)
        self.assertFalse(error_for(403).retryable)
        self.assertFalse(error_for(400).retryable)
        self.assertTrue(error_for(404).retryable)
        self.assertTrue(error_for(429).retryable)
        self.assertTrue(error_for(503).retryable)
        self.assertTrue(error_for(202).retryable)
        self.assertEqual(error_for(404).status, 404)
        self.assertEqual(error_for(404).code, 'boom')

    def test_network_failures_are_retryable(self):
        for failure in (urllib.error.URLError('down'), TimeoutError('slow'), ConnectionResetError('reset')):
            client, _ = client_for(failure)
            with self.assertRaises(AutoAuditError) as ctx:
                client.dataset_summary(57)
            self.assertTrue(ctx.exception.retryable)
            self.assertIsNone(ctx.exception.status)

    def test_error_message_never_contains_key(self):
        leaky = http_error(500, ('{"error":{"code":"x","message":"bad ' + KEY + '"}}').encode())
        client, _ = client_for(leaky)
        with self.assertRaises(AutoAuditError) as ctx:
            client.dataset_summary(57)
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertNotIn(KEY, repr(ctx.exception))


if __name__ == '__main__':
    unittest.main()
