"""Upload modes enforce company keywords and the company's sales watchlist."""
import unittest
from unittest.mock import patch

from harness import ServerTestCase
from matching_scope import MatchingScope

BUYER = 'Buyer request rumah Surabaya Barat LT 100 Budget 2 M'
KONIG = 'Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Budi KONIG 081234567890'
OTHER = 'Dijual rumah Surabaya Barat LT 105 Harga 1,9 M\nContact: Sari 081234567891'
PHONE = '6281234567890'


class ScopeRulesTests(unittest.TestCase):
    def test_company_keyword_in_signature_is_case_insensitive(self):
        scope = MatchingScope('company', ('konig',))
        self.assertTrue(scope.includes({'raw_text': KONIG, 'normalized_text': 'dijual rumah'}))
        self.assertFalse(scope.includes({'raw_text': OTHER, 'agent_name': 'konig', 'author': 'konig'}))

    def test_company_substrings_or_phrases_and_literal_wildcards(self):
        scope = MatchingScope('company', ('konig', 'property citraland', '100%_sale'))
        for text in ('KonigGroup', 'PROPERTY CITRALAND', 'Promo 100%_sale'):
            self.assertTrue(scope.includes({'raw_text': text}))
        self.assertFalse(scope.includes({'raw_text': '100x-sale'}))

    def test_no_company_keywords_preserves_unfiltered_default(self):
        self.assertTrue(MatchingScope('company').includes({'raw_text': OTHER}))

    def test_sales_uses_primary_and_alternate_contact_numbers(self):
        scope = MatchingScope('sales', phones=frozenset({PHONE}))
        self.assertTrue(scope.includes({'contact_phone': '081234567890'}))
        self.assertTrue(scope.includes({'contact_phone': '081234567891', 'contact_phones': ['+62 812-3456-7890']}))
        self.assertFalse(scope.includes({'contact_phone': '081234567891', 'raw_text': PHONE, 'author': PHONE, 'agent_name': PHONE}))

    def test_only_one_side_must_be_monitored(self):
        scope = MatchingScope('company', ('konig',))
        owned, external = {'raw_text': KONIG}, {'raw_text': BUYER}
        self.assertTrue(scope.allows_pair(external, owned))
        self.assertTrue(scope.allows_pair(owned, external))
        self.assertFalse(scope.allows_pair(external, {'raw_text': OTHER}))


