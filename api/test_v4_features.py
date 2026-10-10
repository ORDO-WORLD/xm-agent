"""Version 4 features over real HTTP + PostgreSQL: IDs, status marks, match history,
keyword lock, listing grouping, stock monitor, company settings and dashboard."""
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from harness import ServerTestCase

WIB = ZoneInfo('Asia/Jakarta')
BUYER_HOUSE = 'Buyer request rumah Surabaya Barat LT 100 Budget 2 M'
BUYER_RUKO = 'Buyer request ruko Rungkut budget max 4 M'
LISTING_HOUSE_A = 'Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Budi 081234567890'
LISTING_HOUSE_B = 'Dijual rumah Surabaya Barat LT 105 Harga 1,9 M\nHubungi: Sari 6282233744657'
LISTING_RUKO = 'Dijual ruko Rungkut LT 60 LB 120 Harga 3,5 M\nInfo lanjut: Andi 081202310022'
SALES_A, SALES_B = '6282233744657', '6281202310022'


class V4Case(ServerTestCase):
    def setUp(self):
        super().setUp()
        self.company, self.user, self.boss = self.make_company('V4')
        self.member, self.staff = self.make_member(self.boss, 'Staff')

    def run_import(self, messages, agent='Caesar'):
        job = self.upload(self.user, messages=messages, agent=agent)
        self.process(job)
        return job

    def rows(self, client=None, direction='buyer', **query):
        from urllib.parse import urlencode
        params = urlencode({'direction': direction, **query})
        return self.call(client or self.staff, f'/workspace?{params}')['rows']

    def recs(self, source_id, direction='buyer', **extra):
        group = self.call(self.staff, '/workspace/recommendations', 'POST', {'direction': direction, 'ids': [source_id], **extra})['groups'][0]
        return group['recommendations']

    def seed(self):
        return self.run_import([
            (BUYER_HOUSE, '~ Rina'), (BUYER_RUKO, '~ Dodi'),
            (LISTING_HOUSE_A, '~ Andi'), (LISTING_HOUSE_B, '~ Andi'), (LISTING_RUKO, '~ Budi'),
        ])

    def card(self, rows, fragment):
        return next(row for row in rows if fragment in row['raw_text'])


class PublicIdTests(V4Case):
    def test_ids_are_per_company_stable_and_searchable(self):
        self.seed()
        buyers = self.rows(direction='buyer')
        listings = self.rows(direction='property')
        self.assertEqual(sorted(r['public_id'] for r in buyers), ['B-AA000', 'B-AA001'])
        self.assertEqual(sorted(r['public_id'] for r in listings), ['L-AA000', 'L-AA001', 'L-AA002'])
        ids = {row['raw_text']: row['public_id'] for row in buyers + listings}
        self.assertEqual(ids[BUYER_HOUSE], 'B-AA000')       # numbered in order of first posting
        self.assertEqual(ids[LISTING_HOUSE_A], 'L-AA000')
        # A settings-driven rebuild keeps every ID.
        from matcher import recompute_matches
        recompute_matches(self.company['company_id'])
        after = {row['raw_text']: row['public_id'] for row in self.rows(direction='buyer') + self.rows(direction='property')}
        self.assertEqual(after, ids)
        # New data continues the sequence; an identical repost is the same entity.
        self.run_import([('Dijual rumah Citraland LT 200 Harga 4 M\nContact: Eko 081355500011', '~ Eko'),
                         (LISTING_HOUSE_A, '~ Someone else')], agent='Second')
        listings = self.rows(direction='property')
        self.assertEqual(sorted(r['public_id'] for r in listings), ['L-AA000', 'L-AA001', 'L-AA002', 'L-AA003'])
        self.assertEqual(self.card(listings, 'Budi')['duplicate_count'], 2)
        self.assertEqual(self.card(listings, 'Budi')['public_id'], 'L-AA000')
        # Another company starts its own numbering.
        _, other_user, _ = self.make_company('Other')
        other_job = self.upload(other_user, messages=[(BUYER_HOUSE, '~ X')])
        self.process(other_job)
        other_rows = self.call(self.admin, '/workspace?direction=buyer', owner=other_user)['rows']
        self.assertEqual(other_rows[0]['public_id'], 'B-AA000')

    def test_search_by_id_is_forgiving(self):
        self.seed()
        for typed in ('l-aa001', 'L AA001', 'laa001', 'AA001'):
            found = self.rows(direction='property', public_id=typed)
            self.assertEqual([r['public_id'] for r in found], ['L-AA001'], typed)
        self.assertEqual(self.rows(direction='buyer', public_id='AA001')[0]['public_id'], 'B-AA001')
        self.assertEqual(self.rows(direction='property', public_id='zzz'), [])
        lookup = self.call(self.staff, '/entities/lookup?q=aa00')
        self.assertTrue({'B-AA000', 'L-AA000'} <= {row['public_id'] for row in lookup})
        self.call(self.staff, '/entities/lookup?q=a', status=400)
        # Never leaks across companies: a company with no data finds nothing.
        _, _, other = self.make_company('Lookup')
        self.assertEqual(self.call(other, '/entities/lookup?q=aa000'), [])

    def test_pdf_shows_the_ids(self):
        self.seed()
        buyer = self.card(self.rows(direction='buyer'), 'rumah')
        target = self.recs(buyer['id'])[0]
        pdf = self.call(self.staff, '/export/pdf', 'POST', {'pairs': [{'source_id': buyer['id'], 'target_id': target['id']}]})
        self.assertTrue(pdf.startswith(b'%PDF'))
        from io import BytesIO
        from pypdf import PdfReader
        text = PdfReader(BytesIO(pdf)).pages[0].extract_text()
        self.assertIn(buyer['public_id'], text)
        self.assertIn(target['public_id'], text)


