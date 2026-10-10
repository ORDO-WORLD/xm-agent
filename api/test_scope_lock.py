"""Company scope is mandatory on manual reads, direct exports and cached dashboards."""
import unittest
from urllib.parse import urlencode

from harness import ServerTestCase
from test_matching_scope import BUYER, OWNED_BUYER, KONIG, OTHER, PHONE


class CompanyLockTests(ServerTestCase):
    def setUp(self):
        super().setUp()
        self.company, self.owner, self.boss = self.make_company('MandatoryScope')
        self.member, self.staff = self.make_member(self.boss)
        self.process(self.upload(self.owner, texts=[BUYER, OWNED_BUYER, KONIG, OTHER], agent='Konig uploader'))
        self.buyers = {row['raw_text']: row for row in self.rows('buyer')}
        self.listings = {row['raw_text']: row for row in self.rows('property')}

    def rows(self, direction, client=None, **query):
        params = urlencode({'direction': direction, 'statuses': 'hot,warm,unmatched', **query})
        return self.call(client or self.staff, '/workspace?' + params)['rows']

    def recommend(self, direction, *rows):
        return self.call(self.staff, '/workspace/recommendations', 'POST',
                         {'direction': direction, 'ids': [row['id'] for row in rows]})['groups']

    def lock_company(self, terms=('konig',), locked=True):
        self.call(self.boss, '/search-default', 'PUT', {'terms': list(terms), 'locked': locked})

    def overview(self):
        return self.call(self.staff, '/dashboard/overview?period=custom&date_from=2026-01-01&date_to=2026-12-31')

    def assert_dashboard(self, buyers, listings, matches):
        stats = self.call(self.staff, '/stats')
        self.assertEqual((stats['buyer_requests'], stats['listings'], stats['matches']), (buyers, listings, matches))
        overview = self.overview()
        self.assertEqual((overview['kpi']['buyers'], overview['kpi']['listings'], overview['kpi']['matches']),
                         (buyers, listings, matches))
        self.assertEqual((sum(overview['trend']['buyers']), sum(overview['trend']['listings']),
                          sum(overview['trend']['matches'])), (buyers, listings, matches))
        self.assertEqual(sum(item['value'] for item in overview['categories']), buyers)
        self.assertEqual(sum(item['value'] for item in overview['transactions']), buyers)
        self.assertEqual(sum(overview['budget']['sale']) + sum(overview['budget']['rent']) + overview['budget']['skipped'], buyers)
        self.assertEqual(sum(overview['status']['buyer'].values()), buyers)
        self.assertEqual(sum(overview['status']['listing'].values()), listings)
        summary = self.call(self.staff, '/entities/summary')
        self.assertEqual((sum(summary['buyer'].values()), sum(summary['listing'].values())), (buyers, listings))
        return overview

    def assert_directional_manual_scope(self, direction, owned, external, external_target):
        for client in (self.staff, self.boss):
            self.assertEqual([row['id'] for row in self.rows(direction, client)], [owned['id']])
            # A typed query can narrow the source set, but cannot replace its company scope.
            for query in ({'search': 'Sari'}, {'search': ''}, {'phones': '081234567891'}):
                rows = self.rows(direction, client, **query)
                self.assertLessEqual({row['id'] for row in rows}, {owned['id']})
            self.assertEqual(self.rows(direction, client, public_id=external['public_id']), [])
        self.assertEqual(self.recommend(direction, external), [])
        mixed = self.recommend(direction, owned, external)
        self.assertEqual([group['source']['id'] for group in mixed], [owned['id']])
        self.assertIn(external_target['id'], {row['id'] for row in mixed[0]['recommendations']})
        self.call(self.staff, '/export/pdf', 'POST',
                  {'direction': direction, 'pairs': [{'source_id': external['id'], 'target_id': external_target['id']}]}, status=404)
        pdf = self.call(self.staff, '/export/pdf', 'POST',
                        {'direction': direction, 'pairs': [{'source_id': owned['id'], 'target_id': external_target['id']}]})
        self.assertTrue(pdf.startswith(b'%PDF'))
        plan = self.call(self.staff, '/export/all/plan', 'POST', {'direction': direction})
        self.assertEqual((plan['totals']['sources'], plan['totals']['hot'] + plan['totals']['warm']), (1, 2))
        self.assertEqual(self.call(self.staff, '/export/all/plan', 'POST',
                                  {'direction': direction, 'public_id': external['public_id']})['groups'], [])

    def test_manual_company_sources_cannot_bypass_lock_by_query_id_recommendation_or_export(self):
        self.lock_company()
        self.assert_directional_manual_scope('buyer', self.buyers[OWNED_BUYER], self.buyers[BUYER], self.listings[OTHER])
        self.assert_directional_manual_scope('property', self.listings[KONIG], self.listings[OTHER], self.buyers[BUYER])
        self.call(self.staff, '/buyers/' + self.buyers[BUYER]['id'] + '/recommendations', status=404)
        self.assertEqual(self.call(self.staff, '/buyers/recommendations/batch', 'POST',
                                  {'buyer_ids': [self.buyers[BUYER]['id']]})['groups'], [])
        # Unlocking personal text edits still cannot remove the company ownership rule.
        self.lock_company(locked=False)
        self.call(self.staff, '/search-default/personal', 'PUT', {'terms': ['Sari']})
        self.assertEqual(self.rows('property', search='Sari'), [])
        self.assertEqual(self.rows('property', public_id=self.listings[OTHER]['public_id']), [])
        self.assertEqual(self.recommend('property', self.listings[OTHER]), [])

    def test_manual_sales_sources_use_watchlist_for_both_directions_and_fail_closed_when_empty(self):
        _, _, other_company = self.make_company('OtherWatchlist')
        self.call(other_company, '/stock/tracked', 'PUT', {'phones': ['081234567891']})
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': [PHONE, '081234567892']})
        self.call(self.boss, '/company/settings', 'PUT', {'matching_mode': 'sales'})
        self.lock_company(('absent',))
        self.assert_directional_manual_scope('buyer', self.buyers[OWNED_BUYER], self.buyers[BUYER], self.listings[OTHER])
        self.assert_directional_manual_scope('property', self.listings[KONIG], self.listings[OTHER], self.buyers[BUYER])
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': ['081234567892']})
        self.assertEqual([row['id'] for row in self.rows('buyer')], [self.buyers[OWNED_BUYER]['id']])
        self.assertEqual(self.rows('property'), [])
        self.assertEqual(self.recommend('property', self.listings[KONIG]), [])
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': []})
        for direction, formerly_owned in (('buyer', self.buyers[OWNED_BUYER]), ('property', self.listings[KONIG])):
            self.assertEqual(self.rows(direction), [])
            self.assertEqual(self.recommend(direction, formerly_owned), [])
            self.assertEqual(self.call(self.staff, '/export/all/plan', 'POST', {'direction': direction})['groups'], [])

    def test_dashboard_keyword_changes_invalidate_cached_metrics_and_status_immediately(self):
        self.assert_dashboard(2, 2, 4)  # Prime both the overview and stats cache before setting rules.
        self.call(self.staff, '/entities/status', 'POST', {'ids': [self.listings[OTHER]['public_id']], 'status': 'sold'})
        self.lock_company()
        overview = self.assert_dashboard(1, 1, 3)
        self.assertEqual(overview['status']['listing']['sold'], 0)
        self.assertEqual(overview['status']['listing']['ready'], 1)
        self.assertEqual(sum(row['value'] for row in overview['top_sales']['rows']), 1)
        self.assertEqual(overview['latest_data_date'], '2026-09-03')
        # This is the same URL and the same completed imports: the rule write
        # itself must make all cached aggregates current, without a rebuild.
        self.lock_company(('absent',))
        overview = self.assert_dashboard(0, 0, 0)
        self.assertIsNone(overview['latest_data_date'])
        self.assertEqual(overview['top_sales']['rows'], [])
        self.lock_company(('Sari',))
        overview = self.assert_dashboard(0, 1, 2)
        self.assertEqual(overview['status']['listing']['sold'], 1)
        self.assertEqual(overview['status']['listing']['ready'], 0)
        self.assertEqual(overview['latest_data_date'], '2026-09-04')

    def test_dashboard_mode_and_watchlist_changes_invalidate_cached_metrics_immediately(self):
        self.assert_dashboard(2, 2, 4)
        self.lock_company(('absent',))
        self.assert_dashboard(0, 0, 0)
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': [PHONE, '081234567892']})
        self.call(self.boss, '/company/settings', 'PUT', {'matching_mode': 'sales'})
        overview = self.assert_dashboard(1, 1, 3)
        self.assertEqual(overview['latest_data_date'], '2026-09-03')
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': ['081234567891']})
        overview = self.assert_dashboard(0, 1, 2)
        self.assertEqual(overview['latest_data_date'], '2026-09-04')
        _, _, other_company = self.make_company('OtherDashboardWatchlist')
        self.call(other_company, '/stock/tracked', 'PUT', {'phones': [PHONE, '081234567892']})
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': []})
        overview = self.assert_dashboard(0, 0, 0)
        self.assertIsNone(overview['latest_data_date'])


if __name__ == '__main__':
    unittest.main()
