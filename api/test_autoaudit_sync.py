"""AutoAudit sync: range rules and retry (pure), then check-and-pull against an isolated DB."""
import json
import os
import tempfile
import unittest
import uuid
from datetime import date
from pathlib import Path
from unittest.mock import patch

import autoaudit_sync
from autoaudit_client import AutoAuditError
from autoaudit_sync import chunk_ranges, start_date, with_retry
from test_v4_features import BUYER_HOUSE, LISTING_HOUSE_A, LISTING_RUKO, V4Case


class RangeRuleTests(unittest.TestCase):
    def test_start_continues_two_days_before_last_message(self):
        self.assertEqual(start_date(date(2026, 9, 16), date(2023, 1, 5)), date(2026, 9, 14))

    def test_start_is_first_message_when_company_empty(self):
        self.assertEqual(start_date(None, date(2023, 1, 5)), date(2023, 1, 5))

    def test_start_is_none_when_nothing_known(self):
        self.assertIsNone(start_date(None, None))

    def test_chunks_cover_range_without_gap_or_overlap(self):
        self.assertEqual(chunk_ranges(date(2026, 9, 14), date(2026, 10, 9), 31),
                         [(date(2026, 9, 14), date(2026, 10, 9))])
        self.assertEqual(chunk_ranges(date(2026, 1, 1), date(2026, 3, 5), 31),
                         [(date(2026, 1, 1), date(2026, 1, 31)), (date(2026, 2, 1), date(2026, 3, 3)),
                          (date(2026, 3, 4), date(2026, 3, 5))])

    def test_chunks_empty_when_start_after_end(self):
        self.assertEqual(chunk_ranges(date(2026, 10, 10), date(2026, 10, 9), 31), [])

    def test_single_day_is_one_chunk(self):
        self.assertEqual(chunk_ranges(date(2026, 10, 9), date(2026, 10, 9), 31), [(date(2026, 10, 9), date(2026, 10, 9))])


class RetryTests(unittest.TestCase):
    def action(self, failures, status=503, retryable=True):
        self.calls = 0

        def run():
            self.calls += 1
            if self.calls <= failures:
                raise AutoAuditError('x', status=status, retryable=retryable)
            return 'ok'
        return run

    def test_retry_succeeds_on_fourth_attempt(self):
        slept = []
        self.assertEqual(with_retry(self.action(3), 10, 15, sleep=slept.append), 'ok')
        self.assertEqual(slept, [15, 15, 15])

    def test_retry_gives_up_after_ten_attempts(self):
        slept = []
        with self.assertRaises(AutoAuditError):
            with_retry(self.action(99), 10, 15, sleep=slept.append)
        self.assertEqual(self.calls, 10)
        self.assertEqual(len(slept), 9)

    def test_retry_does_not_repeat_auth_errors(self):
        slept = []
        with self.assertRaises(AutoAuditError):
            with_retry(self.action(99, status=401, retryable=False), 10, 15, sleep=slept.append)
        self.assertEqual(self.calls, 1)
        self.assertEqual(slept, [])


SALES = 57
UPDATED = '2026-10-09T01:14:00.000Z'
SEED = [(BUYER_HOUSE, '~ Rina'), (LISTING_HOUSE_A, '~ Andi'), (LISTING_RUKO, '~ Budi')]


def chats_for(messages, first_day=1):
    """Same shape and timestamps as harness.upload, so message hashes match a manual upload."""
    rows = [[f'2026-09-{first_day + index:02}T10:00:00', text, author] for index, (text, author) in enumerate(messages)]
    return {'room': {'name': 'Private chat', 'messages': rows}}


class FakeClient:
    def __init__(self, chats=None, updated=UPDATED, first='2026-07-01', has_data=True, fail_times=0, errors=None, company_id=1):
        self.chats = chats_for(SEED) if chats is None else chats
        self.summary = {'company_id': company_id, 'has_cleaned_data': has_data, 'first_message_date': first, 'last_message_date': '2026-10-09',
                        'last_updated_at': updated}
        self.fail_times = fail_times
        self.errors = errors or {}
        self.downloads = []

    def dataset_summary(self, sales_id):
        if sales_id in self.errors:
            raise self.errors[sales_id]
        return dict(self.summary)

    def download_range(self, sales_id, start, end):
        self.downloads.append((start, end))
        if self.fail_times > 0:
            self.fail_times -= 1
            raise AutoAuditError('AutoAudit menjawab 503', status=503)
        return {'chats': self.chats}