class StatusTests(V4Case):
    def mark(self, refs, status, client=None, expect=200):
        return self.call(client or self.staff, '/entities/status', 'POST', {'ids': refs, 'status': status}, status=expect)

    def test_sold_on_hold_and_deleted_leave_the_working_lists(self):
        self.seed()
        buyer = self.card(self.rows(direction='buyer'), 'rumah')
        self.assertEqual(len(self.recs(buyer['id'])), 2)
        self.assertEqual(int(buyer['hot_count']) + int(buyer['warm_count']), 2)
        sold = self.card(self.rows(direction='property'), 'Budi')
        result = self.mark([sold['public_id']], 'sold')
        self.assertEqual(result['updated'][0]['previous'], 'ready')
        # Recommendations and the buyer's counters follow immediately.
        self.assertEqual([r['public_id'] for r in self.recs(buyer['id'])], [self.card(self.rows(direction='property'), 'Sari')['public_id']])
        self.assertEqual(len(self.recs(buyer['id'], target_status=['ready', 'sold'])), 2)
        refreshed = self.card(self.rows(direction='buyer'), 'rumah')
        self.assertEqual(int(refreshed['hot_count']) + int(refreshed['warm_count']), 1)
        # The listing is hidden by default but never lost.
        self.assertEqual(len(self.rows(direction='property')), 2)
        self.assertEqual([r['public_id'] for r in self.rows(direction='property', stock_status='sold')], [sold['public_id']])
        self.assertEqual(len(self.rows(direction='property', stock_status='ready,sold')), 3)
        self.assertEqual(self.rows(direction='property', stock_status='sold')[0]['entity_status'], 'sold')
        # Back to ready: counters recover.
        self.mark([sold['public_id']], 'ready')
        self.assertEqual(len(self.recs(buyer['id'])), 2)
        again = self.card(self.rows(direction='buyer'), 'rumah')
        self.assertEqual(int(again['hot_count']) + int(again['warm_count']), 2)
        # Delete is soft and reversible; it also leaves totals.
        self.mark([sold['public_id']], 'deleted')
        self.assertEqual(len(self.rows(direction='property')), 2)
        self.assertEqual(self.call(self.staff, '/stats')['listings'], 2)
        self.assertEqual(self.call(self.staff, '/entities/summary')['listing']['deleted'], 1)
        self.mark([sold['entity_id']], 'ready')          # entity UUIDs work as well as public IDs
        self.assertEqual(self.call(self.staff, '/stats')['listings'], 3)

    def test_status_survives_rebuilds_and_new_imports(self):
        self.seed()
        target = self.card(self.rows(direction='property'), 'Andi')
        self.mark([target['public_id']], 'on_hold')
        from matcher import recompute_matches
        recompute_matches(self.company['company_id'])
        self.run_import([('Dijual rumah Pakuwon LT 150 Harga 3 M\nContact: Joni 081377700022', '~ Joni'), (LISTING_RUKO, '~ Repost')], agent='Later')
        statuses = {r['public_id']: r['entity_status'] for r in self.rows(direction='property', stock_status='ready,on_hold,sold')}
        self.assertEqual(statuses[target['public_id']], 'on_hold')
        self.assertEqual(self.call(self.staff, '/entities/summary')['listing']['on_hold'], 1)

    def test_buyers_can_be_marked_and_the_listing_side_counters_follow(self):
        self.seed()
        buyer = self.card(self.rows(direction='buyer'), 'rumah')
        listing = self.card(self.rows(direction='property'), 'Budi')
        self.assertGreaterEqual(int(listing['hot_count']) + int(listing['warm_count']), 1)
        self.mark([buyer['public_id']], 'sold')
        listing_after = self.card(self.rows(direction='property'), 'Budi')
        self.assertEqual(int(listing_after['hot_count']) + int(listing_after['warm_count']), 0)
        self.assertEqual(self.rows(direction='buyer', stock_status='sold')[0]['public_id'], buyer['public_id'])
        self.assertEqual(self.recs(listing['id'], direction='property'), [])

    def test_bulk_validation_and_audit(self):
        self.seed()
        ids = [r['public_id'] for r in self.rows(direction='property')]
        result = self.mark(ids + ['L-ZZ999'], 'sold')
        self.assertEqual(len(result['updated']), 3)
        self.assertEqual(result['missing'], 1)
        self.assertEqual(self.mark(ids, 'sold')['unchanged'].__len__(), 3)
        self.mark(['L-ZZ999'], 'sold', expect=404)
        self.call(self.staff, '/entities/status', 'POST', {'ids': [], 'status': 'sold'}, status=422)
        self.call(self.staff, '/entities/status', 'POST', {'ids': ['x'] * 201, 'status': 'sold'}, status=422)
        self.call(self.staff, '/entities/status', 'POST', {'ids': ids, 'status': 'archived'}, status=422)
        from db import connect
        with connect() as conn:
            events = conn.execute("SELECT count(*) AS n FROM xm.audit_events WHERE company_id=%s AND event_type='entity_status'",
                                  (self.company['company_id'],)).fetchone()['n']
        self.assertEqual(events, 3)

    def test_bot_endpoints_only_offer_ready_stock_and_carry_ids(self):
        self.seed()
        before = self.call(self.staff, '/agent/matches')['results']
        self.assertEqual(len(before), 3)
        self.assertTrue(all(r['buyer_id'].startswith('B-') and r['listing_id'].startswith('L-') for r in before))
        sold = self.card(self.rows(direction='property'), 'Budi')
        self.mark([sold['public_id']], 'sold')
        after = self.call(self.staff, '/agent/matches')['results']
        self.assertEqual(len(after), 2)
        self.assertNotIn(sold['public_id'], {r['listing_id'] for r in after})
        found = self.call(self.staff, '/agent/search?q=rumah&document_type=property_listing')['results']
        self.assertEqual(len(found), 1)
        self.assertNotIn(sold['public_id'], {r['public_id'] for r in found})

    def test_other_companies_cannot_change_or_see_status(self):
        self.seed()
        target = self.card(self.rows(direction='property'), 'Budi')
        _, _, other = self.make_company('Intruder')
        self.call(other, '/entities/status', 'POST', {'ids': [target['public_id']], 'status': 'deleted'}, status=404)
        self.call(other, '/entities/status', 'POST', {'ids': [target['entity_id']], 'status': 'deleted'}, status=404)
        self.assertEqual(len(self.rows(direction='property')), 3)


