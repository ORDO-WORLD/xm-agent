"""Activity log over real HTTP + an isolated PostgreSQL database: who sees it, what it says, what it never holds."""
import json
import os
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import activity
from test_v4_features import BUYER_HOUSE, LISTING_HOUSE_A, V4Case

# Every write the server accepts is either logged by its handler or listed here with the reason it is not.
LOGGED = {
    ('POST', '/imports'), ('POST', '/matches/recompute'), ('POST', '/buyers/recommendations/batch'),
    ('POST', '/auth/login'), ('POST', '/auth/logout'), ('PUT', '/auth/password'),
    ('PUT', '/company/settings'), ('POST', '/admin/companies'), ('PUT', '/admin/companies/{company_id}'),
    ('POST', '/team/users'), ('PUT', '/team/users/{user_id}'), ('POST', '/entities/status'),
    ('PUT', '/settings'), ('PUT', '/search-default'), ('PUT', '/search-default/personal'), ('DELETE', '/search-default/personal'),
    ('PUT', '/glossary'), ('POST', '/index/recompute'), ('POST', '/workspace/recommendations'), ('POST', '/export/pdf'),
    ('POST', '/location-index/import'), ('PUT', '/stock/tracked'), ('POST', '/stock/snapshot'),
    ('PUT', '/admin/autoaudit/link/{company_id}'), ('POST', '/autoaudit/sources'),
    ('POST', '/autoaudit/sources/{source_id}/sync'), ('DELETE', '/autoaudit/sources/{source_id}'),
}
NOT_LOGGED = {
    ('PUT', '/preferences'): 'remembers the last direction and filter of the screen',
    ('POST', '/matches/recent/seen'): 'clears the "new" badge',
    ('POST', '/location-index/preview'): 'a dry run; the import itself is logged',
    ('POST', '/export/all/plan'): 'preparation; the download is logged',
    ('POST', '/export/all/part'): 'preparation; the download is logged',
    ('POST', '/export/all/cancel'): 'removes temporary files only',
    ('POST', '/hooks/autoaudit/{token}'): 'a nudge without an actor; the pull it causes is logged',
}


class CoverageTests(unittest.TestCase):
    def test_every_write_route_is_logged_or_deliberately_exempt(self):
        import app
        writes = {(method, route.path) for route in app.app.routes for method in getattr(route, 'methods', None) or ()
                  if method not in ('GET', 'HEAD', 'OPTIONS')}
        self.assertEqual(writes - LOGGED - set(NOT_LOGGED), set(), 'new write route: log it or exempt it with a reason')
        self.assertEqual((LOGGED | set(NOT_LOGGED)) - writes, set(), 'listed route no longer exists')

    def test_helpers_keep_sentences_and_details_small(self):
        self.assertEqual(activity.listed(['a', 'b', 'c', 'd', 'e']), '"a", "b", "c" dan 2 lainnya')
        self.assertEqual(activity.number(63188), '63.188')
        trimmed = activity._trim({'data': list(range(120)), 'teks': 'x' * 900})
        self.assertEqual(len(trimmed['data']), 51)
        self.assertEqual(trimmed['data'][-1], 'dan 70 lainnya')
        self.assertEqual(len(trimmed['teks']), 500)


class ActivityCase(V4Case):
    def log(self, **query):
        query.setdefault('company', self.company['company_id'])
        query.setdefault('layers', 'change,account,export')
        return self.call(self.admin, '/admin/activity?' + urlencode(query))['rows']

    def lines(self, **query):
        return [row['summary'] for row in self.log(**query)]

    def sql(self, statement, params=()):
        from db import connect
        with connect() as conn:
            cursor = conn.execute(statement, params)
            rows = cursor.fetchall() if cursor.description else []
            conn.commit()
        return rows