class SyncCase(V4Case):
    def setUp(self):
        super().setUp()
        self.uploads = tempfile.TemporaryDirectory()
        self.addCleanup(self.uploads.cleanup)
        for item in (patch.object(autoaudit_sync, 'UPLOAD_DIR', Path(self.uploads.name)),
                     patch.object(autoaudit_sync, 'today', lambda: date(2026, 10, 9))):
            item.start()
            self.addCleanup(item.stop)
        self.cid = self.company['company_id']
        self.sql('DELETE FROM xm.autoaudit_sources')
        self.link(self.cid)

    def link(self, company, autoaudit_company_id=1):
        self.sql('UPDATE xm.app_preferences SET autoaudit_company_id=%s, autoaudit_company_name=%s WHERE company_id=%s',
                 (autoaudit_company_id, 'XM Darmo' if autoaudit_company_id else None, company))

    def sql(self, statement, params=()):
        from db import connect
        with connect() as conn:
            cursor = conn.execute(statement, params)
            rows = cursor.fetchall() if cursor.description else []
            conn.commit()
        return rows

    def source(self, company=None, sales_id=SALES, agent='Caesar', **columns):
        sid = str(uuid.uuid4())
        self.sql('INSERT INTO xm.autoaudit_sources(id, company_id, sales_id, sales_name, agent_name) VALUES(%s,%s,%s,%s,%s)',
                 (sid, company or self.cid, sales_id, 'Caesar', agent))
        for column, value in columns.items():
            self.sql(f'UPDATE xm.autoaudit_sources SET {column}=%s WHERE id=%s', (value, sid))
        return sid

    def stored(self, sid, column):
        return self.sql(f'SELECT {column} FROM xm.autoaudit_sources WHERE id=%s', (sid,))[0][column]

    def imports(self, company=None):
        return self.sql("SELECT * FROM xm.imports WHERE company_id=%s AND source='autoaudit' ORDER BY created_at", (company or self.cid,))

    def process_queued(self):
        for row in self.sql("SELECT id FROM xm.imports WHERE company_id=%s AND status='queued' ORDER BY created_at", (self.cid,)):
            self.process({'id': str(row['id'])})

    def sync(self, sid, client, **kwargs):
        return autoaudit_sync.sync_source(sid, client, sleep=lambda seconds: None, **kwargs)