class RecentMatchTests(V4Case):
    def today(self):
        return datetime.now(WIB).date().isoformat()

    def months_ago(self, days=100):
        return (datetime.now(WIB).date() - timedelta(days=days)).isoformat()

    def recent(self, **query):
        from urllib.parse import urlencode
        params = {'date_from': self.today(), 'date_to': self.today(), **query}
        return self.call(self.staff, f'/matches/recent?{urlencode(params)}')

    def test_new_pairs_are_logged_once_per_upload_in_both_directions(self):
        self.assertEqual(self.recent()['totals']['pairs'], 0)
        first = self.seed()
        by_buyer = self.recent(direction='buyer')
        self.assertEqual(by_buyer['totals']['pairs'], 3)        # house buyer x 2 listings, ruko buyer x 1
        self.assertEqual(len(by_buyer['groups']), 2)
        house = next(g for g in by_buyer['groups'] if 'rumah' in g['source']['raw_text'])
        self.assertEqual(len(house['matches']), 2)
        self.assertTrue(all(m['import_id'] == first['id'] and m['agent_name'] == 'Caesar' for m in house['matches']))
        self.assertEqual([m['score'] for m in house['matches']], sorted((m['score'] for m in house['matches']), reverse=True))
        by_listing = self.recent(direction='property')
        self.assertEqual(len(by_listing['groups']), 3)
        self.assertEqual(sum(len(g['matches']) for g in by_listing['groups']), 3)
        # A second upload only announces the pairs it created.
        second = self.run_import([('Buyer request rumah Surabaya Barat LT 100 Budget 2,5 M', '~ Wati'),
                                  (LISTING_HOUSE_A, '~ Repost')], agent='Budi Sales')
        after = self.recent(direction='buyer')
        self.assertEqual(after['totals']['pairs'], 5)           # +2 for the new buyer, none re-logged
        newest = after['groups'][0]
        self.assertEqual(newest['matches'][0]['import_id'], second['id'])
        self.assertEqual(sum(1 for g in after['groups'] for m in g['matches'] if m['import_id'] == first['id']), 3)

    def test_settings_rebuilds_never_masquerade_as_new_matches(self):
        self.seed()
        before = self.recent()['totals']['pairs']
        from matcher import recompute_matches
        recompute_matches(self.company['company_id'])
        self.assertEqual(self.recent()['totals']['pairs'], before)
        from db import connect
        with connect() as conn:
            sources = {r['source']: r['n'] for r in conn.execute(
                "SELECT source, count(*) AS n FROM xm.match_events WHERE company_id=%s GROUP BY 1", (self.company['company_id'],)).fetchall()}
        self.assertEqual(sources, {'import': before})

    def test_baseline_pairs_from_before_the_upgrade_are_not_news(self):
        self.seed()
        from db import connect
        company = self.company['company_id']
        with connect() as conn:
            conn.execute("UPDATE xm.match_events SET source='baseline' WHERE company_id=%s", (company,))
            conn.commit()
        self.assertEqual(self.recent()['totals']['pairs'], 0)
        self.run_import([('Buyer request ruko Rungkut budget max 5 M', '~ Lia')])
        self.assertEqual(self.recent()['totals']['pairs'], 1)

    def test_filters_hot_warm_dates_and_availability(self):
        self.seed()
        totals = self.recent()['totals']
        self.assertEqual(totals['hot'] + totals['warm'], totals['pairs'])
        hot_only, warm_only = self.recent(temps='hot'), self.recent(temps='warm')
        self.assertEqual(sum(len(g['matches']) for g in hot_only['groups']), totals['hot'])
        self.assertEqual(sum(len(g['matches']) for g in warm_only['groups']), totals['warm'])
        self.assertEqual(self.recent(temps='')['groups'], [])
        # Yesterday and a far date are empty; a range that includes today is not.
        self.assertEqual(self.recent(date_from='2020-01-01', date_to='2020-01-31')['totals']['pairs'], 0)
        self.assertEqual(self.recent(date_from=self.months_ago(), date_to=self.today())['totals']['pairs'], totals['pairs'])
        self.call(self.staff, '/matches/recent?date_from=2026-02-30', status=400)
        self.call(self.staff, '/matches/recent?date_from=2026-10-02&date_to=2026-10-01', status=400)
        days = self.call(self.staff, f'/matches/recent/days?date_from={self.months_ago()}&date_to={self.today()}')
        self.assertEqual(days['days'][self.today()]['total'], totals['pairs'])
        self.assertEqual(days['latest_date'], self.today())
        # Sold listings drop out unless explicitly requested.
        sold = self.card(self.rows(direction='property'), 'Budi')
        self.call(self.staff, '/entities/status', 'POST', {'ids': [sold['public_id']], 'status': 'sold'})
        self.assertEqual(self.recent()['totals']['pairs'], totals['pairs'] - 1)
        self.assertEqual(self.recent(include_inactive='true')['totals']['pairs'], totals['pairs'])
        self.call(self.staff, '/entities/status', 'POST', {'ids': [sold['public_id']], 'status': 'deleted'})
        self.assertEqual(self.recent(include_inactive='true')['totals']['pairs'], totals['pairs'] - 1)

    def test_unseen_badge_and_latest_upload_summary(self):
        empty = self.call(self.staff, '/matches/recent/summary')
        self.assertEqual((empty['unseen'], empty['last_import']), (0, None))
        job = self.seed()
        summary = self.call(self.staff, '/matches/recent/summary')
        self.assertEqual(summary['unseen'], 3)
        self.assertEqual(summary['last_import']['import_id'], job['id'])
        self.assertEqual(summary['last_import']['total'], 3)
        self.call(self.staff, '/matches/recent/seen', 'POST', status=204)
        self.assertEqual(self.call(self.staff, '/matches/recent/summary')['unseen'], 0)
        # Seen state is personal.
        self.assertEqual(self.call(self.boss, '/matches/recent/summary')['unseen'], 3)
        self.run_import([('Buyer request ruko Rungkut budget max 5 M', '~ Lia')])
        self.assertEqual(self.call(self.staff, '/matches/recent/summary')['unseen'], 1)
        imports = self.call(self.boss, '/imports')
        self.assertEqual(sorted(i['new_matches'] for i in imports), [1, 3])

    def test_history_is_private_to_the_company(self):
        self.seed()
        _, _, other = self.make_company('Other')
        self.assertEqual(self.call(other, f'/matches/recent?date_from={self.months_ago()}&date_to={self.today()}')['totals']['pairs'], 0)