class AccessTests(ActivityCase):
    def test_only_the_platform_administrator_reads_the_log(self):
        for path in ('/admin/activity', '/admin/activity/filters'):
            self.call(self.staff, path, status=403)
            self.call(self.boss, path, status=403)
            self.call(self.admin, path)
        # Nothing a company can load mentions the log.
        for path in ('/company/settings', '/auth/me', '/stats'):
            self.assertNotIn('activity', json.dumps(self.call(self.boss, path), default=str).lower())

    def test_administrator_sees_every_company_and_can_filter(self):
        other, _, other_boss = self.make_company('Lain')
        self.call(self.boss, '/stock/snapshot', 'POST')
        self.call(other_boss, '/stock/snapshot', 'POST')
        everything = self.call(self.admin, '/admin/activity?action=stock.snapshot')['rows']
        self.assertTrue({self.company['company_id'], other['company_id']} <= {row['company_id'] for row in everything})
        mine = self.log(action='stock.snapshot')
        self.assertEqual({row['company_id'] for row in mine}, {self.company['company_id']})
        self.assertEqual(mine[0]['company_name'], 'Isolation V4')
        self.assertEqual(self.log(actor=self.user['email'], action='stock.snapshot')[0]['actor_name'], 'Admin V4')
        self.assertEqual(self.log(actor=other_boss and 'nobody@example.com'), [])
        filters = self.call(self.admin, '/admin/activity/filters')
        self.assertIn(self.company['company_id'], [item['id'] for item in filters['companies']])
        self.assertIn('stock.snapshot', [item['id'] for item in filters['actions']])
        self.call(self.admin, '/admin/activity?date_from=bukan-tanggal', status=400)

    def test_reading_the_log_is_not_logged(self):
        before = self.sql('SELECT count(*) AS n FROM xm.activity_log')[0]['n']
        self.call(self.admin, '/admin/activity')
        self.call(self.admin, '/admin/activity/filters')
        self.assertEqual(self.sql('SELECT count(*) AS n FROM xm.activity_log')[0]['n'], before)