class SyncSourceTests(SyncCase):
    def test_unchanged_dataset_downloads_nothing(self):
        sid = self.source(dataset_updated_at=UPDATED)
        fake = FakeClient()
        self.assertEqual(self.sync(sid, fake), 'current')
        self.assertEqual(fake.downloads, [])
        self.assertIsNotNone(self.stored(sid, 'last_checked_at'))

    def test_manual_sync_pulls_even_when_dataset_unchanged(self):
        sid = self.source(dataset_updated_at=UPDATED, force_requested=True, check_requested_at='2026-10-09T00:00:00Z')
        fake = FakeClient()
        self.assertEqual(self.sync(sid, fake), 'current')
        self.assertEqual(len(fake.downloads), 4)
        self.assertFalse(self.stored(sid, 'force_requested'))
        self.assertIsNone(self.stored(sid, 'check_requested_at'))

    def test_newer_dataset_queues_import_with_source_agent_name(self):
        sid = self.source(agent='XM Darmo Caesar')
        fake = FakeClient()
        self.assertEqual(self.sync(sid, fake), 'current')
        rows = self.imports()
        self.assertEqual(len(rows), 1)                    # identical chunks collapse into one file
        row = rows[0]
        self.assertEqual((row['agent_name'], row['source'], row['status']), ('XM Darmo Caesar', 'autoaudit', 'queued'))
        self.assertTrue(row['file_name'].startswith(f'autoaudit_sales_{SALES}_2026-07-01_'))
        self.assertEqual(json.loads(Path(row['file_path']).read_text(encoding='utf-8'))['chats'], fake.chats)
        self.assertEqual(self.stored(sid, 'dataset_updated_at'), UPDATED)
        self.assertIsNone(self.stored(sid, 'last_error'))

    def test_filled_company_starts_two_days_before_last_message(self):
        self.run_import(SEED, agent='Caesar')              # manual upload, newest message 2026-09-03
        sid = self.source(agent='Caesar')
        fake = FakeClient()
        self.sync(sid, fake)
        self.assertEqual(fake.downloads[0][0], date(2026, 9, 1))
        self.assertEqual(fake.downloads[-1][1], date(2026, 10, 9))

    def test_empty_company_starts_at_first_message_date_in_chunks(self):
        sid = self.source()
        fake = FakeClient(first='2026-07-01')
        self.sync(sid, fake)
        self.assertEqual(fake.downloads, [(date(2026, 7, 1), date(2026, 7, 31)), (date(2026, 8, 1), date(2026, 8, 31)),
                                          (date(2026, 9, 1), date(2026, 10, 1)), (date(2026, 10, 2), date(2026, 10, 9))])

    def test_other_source_names_do_not_move_the_start(self):
        self.run_import(SEED, agent='Somebody Else')
        sid = self.source(agent='Caesar')
        fake = FakeClient(first='2026-10-01')
        self.sync(sid, fake)
        self.assertEqual(fake.downloads[0][0], date(2026, 10, 1))

    def test_empty_chunk_queues_nothing_and_still_completes(self):
        sid = self.source()
        self.assertEqual(self.sync(sid, FakeClient(chats={})), 'current')
        self.assertEqual(self.imports(), [])
        self.assertEqual(self.stored(sid, 'dataset_updated_at'), UPDATED)

    def test_dataset_not_ready_waits(self):
        sid = self.source()
        fake = FakeClient(has_data=False)
        self.assertEqual(self.sync(sid, fake), 'waiting')
        self.assertEqual(fake.downloads, [])
        fake = FakeClient(first=None)
        self.assertEqual(self.sync(sid, fake), 'waiting')

    def test_same_content_twice_is_not_queued_again(self):
        sid = self.source()
        self.sync(sid, FakeClient())
        self.process_queued()
        self.sync(sid, FakeClient(updated='2026-10-09T05:00:00.000Z'))
        self.assertEqual(len(self.imports()), 1)
        self.assertEqual(self.stored(sid, 'dataset_updated_at'), '2026-10-09T05:00:00.000Z')

    def test_ten_failures_mark_failed_and_keep_marker(self):
        sid = self.source()
        fake = FakeClient(fail_times=99)
        self.assertEqual(self.sync(sid, fake), 'failed')
        self.assertEqual(len(fake.downloads), 10)
        self.assertIsNone(self.stored(sid, 'dataset_updated_at'))
        self.assertIn('503', self.stored(sid, 'last_error'))
        self.assertEqual(self.stored(sid, 'status'), 'failed')

    def activity(self, action):
        return self.sql('SELECT actor_name, summary, failed FROM xm.activity_log WHERE company_id=%s AND action=%s ORDER BY id',
                        (self.cid, action))

    def test_pull_and_failure_reach_the_activity_log_once(self):
        sid = self.source(agent='XM Darmo Caesar')
        self.sync(sid, FakeClient(fail_times=99))
        self.sync(sid, FakeClient(fail_times=99))          # the same failure again is not a new line
        failed = self.activity('autoaudit.failed')
        self.assertEqual(len(failed), 1)
        self.assertEqual((failed[0]['actor_name'], failed[0]['failed']), ('Sistem', True))
        self.assertIn('gagal menarik data AutoAudit Caesar: AutoAudit menjawab 503', failed[0]['summary'])
        self.sync(sid, FakeClient())
        self.sync(sid, FakeClient())                       # nothing new: no download, no line
        pulled = self.activity('autoaudit.pull')
        self.assertEqual([row['summary'] for row in pulled],
                         ['menarik data AutoAudit Caesar (XM Darmo Caesar) dari 2026-07-01 sampai 2026-10-09: 1 berkas baru'])
        self.process_queued()
        done = self.activity('import.done')
        self.assertEqual(len(done), 1)
        self.assertIn('(XM Darmo Caesar)', done[0]['summary'])

    def test_three_failures_then_success(self):
        sid = self.source()
        fake = FakeClient(fail_times=3, first='2026-10-05')
        self.assertEqual(self.sync(sid, fake), 'current')
        self.assertEqual(len(fake.downloads), 4)

    def test_failure_recovers_on_next_check(self):
        sid = self.source()
        self.sync(sid, FakeClient(fail_times=99))
        self.assertEqual(self.sync(sid, FakeClient()), 'current')
        self.assertIsNone(self.stored(sid, 'last_error'))

    def test_pending_autoaudit_import_defers_next_pull(self):
        sid = self.source()
        self.sync(sid, FakeClient())
        later = FakeClient(updated='2026-10-09T05:00:00.000Z')
        self.sync(sid, later)
        self.assertEqual(later.downloads, [])
        self.assertEqual(self.stored(sid, 'dataset_updated_at'), UPDATED)

    def test_repull_does_not_add_listings_and_keeps_sold_status(self):
        self.run_import(SEED, agent='Caesar')              # what was uploaded by hand before connecting
        before = self.rows(direction='property')
        self.assertEqual(len(before), 2)
        target = self.card(before, 'Budi 0812')
        self.call(self.staff, '/entities/status', 'POST', {'ids': [target['public_id']], 'status': 'sold'})
        sid = self.source(agent='Caesar')
        self.assertEqual(self.sync(sid, FakeClient()), 'current')
        self.process_queued()
        after = self.rows(direction='property', stock_status='ready,on_hold,sold')
        self.assertEqual(sorted(r['public_id'] for r in after), sorted(r['public_id'] for r in before))
        self.assertEqual({r['public_id']: r['entity_status'] for r in after}[target['public_id']], 'sold')
        self.assertEqual(len(self.rows(direction='buyer')), 1)

    def test_company_without_autoaudit_company_pulls_nothing(self):
        self.link(self.cid, None)
        sid = self.source()
        fake = FakeClient()
        self.assertEqual(self.sync(sid, fake), 'failed')
        self.assertEqual(fake.downloads, [])
        self.assertIn('belum dihubungkan', self.stored(sid, 'last_error'))

    def test_sales_outside_the_linked_company_pulls_nothing(self):
        sid = self.source()
        fake = FakeClient(company_id=2)
        self.assertEqual(self.sync(sid, fake), 'failed')
        self.assertEqual(fake.downloads, [])
        self.assertIn('di luar company', self.stored(sid, 'last_error'))
        self.assertEqual(self.imports(), [])

    def test_new_messages_arrive_through_the_normal_pipeline(self):
        sid = self.source(agent='Caesar')
        self.sync(sid, FakeClient())
        self.process_queued()
        self.assertEqual(len(self.rows(direction='property')), 2)
        self.assertEqual(len(self.rows(direction='buyer')), 1)