class SearchLockTests(V4Case):
    def test_locked_keywords_cannot_be_bypassed_and_unlocked_members_may_personalise(self):
        self.run_import([('Dijual rumah Alpha Surabaya Barat LT 100 Harga 1,8 M\nContact: A 081234567891', '~ A'),
                         ('Dijual rumah Bravo Surabaya Barat LT 100 Harga 1,7 M\nContact: B 081234567892', '~ B')])
        company = self.call(self.boss, '/search-default', 'PUT', {'terms': ['Alpha'], 'locked': False})
        self.assertTrue(company['can_edit_company'])
        self.assertFalse(company['locked'])
        member = self.call(self.staff, '/search-default')
        self.assertEqual((member['terms'], member['can_edit_personal'], member['can_edit_company']), (['Alpha'], True, False))
        mine = self.call(self.staff, '/search-default/personal', 'PUT', {'terms': ['Bravo']})
        self.assertEqual(mine['terms'], ['Bravo'])
        self.assertEqual(mine['company_terms'], ['Alpha'])
        self.assertEqual(self.call(self.boss, '/search-default')['terms'], ['Alpha'])      # others unaffected
        # Personal phrases narrow the company source set, including when editing is unlocked.
        self.assertEqual(self.rows(direction='property', search='Bravo'), [])
        # Lock: personal list is ignored, server uses the company keywords no matter what is sent.
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['Alpha'], 'locked': True})
        locked = self.call(self.staff, '/search-default')
        self.assertEqual((locked['terms'], locked['locked'], locked['can_edit_personal']), (['Alpha'], True, False))
        found = self.rows(direction='property', search='Bravo')
        self.assertEqual(len(found), 1)
        self.assertIn('Alpha', found[0]['raw_text'])
        self.assertIn('Alpha', self.rows(direction='property', search='')[0]['raw_text'])
        self.call(self.staff, '/search-default/personal', 'PUT', {'terms': ['Bravo']}, status=403)
        # Company admins also use the company scope on matching views.
        boss_rows = self.rows(client=self.boss, direction='property', search='')
        self.assertEqual(len(boss_rows), 1)
        self.assertIn('Alpha', boss_rows[0]['raw_text'])
        # Unlock and reset to the company default.
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['Alpha'], 'locked': False})
        self.assertEqual(self.call(self.staff, '/search-default')['terms'], ['Bravo'])
        reset = self.call(self.staff, '/search-default/personal', 'DELETE')
        self.assertEqual((reset['terms'], reset['personal_terms']), (['Alpha'], None))

    def test_new_company_starts_unfiltered_and_can_return_to_it(self):
        self.run_import([('Dijual rumah Alpha Surabaya Barat LT 100 Harga 1,8 M\nContact: A 081234567891', '~ A'),
                         ('Dijual rumah Bravo Surabaya Barat LT 100 Harga 1,7 M\nContact: B 081234567892', '~ B')])
        self.assertEqual(self.call(self.staff, '/search-default')['terms'], [])
        self.assertEqual(len(self.rows(direction='property')), 2)
        self.call(self.boss, '/search-default', 'PUT', {'terms': ['Alpha']})
        self.assertEqual(self.call(self.staff, '/search-default')['terms'], ['Alpha'])
        self.call(self.boss, '/search-default', 'PUT', {'terms': []}, status=400)
        cleared = self.call(self.boss, '/search-default', 'PUT', {'terms': [], 'clear': True, 'locked': False})
        self.assertEqual((cleared['terms'], cleared['company_terms']), ([], []))
        self.assertEqual(len(self.rows(direction='property')), 2)

    def test_company_admin_edits_the_company_list_only(self):
        self.call(self.boss, '/search-default/personal', 'PUT', {'terms': ['X']}, status=400)
        self.call(self.staff, '/search-default', 'PUT', {'terms': ['X']}, status=403)
        self.call(self.boss, '/search-default', 'PUT', {'terms': []}, status=400)
        settings = self.call(self.boss, '/company/settings')
        self.assertEqual(settings['permissions']['edit_company_search'], True)
        self.assertEqual(self.call(self.staff, '/company/settings')['permissions']['edit_personal_search'], True)