class SentenceTests(ActivityCase):
    def test_account_actions(self):
        self.assertIn('membuat company "Isolation V4" dengan admin ' + self.user['email'], self.lines())
        self.assertIn(f"menambah akun {self.member['email']} sebagai anggota", self.lines())
        self.call(self.boss, f"/team/users/{self.member['id']}", 'PUT', {
            'email': self.member['email'], 'display_name': 'Staff', 'is_locked': True, 'password': 'baru-rahasia-999'})
        row = self.log(action='team.edit')[0]
        self.assertEqual(row['summary'], f"akun {self.member['email']}: mengunci akun, mereset password")
        self.assertEqual(row['details']['sebelum']['terkunci'], False)
        self.assertEqual(row['details']['sesudah']['terkunci'], True)
        self.assertEqual((row['actor_name'], row['layer'], row['as_admin']), ('Admin V4', 'account', False))
        self.call(self.boss, '/auth/password', 'PUT', {'current_password': 'isolation-user-pass', 'new_password': 'isolation-user-pass2'}, status=204)
        self.assertEqual(self.lines(action='auth.password'), ['mengganti password sendiri'])
        self.call(self.boss, '/auth/logout', 'POST', status=204)
        self.assertEqual(self.lines(actor=self.user['email'])[:2], ['keluar', 'mengganti password sendiri'])
        self.assertIn('masuk', self.lines(actor=self.user['email']))

    def test_failed_logins_are_kept_and_merged(self):
        for _ in range(3):
            self.call(self.admin, '/auth/login', 'POST', {'email': self.user['email'], 'password': 'salah-sekali'}, status=401)
        row = self.log(action='auth.login_failed')[0]
        self.assertEqual(row['summary'], f"gagal masuk dengan email {self.user['email']} (password salah)")
        self.assertEqual((row['repeat_count'], row['failed']), (3, True))
        self.call(self.admin, '/auth/login', 'POST', {'email': 'isol-tidak-ada@example.com', 'password': 'salah-sekali'}, status=401)
        unknown = self.call(self.admin, '/admin/activity?actor=isol-tidak-ada@example.com')['rows'][0]
        self.assertEqual(unknown['summary'], 'gagal masuk dengan email isol-tidak-ada@example.com (akun tidak ada)')
        self.assertIsNone(unknown['company_id'])

    def test_changes_say_what_was_before_and_after(self):
        self.seed()
        self.assertIn('mengunggah "cleaned.json" sebagai sumber Caesar', self.lines(action='import.upload'))
        done = self.log(action='import.done')[0]
        self.assertEqual((done['actor_name'], done['details']['pesan']), ('Sistem', 5))
        self.assertTrue(done['summary'].startswith('selesai memproses "cleaned.json" (Caesar): 5 pesan, 3 listing, 2 buyer'))
        listing = self.card(self.rows(direction='property'), 'Budi')
        self.call(self.staff, '/entities/status', 'POST', {'ids': [listing['public_id']], 'status': 'sold', 'note': 'deal 3 Okt'})
        status = self.log(action='entity.status')[0]
        self.assertEqual(status['summary'], f"mengubah status {listing['public_id']} dari Ready ke Sold, catatan: \"deal 3 Okt\"")
        self.assertEqual(status['actor_name'], 'Staff')
        self.call(self.staff, '/entities/status', 'POST', {'ids': [listing['public_id']], 'status': 'sold'})
        self.assertEqual(len(self.log(action='entity.status')), 1)          # nothing changed, nothing logged

        settings = self.call(self.boss, '/settings')
        payload = {key: float(settings[key]) for key in settings if key.endswith('_pct')}
        self.call(self.boss, '/settings', 'PUT', {**payload, 'price_tolerance_pct': 15})
        self.assertEqual(self.lines(action='match.settings'), ['mengubah toleransi harga dari 10% ke 15%'])
        self.call(self.boss, '/settings', 'PUT', {**payload, 'price_tolerance_pct': 15})
        self.assertEqual(len(self.log(action='match.settings')), 1)

        self.call(self.boss, '/search-default', 'PUT', {'terms': ['darmo', 'citraland']})
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['darmo', 'pakuwon'], 'locked': True})
        self.assertEqual(self.lines(action='search.company'), [
            'kata kunci company: menambah "pakuwon", menghapus "citraland", mengunci kata kunci',
            'kata kunci company: menambah "darmo", "citraland"'])
        self.call(self.boss, '/glossary', 'PUT', {'entries': {'sby': 'surabaya', 'ctr': 'citraland'}})
        self.call(self.boss, '/glossary', 'PUT', {'entries': {'sby': 'surabaya barat'}})
        self.assertEqual(self.lines(action='glossary.save')[0], 'glosarium: menghapus 1 istilah, mengubah 1 istilah')
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': '6282233744657'})
        self.assertEqual(self.lines(action='stock.tracked'), ['menambah nomor sales 6282233744657'])
        self.call(self.boss, '/company/settings', 'PUT', {'listing_group_by': 'phone'})
        self.assertEqual(self.lines(action='company.settings'), ['mengelompokkan listing per nomor telepon'])

    def test_administrator_inside_a_company_is_marked(self):
        self.call(self.admin, '/stock/snapshot', 'POST', owner=self.user)
        row = self.log(action='stock.snapshot')[0]
        self.assertEqual((row['actor_email'], row['as_admin'], row['company_id']),
                         (self.ADMIN_EMAIL, True, self.company['company_id']))
        self.call(self.admin, '/company/settings', owner=self.user)
        self.assertEqual(self.lines(action='company.enter'), ['masuk ke company Isolation V4'])

    def test_exports_are_logged(self):
        self.seed()
        buyer = self.card(self.rows(), 'rumah')
        target = self.recs(buyer['id'])[0]
        self.call(self.staff, '/export/pdf', 'POST', {'direction': 'buyer', 'pairs': [{'source_id': buyer['id'], 'target_id': target['id']}]})
        row = self.log(action='export.pdf')[0]
        self.assertEqual((row['summary'], row['layer'], row['actor_name']), ('mengunduh PDF 1 pasangan dari Cocokkan', 'export', 'Staff'))