class UploadScopeTests(ServerTestCase):
    def setUp(self):
        super().setUp()
        self.company, self.owner, self.boss = self.make_company('Scope')
        self.member, self.staff = self.make_member(self.boss)

    def recent(self):
        return self.call(self.staff, '/matches/recent?date_from=2026-01-01&date_to=2026-12-31')

    def test_company_upload_checks_locked_keyword_in_signature_and_keeps_external_buyers(self):
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['konig'], 'locked': True})
        job = self.upload(self.owner, texts=[BUYER, KONIG, OTHER], agent='Unrelated uploader', matching_mode='company')
        self.process(job)
        result = self.recent()
        self.assertEqual(result['totals']['pairs'], 1)
        self.assertEqual(result['groups'][0]['matches'][0]['target']['raw_text'], KONIG)
        # A locked keyword is still searchable when it only occurs in the signature.
        found = self.call(self.staff, '/workspace?direction=property&statuses=hot,warm,unmatched&search=Sari')
        self.assertEqual([row['raw_text'] for row in found['rows']], [KONIG])
        imports = self.call(self.boss, '/imports')
        self.assertEqual((imports[0]['new_matches'], imports[0]['matching_mode']), (1, 'company'))

    def test_company_keyword_on_buyer_side_can_match_external_listing(self):
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['konig'], 'locked': True})
        job = self.upload(self.owner, texts=[BUYER + '\nContact: Konig 081234567890', OTHER], matching_mode='company')
        self.process(job)
        self.assertEqual(self.recent()['totals']['pairs'], 1)

    def test_monitored_listing_is_retrieved_without_semantic_hits_or_indexed_location(self):
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['konig'], 'locked': True})
        job = self.upload(self.owner, texts=[
            'Buyer request rumah LT 100 Budget 2 M',
            'Dijual rumah LT 100 Harga 1,8 M\nContact: Budi Konig 081234567890',
            'Dijual rumah LT 105 Harga 1,9 M\nContact: Sari 081234567891'], matching_mode='company')
        self.process(job)  # Harness returns no semantic hits.
        self.assertEqual(self.recent()['totals']['pairs'], 1)

    def test_sales_upload_uses_watchlist_and_alternate_phone_without_keyword(self):
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['absent-company-keyword'], 'locked': True})
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': ['081234567890']})
        alternate = OTHER + ', 081234567890'
        job = self.upload(self.owner, texts=[BUYER, alternate, OTHER], matching_mode='sales')
        self.process(job)
        self.assertEqual(self.recent()['totals']['pairs'], 1)
        self.assertEqual(self.recent()['groups'][0]['matches'][0]['target']['raw_text'], alternate)
        self.assertEqual(self.call(self.boss, '/company/settings')['matching_mode'], 'sales')
        # Later settings-driven matching must use the same sales scope.
        from matcher import recompute_matches
        with patch('matcher.qdrant_query', lambda *a, **kw: []):
            self.assertEqual(recompute_matches(self.company['company_id']), 1)
        found = self.call(self.staff, '/workspace?direction=property&statuses=hot,warm&phones=' + PHONE)
        self.assertEqual([row['raw_text'] for row in found['rows']], [alternate])

    def test_empty_or_other_company_watchlist_and_invalid_mode_are_rejected(self):
        _, _, other = self.make_company('OtherScope')
        self.call(other, '/stock/tracked', 'PUT', {'phones': [PHONE]})
        for mode in ('sales', 'invalid'):
            self.upload(self.owner, matching_mode=mode, status=400)
        self.assertEqual(self.call(self.boss, '/imports'), [])
        self.call(self.boss, '/company/settings', 'PUT', {'matching_mode': 'sales'}, status=400)

    def test_worker_reads_latest_company_rules_before_rebuilding(self):
        job = self.upload(self.owner, texts=[BUYER, KONIG, OTHER], matching_mode='company')
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['Sari'], 'locked': True})
        self.process(job)
        result = self.recent()
        self.assertEqual(result['totals']['pairs'], 1)
        self.assertEqual(result['groups'][0]['matches'][0]['target']['raw_text'], OTHER)

    def test_watchlist_removed_before_processing_fails_without_erasing_matches(self):
        first = self.upload(self.owner, texts=[BUYER, KONIG])
        self.process(first)
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': [PHONE]})
        job = self.upload(self.owner, texts=[OTHER], matching_mode='sales')
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': []})
        with self.assertRaises(Exception):
            self.process(job)
        self.assertEqual(self.recent()['totals']['pairs'], 1)
        failed = next(row for row in self.call(self.boss, '/imports') if row['id'] == job['id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('Watchlist', failed['error'])

    def test_duplicate_upload_switches_mode_without_duplicating_messages(self):
        texts = [BUYER, KONIG, OTHER]
        first = self.upload(self.owner, texts=texts)
        self.process(first)
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': [PHONE]})
        duplicate = self.upload(self.owner, texts=texts, matching_mode='sales')
        self.assertEqual(duplicate['id'], first['id'])
        self.assertTrue(duplicate['recomputing'])
        self.assertEqual(len(self.call(self.boss, '/imports')), 1)
        self.assertEqual(self.call(self.boss, '/company/settings')['matching_mode'], 'sales')
        from worker import process_maintenance
        with patch('reindex.upsert', lambda points: len(points)), patch('reindex._request', lambda *a, **kw: None), patch('matcher.qdrant_query', lambda *a, **kw: []):
            self.assertTrue(process_maintenance())
        self.assertEqual(self.recent()['totals']['pairs'], 1)


if __name__ == '__main__':
    unittest.main()