class GroupByTests(V4Case):
    def seed_groups(self):
        return self.run_import([
            ('Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Sari 6282233744657', '~ Andi'),
            ('Dijual rumah Surabaya Barat LT 110 Harga 1,9 M\nContact: Dewi 6281202310022', '~ Andi'),
            ('Dijual rumah Surabaya Barat LT 120 Harga 2,1 M\nContact: Sari 6282233744657', '~ Budi'),
            ('Dijual ruko Rungkut LT 60 Harga 3,5 M', '~ Citra'),
        ])

    def groups(self, group_by, **extra):
        from urllib.parse import urlencode
        return self.call(self.staff, '/workspace/groups?' + urlencode({'group_by': group_by, **extra}))

    def test_group_by_sender_and_by_phone(self):
        self.seed_groups()
        by_sender = self.groups('sender')
        self.assertEqual([(g['key'], g['count']) for g in by_sender['groups']], [('~ Andi', 2), ('~ Budi', 1), ('~ Citra', 1)])
        by_phone = self.groups('phone')
        counts = {g['key']: g['count'] for g in by_phone['groups']}
        self.assertEqual(counts, {'6282233744657': 2, '6281202310022': 1, '': 1})
        self.assertEqual(next(g for g in by_phone['groups'] if g['key'] == '6282233744657')['contact_name'], 'Sari')
        self.assertEqual(next(g for g in by_phone['groups'] if g['key'] == '6282233744657')['sender_count'], 2)
        # Opening a group lists exactly its listings.
        andi = self.rows(direction='property', group_by='sender', group_key='~ Andi')
        self.assertEqual(len(andi), 2)
        none = self.rows(direction='property', group_by='phone', group_key='')
        self.assertEqual([r['contact_phone'] for r in none], [None])
        self.assertEqual(len(self.rows(direction='property', group_by='phone', group_key='6282233744657')), 2)
        self.assertEqual(self.groups('sender', group_search='bud')['groups'][0]['key'], '~ Budi')
        self.assertEqual(self.groups('phone', group_search='sari')['groups'][0]['key'], '6282233744657')

    def test_groups_respect_status_and_validation(self):
        self.seed_groups()
        one = self.rows(direction='property', group_by='sender', group_key='~ Budi')[0]
        self.call(self.staff, '/entities/status', 'POST', {'ids': [one['public_id']], 'status': 'sold'})
        self.assertEqual({g['key'] for g in self.groups('sender')['groups']}, {'~ Andi', '~ Citra'})
        self.assertEqual({g['key'] for g in self.groups('sender', stock_status='sold')['groups']}, {'~ Budi'})
        self.call(self.staff, '/workspace/groups?group_by=nonsense', status=400)
        self.call(self.staff, '/workspace?direction=buyer&group_by=sender&group_key=x', status=400)

    def test_company_default_grouping_is_a_company_setting(self):
        self.assertEqual(self.call(self.staff, '/company/settings')['listing_group_by'], 'sender')
        self.call(self.staff, '/company/settings', 'PUT', {'listing_group_by': 'phone'}, status=403)
        saved = self.call(self.boss, '/company/settings', 'PUT', {'listing_group_by': 'phone', 'company_name': '  Kantor Baru  '})
        self.assertEqual((saved['listing_group_by'], saved['company_name']), ('phone', 'Kantor Baru'))
        self.seed_groups()
        self.assertEqual(self.call(self.staff, '/workspace/groups')['group_by'], 'phone')
        self.call(self.boss, '/company/settings', 'PUT', {'listing_group_by': 'weird'}, status=422)
        self.call(self.boss, '/company/settings', 'PUT', {'company_name': ' '}, status=400)