class ViewTests(ActivityCase):
    def test_views_are_hidden_by_default_merged_and_expire(self):
        self.seed()
        for _ in range(5):
            self.call(self.staff, '/dashboard/overview')
        self.assertNotIn('membuka Beranda', self.lines())
        everything = self.log(layers='change,account,export,view')
        opened = next(row for row in everything if row['summary'] == 'membuka Beranda')
        self.assertEqual((opened['repeat_count'], opened['layer'], opened['actor_name']), (5, 'view', 'Staff'))
        self.rows(self.staff, direction='property')
        self.rows(self.staff, direction='buyer', search='citraland')
        buyer = self.card(self.rows(self.staff), 'rumah')
        self.recs(buyer['id'])
        self.call(self.staff, '/stock/log')
        self.call(self.staff, '/imports')
        self.call(self.staff, '/imports')
        views = {row['summary']: row for row in self.log(layers='view')}
        self.assertIn('membuka Cocokkan (Properti ke Buyer)', views)
        self.assertIn('mencari "citraland" di Cocokkan (Buyer ke Properti)', views)
        self.assertIn(f"membuka rekomendasi untuk {buyer['public_id']}", views)
        self.assertIn('membuka Stok Sales', views)
        self.assertEqual(views['membuka Unggah Data']['repeat_count'], 1)     # the page polls; repeats are not counted
        # A different person gets a line of their own.
        self.call(self.boss, '/dashboard/overview')
        self.assertEqual(len([row for row in self.log(layers='view') if row['summary'] == 'membuka Beranda']), 2)

        self.sql("UPDATE xm.activity_log SET last_at = now() - interval '91 days' WHERE company_id=%s", (self.company['company_id'],))
        with patch.dict(os.environ, {'ACTIVITY_VIEW_RETENTION_DAYS': '90'}):
            self.assertGreater(activity.purge_views(), 0)
        self.assertEqual(self.log(layers='view'), [])
        self.assertIn('membuat company "Isolation V4" dengan admin ' + self.user['email'], self.lines())

    def test_a_broken_view_log_never_blocks_the_screen(self):
        with patch.object(activity, 'record', side_effect=RuntimeError('log down')):
            self.call(self.staff, '/dashboard/overview')
            self.call(self.staff, '/stock/log')

    def test_older_pages_follow_the_cursor(self):
        for index in range(3):
            self.call(self.boss, '/stock/snapshot', 'POST')
        first = self.call(self.admin, f"/admin/activity?company={self.company['company_id']}&action=stock.snapshot&limit=2")
        self.assertEqual(len(first['rows']), 2)
        rest = self.call(self.admin, f"/admin/activity?company={self.company['company_id']}&action=stock.snapshot&limit=2&before={first['next']}")
        self.assertEqual(len(rest['rows']), 1)
        self.assertIsNone(rest['next'])
        self.assertEqual(len({row['id'] for row in first['rows'] + rest['rows']}), 3)


class SafetyTests(ActivityCase):
    def test_a_change_that_cannot_be_logged_does_not_happen(self):
        with patch.object(activity, 'record', side_effect=RuntimeError('log down')):
            self.call(self.boss, '/team/users', 'POST', {'email': 'isol-batal@example.com', 'display_name': 'Batal', 'password': 'batal-pass-123'}, status=500)
            self.call(self.boss, '/stock/tracked', 'PUT', {'phones': '6282233744657'}, status=500)
        self.assertEqual(self.sql("SELECT 1 FROM xm.users WHERE email='isol-batal@example.com'"), [])
        self.assertEqual(self.sql('SELECT 1 FROM xm.tracked_sales WHERE company_id=%s', (self.company['company_id'],)), [])

    def test_a_failed_action_leaves_no_line(self):
        self.call(self.boss, '/team/users', 'POST', {'email': self.member['email'], 'display_name': 'Kembar', 'password': 'kembar-pass-123'}, status=409)
        self.assertEqual(len(self.log(action='team.add')), 1)

    def test_no_secret_ever_reaches_the_log(self):
        secrets = ['isolation-user-pass', 'member-pass-123', 'baru-rahasia-999', 'salah-sekali', self.ADMIN_PASSWORD, 'k-secret-key', 'tok-0123456789']
        self.call(self.boss, f"/team/users/{self.member['id']}", 'PUT', {
            'email': self.member['email'], 'display_name': 'Staff', 'is_locked': False, 'password': 'baru-rahasia-999'})
        self.call(self.admin, '/auth/login', 'POST', {'email': self.user['email'], 'password': 'salah-sekali'}, status=401)
        self.call(self.boss, '/auth/password', 'PUT', {'current_password': 'isolation-user-pass', 'new_password': 'isolation-user-pass-x'}, status=204)
        stored = json.dumps(self.sql('SELECT * FROM xm.activity_log'), default=str)
        served = json.dumps(self.call(self.admin, '/admin/activity?layers=change,account,export,view&limit=200'), default=str)
        for secret in secrets:
            self.assertNotIn(secret, stored)
            self.assertNotIn(secret, served)
        self.assertNotIn('password_hash', stored)
        self.assertNotIn('pbkdf2', stored)


if __name__ == '__main__':
    unittest.main()