class WorkerLoopTests(SyncCase):
    def test_not_configured_does_nothing(self):
        self.source(check_requested_at='2026-10-09T00:00:00Z')
        with patch.dict(os.environ, {'AUTOAUDIT_BASE_URL': '', 'AUTOAUDIT_API_KEY': ''}):
            self.assertFalse(autoaudit_sync.run_once())

    def test_webhook_requested_source_is_claimed_before_stale_one(self):
        self.source(sales_id=1)                                             # never checked: due
        requested = self.source(sales_id=2, check_requested_at='2026-10-09T00:00:00Z')
        self.assertEqual(autoaudit_sync.claim_due(), requested)

    def test_recently_checked_source_is_not_due(self):
        sid = self.source()
        self.sql("UPDATE xm.autoaudit_sources SET last_checked_at=now() - interval '5 minutes' WHERE id=%s", (sid,))
        self.assertIsNone(autoaudit_sync.claim_due())

    def test_source_older_than_ten_minutes_is_due_once(self):
        sid = self.source()
        self.sql("UPDATE xm.autoaudit_sources SET last_checked_at=now() - interval '11 minutes' WHERE id=%s", (sid,))
        self.assertEqual(autoaudit_sync.claim_due(), sid)
        self.assertIsNone(autoaudit_sync.claim_due())

    def test_one_failing_source_does_not_stop_others(self):
        _, other_user, _ = self.make_company('Other')
        broken = self.source(sales_id=1)
        self.link(other_user['workspace_id'])
        healthy = self.source(company=other_user['workspace_id'], sales_id=2)
        client = FakeClient(errors={1: ConnectionError('down')})
        self.assertTrue(autoaudit_sync.run_once(client, sleep=lambda seconds: None))
        self.assertTrue(autoaudit_sync.run_once(client, sleep=lambda seconds: None))
        self.assertFalse(autoaudit_sync.run_once(client, sleep=lambda seconds: None))
        self.assertEqual(self.stored(broken, 'status'), 'failed')
        self.assertTrue(self.stored(broken, 'last_error'))
        self.assertEqual(self.stored(healthy, 'status'), 'current')

    def test_reset_stuck_returns_pulling_to_waiting(self):
        sid = self.source(status='pulling')
        autoaudit_sync.reset_stuck()
        self.assertEqual(self.stored(sid, 'status'), 'waiting')


if __name__ == '__main__':
    unittest.main()