class StockMonitorTests(V4Case):
    def track(self, value):
        return self.call(self.boss, '/stock/tracked', 'PUT', {'phones': value})

    def test_numbers_are_normalised_deduplicated_and_validated(self):
        saved = self.track('6282233744657, 081202310022\n+62 812-0231-0022 ;')
        self.assertEqual([t['phone'] for t in saved['tracked']], [SALES_A, SALES_B])
        self.assertEqual(self.call(self.staff, '/company/settings')['tracked_phones'], [SALES_A, SALES_B])
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': '12345'}, status=400)
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': ['6282233744657', 'abc']}, status=400)
        self.call(self.boss, '/stock/tracked', 'PUT', {'phones': ','.join(f'62812000{n:05d}' for n in range(51))}, status=400)
        self.call(self.staff, '/stock/tracked', 'PUT', {'phones': SALES_A}, status=403)
        self.assertEqual(self.track('')['tracked'], [])

    def test_counts_and_automatic_log_follow_uploads_and_status_changes(self):
        self.track(f'{SALES_A},{SALES_B}')
        empty = self.call(self.staff, '/stock/overview')
        self.assertEqual(empty['totals']['total'], 0)
        log = self.call(self.staff, '/stock/log')['rows']
        self.assertEqual({r['event_type'] for r in log}, {'tracking'})
        job = self.run_import([
            ('Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Sari 6282233744657', '~ A'),
            ('Dijual rumah Surabaya Barat LT 110 Harga 1,9 M\nContact: Sari 6282233744657', '~ B'),
            ('Dijual ruko Rungkut LT 60 Harga 3,5 M\nContact: Andi 081202310022', '~ C'),
            ('Dijual gudang Sidoarjo LT 500 Harga 5 M\nContact: Lain 081355500011', '~ D'),
        ])
        overview = self.call(self.staff, '/stock/overview')
        counts = {t['phone']: t['counts'] for t in overview['tracked']}
        self.assertEqual((counts[SALES_A]['ready'], counts[SALES_A]['total']), (2, 2))
        self.assertEqual((counts[SALES_B]['ready'], counts[SALES_B]['total']), (1, 1))
        self.assertEqual(overview['totals']['ready'], 3)
        first = next(t for t in overview['tracked'] if t['phone'] == SALES_A)
        self.assertEqual(first['contact_name'], 'Sari')
        log = self.call(self.staff, f'/stock/log?phone={SALES_A}')['rows']
        latest = log[0]
        self.assertEqual((latest['event_type'], latest['import_id'], latest['ready'], latest['delta_ready']), ('import', job['id'], 2, 2))
        # Marking a listing sold logs only the number it belongs to.
        sale = next(r for r in self.rows(direction='property') if 'Andi' in r['raw_text'])
        before = len(self.call(self.staff, '/stock/log')['rows'])
        self.call(self.staff, '/entities/status', 'POST', {'ids': [sale['public_id']], 'status': 'sold'})
        rows = self.call(self.staff, '/stock/log')['rows']
        self.assertEqual(len(rows), before + 1)
        self.assertEqual((rows[0]['phone'], rows[0]['event_type'], rows[0]['ready'], rows[0]['sold'], rows[0]['delta_ready']),
                         (SALES_B, 'status', 0, 1, -1))
        overview = self.call(self.staff, '/stock/overview')
        self.assertEqual(next(t for t in overview['tracked'] if t['phone'] == SALES_B)['counts']['sold'], 1)
        # History is kept for the chart; a manual note-taking snapshot is boss-only.
        self.call(self.staff, '/stock/snapshot', 'POST', status=403)
        self.assertEqual(self.call(self.boss, '/stock/snapshot', 'POST')['logged'], 2)
        self.assertTrue(all(len(t['history']) >= 2 for t in overview['tracked']))

    def test_excel_export_lists_every_listing_per_sales(self):
        import io
        from openpyxl import load_workbook
        self.track(f'{SALES_A},{SALES_B}')
        self.run_import([
            ('Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Sari 6282233744657', '~ A'),
            ('Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Sari 6282233744657', '~ B'),
            ('=Dijual rumah Surabaya Barat LT 110 Harga 1,9 M\nContact: Sari 6282233744657', '~ B'),
            ('Dijual ruko Rungkut LT 60 Harga 3,5 M\nContact: Andi 081202310022', '~ C'),
            ('Dijual gudang Sidoarjo LT 500 Harga 5 M\nContact: Lain 081355500011', '~ D'),
        ])
        sale = next(r for r in self.rows(direction='property') if 'Andi' in r['raw_text'])
        self.call(self.staff, '/entities/status', 'POST', {'ids': [sale['public_id']], 'status': 'sold'})

        def sheet(path):
            rows = list(load_workbook(io.BytesIO(self.call(self.staff, path))).active.iter_rows(values_only=True))
            self.assertEqual(rows[0], ('Nama', 'No telp', 'Tanggal', 'Baca pesan asli'))
            return rows[1:]
        everything = sheet('/stock/export')
        # Identical texts appear once; sold listings stay; untracked numbers are left out.
        self.assertEqual([(r[0], r[1]) for r in everything], [('Sari', '+62 822-3374-4657')] * 2 + [('Andi', '+62 812-0231-0022')])
        self.assertTrue(any(r[3].startswith('=Dijual') for r in everything))
        self.assertTrue(all(r[2] is not None for r in everything))
        personal = sheet(f'/stock/export?phone={SALES_B}')
        self.assertEqual([r[0] for r in personal], ['Andi'])
        self.assertIn('Rungkut', personal[0][3])
        self.call(self.staff, '/stock/export?phone=081355500011', status=404)
        _, _, other = self.make_company('Other')
        self.assertEqual(load_workbook(io.BytesIO(self.call(other, '/stock/export'))).active.max_row, 1)

    def test_stock_is_private_to_the_company(self):
        self.track(SALES_A)
        self.run_import([('Dijual rumah Surabaya Barat LT 100 Harga 1,8 M\nContact: Sari 6282233744657', '~ A')])
        _, _, other = self.make_company('Other')
        self.assertEqual(self.call(other, '/stock/overview')['tracked'], [])
        self.assertEqual(self.call(other, '/stock/log')['rows'], [])


class ExportAllTests(V4Case):
    """Every match of the current filters in one PDF, a section per sender or phone number."""
    def seed(self):
        return self.run_import([(BUYER_HOUSE, '~ Rina'), (BUYER_RUKO, '~ Tono'), (LISTING_HOUSE_A, '~ Andi'), (LISTING_HOUSE_B, '~ Andi'),
                                (LISTING_RUKO, '~ Citra'), ('Dijual gudang Sidoarjo LT 500 Harga 5 M\nContact: Lain 081355500011', '~ Citra')])

    def plan(self, client=None, **filters):
        return self.call(client or self.staff, '/export/all/plan', 'POST', {'direction': 'property', 'statuses': 'hot,warm', **filters})

    def export(self, **filters):
        """Drive the export the way the browser does; returns the plan and the text of every page."""
        import io
        from pypdf import PdfReader
        filters = {'direction': 'property', 'statuses': 'hot,warm', **filters}
        plan, page = self.plan(**filters), 1
        for index, group in enumerate(plan['groups']):
            offset = 0
            while offset is not None:
                done = self.call(self.staff, '/export/all/part', 'POST', {**filters, 'token': plan['token'], 'index': index,
                                                                           'group_key': group['key'], 'offset': offset, 'first_page': page})
                page, offset = page + done['pages'], done['next_offset']
        pdf = self.call(self.staff, f"/export/all/{plan['token']}/download")
        return plan, [item.extract_text() for item in PdfReader(io.BytesIO(pdf)).pages]

    def test_plan_counts_follow_filters_and_company_grouping(self):
        self.seed()
        plan = self.plan()
        self.assertEqual(plan['group_by'], 'sender')
        self.assertEqual({g['key']: g['sources'] for g in plan['groups']}, {'~ Andi': 2, '~ Citra': 1})
        self.assertEqual(plan['totals']['pages'], plan['totals']['hot'] + plan['totals']['warm'])
        self.assertEqual(plan['totals']['unmatched'], 0)
        # "Belum cocok" adds the listing nobody asked for.
        wide = self.plan(statuses='hot,warm,unmatched')
        self.assertEqual((wide['totals']['sources'], wide['totals']['unmatched']), (4, 1))
        self.assertEqual(wide['totals']['pages'], plan['totals']['pages'] + 1)
        # The company's own grouping decides the sections.
        self.call(self.boss, '/company/settings', 'PUT', {'listing_group_by': 'phone'})
        by_phone = self.plan()
        self.assertEqual(by_phone['group_by'], 'phone')
        self.assertEqual({g['key'] for g in by_phone['groups']}, {'6281234567890', SALES_A, SALES_B})
        self.assertIn('Sari · +62 822-3374-4657', [g['title'] for g in by_phone['groups']])
        self.assertEqual(self.plan(phones=SALES_A)['totals']['sources'], 1)
        self.call(self.staff, '/export/all/plan', 'POST', {'statuses': ''}, status=400)

    def test_one_pdf_with_a_section_per_sales(self):
        self.seed()
        plan, pages = self.export(statuses='hot,warm,unmatched')
        self.assertEqual(len(pages), plan['totals']['pages'] + len(plan['groups']))
        covers = [text for text in pages if 'Pengirim' in text]
        self.assertEqual(len(covers), 2)
        self.assertIn('~ Andi', covers[0])
        self.assertIn('2 listing', covers[0])
        self.assertTrue(any('Belum cocok' in text and 'gudang' in text for text in pages))
        self.assertTrue(any('Buyer request rumah' in text and 'Budi' in text for text in pages))
        # Page numbers run through the whole file, and the parts are gone after the download.
        self.assertIn(f'| {len(pages)}', pages[-1])
        self.call(self.staff, f"/export/all/{plan['token']}/download", status=404)

    def test_buyer_direction_and_company_isolation(self):
        self.seed()
        plan, pages = self.export(direction='buyer')
        self.assertEqual({g['key'] for g in plan['groups']}, {'~ Rina', '~ Tono'})
        self.assertEqual(len(pages), plan['totals']['pages'] + 2)
        _, _, other = self.make_company('Other')
        self.assertEqual(self.plan(other)['groups'], [])
        started = self.plan()
        self.call(self.staff, '/export/all/part', 'POST', {'direction': 'property', 'token': started['token'], 'index': 0, 'group_key': '~ Andi'})
        self.call(other, f"/export/all/{started['token']}/download", status=404)
        self.call(self.staff, '/export/all/cancel', 'POST', {'token': started['token']})
        self.call(self.staff, f"/export/all/{started['token']}/download", status=404)


class DashboardTests(V4Case):
    def test_overview_numbers_for_a_period(self):
        self.run_import([
            (BUYER_HOUSE, '~ Rina', '2026-09-02T09:00:00'), (BUYER_HOUSE, '~ Rina 2', '2026-09-03T09:00:00'),
            ('Buyer request ruko Rungkut budget max 4 M', '~ Dodi', '2026-09-03T11:00:00'),
            ('Dicari beli tanah Sidoarjo LT 500 budget 6 M', '~ Eko', '2026-08-20T11:00:00'),
            (LISTING_HOUSE_A, '~ Andi', '2026-09-02T10:00:00'), (LISTING_RUKO, '~ Budi', '2026-09-04T10:00:00'),
        ])
        data = self.call(self.staff, '/dashboard/overview?period=custom&date_from=2026-09-01&date_to=2026-09-30')
        self.assertEqual(data['kpi']['buyers'], 2)                  # identical texts count once
        self.assertEqual(data['kpi']['listings'], 2)
        self.assertEqual(data['kpi']['buyers_prev'], 1)             # previous 30 days contains the August buyer
        self.assertEqual(data['kpi']['buyers_change'], 100.0)
        self.assertEqual(data['period']['bucket'], 'day')
        self.assertEqual(len(data['trend']['labels']), 30)
        self.assertEqual(sum(data['trend']['buyers']), 3)           # per-day unique: Sep 2 once, Sep 3 twice
        self.assertEqual(data['categories'][0]['label'], 'Rumah')
        self.assertEqual({c['key'] for c in data['categories']}, {'house', 'shophouse'})
        self.assertEqual(data['latest_data_date'], '2026-09-04')
        self.assertEqual(sum(data['budget']['sale']), 2)
        self.assertEqual(data['status']['listing']['ready'], 2)
        self.assertTrue(data['insights'])
        self.assertEqual(data['top_sales']['group_by'], 'sender')
        self.assertEqual({r['label'] for r in data['top_sales']['rows']}, {'~ Andi', '~ Budi'})
        # Quick numbers always describe this week and this month, whatever period is open.
        self.assertEqual(set(data['quick']), {'this_week', 'this_month'})
        self.assertEqual(data['matches']['total'], data['kpi']['matches'])
        # Sold stock leaves the supply side; deleted buyers leave the demand side.
        sold = next(r for r in self.rows(direction='property') if 'Budi' in r['raw_text'])
        self.call(self.staff, '/entities/status', 'POST', {'ids': [sold['public_id']], 'status': 'sold'})
        buyer = self.rows(direction='buyer', stock_status='ready')
        ruko = next(r for r in buyer if 'ruko' in r['raw_text'])
        self.call(self.staff, '/entities/status', 'POST', {'ids': [ruko['public_id']], 'status': 'deleted'})
        data = self.call(self.staff, '/dashboard/overview?period=custom&date_from=2026-09-01&date_to=2026-09-30')
        self.assertEqual((data['kpi']['buyers'], data['status']['listing']['sold'], data['status']['listing']['ready']), (1, 1, 1))

    def test_a_finished_upload_shows_up_without_waiting_for_the_cache(self):
        url = '/dashboard/overview?period=custom&date_from=2026-09-01&date_to=2026-09-30'
        self.run_import([(BUYER_HOUSE, '~ Rina', '2026-09-02T09:00:00')])
        self.assertEqual(self.call(self.staff, url)['kpi']['buyers'], 1)
        self.call(self.staff, url)                                  # a repeat read is served from the cache
        self.run_import([('Buyer request ruko Rungkut budget max 4 M', '~ Dodi', '2026-09-03T11:00:00')], agent='Second agent')
        self.assertEqual(self.call(self.staff, url)['kpi']['buyers'], 2)

    def test_every_preset_and_bad_input(self):
        for period in ('week', 'last_week', 'month', 'last_month', 'last30'):
            data = self.call(self.staff, f'/dashboard/overview?period={period}')
            self.assertEqual(data['kpi']['buyers'], 0)
            self.assertEqual(len(data['trend']['labels']), len(data['trend']['buyers']))
        self.call(self.staff, '/dashboard/overview?period=nonsense', status=422)
        self.call(self.staff, '/dashboard/overview?period=custom&date_from=2026-09-05&date_to=2026-09-01', status=400)
        self.call(self.staff, '/dashboard/overview?period=custom&date_from=bad', status=400)
        self.call(self.staff, '/dashboard/overview?period=custom&date_from=2020-01-01&date_to=2026-09-01', status=400)

    def test_dashboard_is_private_to_the_company(self):
        self.run_import([(BUYER_HOUSE, '~ Rina', '2026-09-02T09:00:00')])
        _, _, other = self.make_company('Other')
        data = self.call(other, '/dashboard/overview?period=custom&date_from=2026-09-01&date_to=2026-09-30')
        self.assertEqual((data['kpi']['buyers'], data['latest_data_date']), (0, None))


if __name__ == '__main__':
    unittest.main()
