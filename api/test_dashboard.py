"""The Python side of the dashboard: periods, buckets, budget bands, gaps and plain-language insights."""
import unittest
from datetime import date

from fastapi import HTTPException

import dashboard
import runtime_cache
from dashboard import (bucket_series, budget_histogram, change, make_insights, month_bounds, resolve_period,
                       supply_demand)

TODAY = date(2026, 10, 7)          # a Wednesday


class PeriodTests(unittest.TestCase):
    def test_week_runs_monday_to_sunday_and_is_compared_on_elapsed_days(self):
        info = resolve_period('week', today=TODAY)
        self.assertEqual((info['start'], info['end']), (date(2026, 10, 5), date(2026, 10, 11)))
        self.assertEqual(info['effective_end'], TODAY)
        self.assertEqual((info['prev_start'], info['prev_end']), (date(2026, 9, 28), date(2026, 9, 30)))

    def test_last_week_and_months(self):
        info = resolve_period('last_week', today=TODAY)
        self.assertEqual((info['start'], info['end']), (date(2026, 9, 28), date(2026, 10, 4)))
        self.assertEqual((info['prev_start'], info['prev_end']), (date(2026, 9, 21), date(2026, 9, 27)))
        month = resolve_period('month', today=TODAY)
        self.assertEqual((month['start'], month['end']), (date(2026, 10, 1), date(2026, 10, 31)))
        # Seven days into October is compared with the first seven days of September.
        self.assertEqual((month['prev_start'], month['prev_end']), (date(2026, 9, 1), date(2026, 9, 7)))
        last = resolve_period('last_month', today=TODAY)
        self.assertEqual((last['start'], last['end']), (date(2026, 9, 1), date(2026, 9, 30)))
        self.assertEqual((last['prev_start'], last['prev_end']), (date(2026, 8, 1), date(2026, 8, 31)))

    def test_month_on_the_first_day_and_short_previous_month(self):
        info = resolve_period('month', today=date(2026, 3, 31))
        self.assertEqual((info['prev_start'], info['prev_end']), (date(2026, 2, 1), date(2026, 2, 28)))
        self.assertEqual(month_bounds(date(2024, 2, 10)), (date(2024, 2, 1), date(2024, 2, 29)))
        january = resolve_period('last_month', today=date(2026, 1, 15))
        self.assertEqual((january['start'], january['end']), (date(2025, 12, 1), date(2025, 12, 31)))

    def test_last30_and_custom(self):
        info = resolve_period('last30', today=TODAY)
        self.assertEqual((info['start'], info['end'], info['days']), (date(2026, 9, 8), TODAY, 30))
        self.assertEqual(info['prev_end'], date(2026, 9, 7))
        custom = resolve_period('custom', '2026-09-01', '2026-09-10', today=TODAY)
        self.assertEqual((custom['days'], custom['prev_start'], custom['prev_end']), (10, date(2026, 8, 22), date(2026, 8, 31)))
        single = resolve_period('custom', '2026-09-01', None, today=TODAY)
        self.assertEqual((single['start'], single['end']), (date(2026, 9, 1), date(2026, 9, 1)))

    def test_bad_periods_are_rejected(self):
        for args in [('nonsense',), ('custom', 'x', 'y'), ('custom', '2026-09-10', '2026-09-01'), ('custom', '2020-01-01', '2026-09-01')]:
            with self.assertRaises(HTTPException):
                resolve_period(*args, today=TODAY)


class ShapingTests(unittest.TestCase):
    def test_percent_change(self):
        self.assertEqual(change(15, 10), 50.0)
        self.assertEqual(change(5, 10), -50.0)
        self.assertEqual(change(0, 0), None)
        self.assertEqual(change(4, 0), 100.0)
        self.assertEqual(change(0, 4), -100.0)

    def test_daily_series_fills_every_day(self):
        kind, labels, values = bucket_series({date(2026, 9, 2): 3, date(2026, 9, 4): 1}, date(2026, 9, 1), date(2026, 9, 5))
        self.assertEqual((kind, labels, values), ('day', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'], [0, 3, 0, 1, 0]))

    def test_long_ranges_are_grouped_by_week_starting_monday(self):
        daily = {date(2026, 7, 1): 2, date(2026, 7, 2): 3, date(2026, 7, 8): 4}
        kind, labels, values = bucket_series(daily, date(2026, 6, 29), date(2026, 9, 30))
        self.assertEqual(kind, 'week')
        self.assertEqual(labels[0], '2026-06-29')
        self.assertEqual(values[:2], [5, 4])
        self.assertTrue(all(date.fromisoformat(label).weekday() == 0 for label in labels))

    def test_budget_bands_skip_prices_that_are_not_a_whole_property_price(self):
        rows = [
            {'price_max': 450_000_000, 'price_min': None, 'price_basis': None, 'transaction_type': 'sale'},
            {'price_max': 2_000_000_000, 'price_min': None, 'price_basis': 'total', 'transaction_type': 'sale'},
            {'price_max': None, 'price_min': 12_000_000_000, 'price_basis': 'total', 'transaction_type': 'sale'},
            {'price_max': 150_000_000, 'price_min': None, 'price_basis': 'total', 'transaction_type': 'rent'},
            {'price_max': 20_000_000, 'price_min': None, 'price_basis': 'per_m2', 'transaction_type': 'sale'},
            {'price_max': None, 'price_min': None, 'price_basis': None, 'transaction_type': 'sale'},
        ]
        result = budget_histogram(rows)
        self.assertEqual(result['labels'][0], '<500 jt')
        self.assertEqual(result['sale'], [1, 0, 0, 1, 0, 1])
        self.assertEqual(result['rent'], [1, 0, 0, 0, 0, 0])
        self.assertEqual(result['skipped'], 2)

    def test_directions_and_filler_words_are_not_places(self):
        for word in ('timur', 'Sekitar', 'dekat', ' barat ', 'ab', ''):
            self.assertFalse(dashboard.is_place(word), word)
        for word in ('surabaya', 'citraland', 'wbm', 'sby timur'):
            self.assertTrue(dashboard.is_place(word), word)

    def test_pressure_ranks_demand_without_stock_first(self):
        rows = supply_demand({'a': 10, 'b': 6, 'c': 1}, {'a': 10, 'b': 1}, str.upper)
        self.assertEqual([r['key'] for r in rows], ['b', 'a', 'c'])    # ties: larger demand first
        self.assertEqual(rows[0]['pressure'], 6.0)
        self.assertEqual(rows[1]['pressure'], 1.0)
        self.assertEqual([r['key'] for r in supply_demand({'a': 1, 'b': 5}, {}, str.upper, minimum_demand=2)], ['b'])
        self.assertEqual(len(supply_demand({str(i): 2 for i in range(20)}, {}, str, limit=8)), 8)


class InsightTests(unittest.TestCase):
    def context(self, **overrides):
        base = {'period_label': 'Minggu ini', 'kpi': {'buyers': 12, 'buyers_prev': 10},
                'categories': [{'label': 'Rumah', 'value': 6, 'key': 'house'}],
                'gap_locations': [{'label': 'Citraland', 'buyers': 5, 'listings': 1, 'pressure': 5.0}],
                'matches': {'total': 4, 'hot': 1, 'warm': 3}, 'status': {'listing': {'sold': 2}, 'buyer': {}}}
        base.update(overrides)
        return base

    def test_plain_sentences_about_what_changed(self):
        lines = make_insights(self.context())
        self.assertIn('12 demand buyer unik pada minggu ini, naik 20% dibanding periode sebelumnya.', lines[0])
        self.assertTrue(any('Rumah' in line and '50%' in line for line in lines))
        self.assertTrue(any('Citraland' in line and 'stok ready baru 1' in line for line in lines))
        self.assertTrue(any('4 match baru' in line and '1 Hot' in line for line in lines))
        self.assertLessEqual(len(lines), 5)

    def test_empty_period_is_explained_not_hidden(self):
        lines = make_insights(self.context(kpi={'buyers': 0, 'buyers_prev': 0}, categories=[], gap_locations=[],
                                           matches={'total': 0, 'hot': 0, 'warm': 0}, status={'listing': {}, 'buyer': {}}))
        self.assertEqual(lines, ['Belum ada demand buyer pada minggu ini.'])

    def test_a_huge_jump_is_not_printed_as_a_silly_percentage(self):
        lines = make_insights(self.context(kpi={'buyers': 2185, 'buyers_prev': 2}))
        self.assertIn('naik 1092,5 kali lipat', lines[0])
        self.assertNotIn('%', lines[0])

    def test_a_drop_is_reported_as_a_drop(self):
        lines = make_insights(self.context(kpi={'buyers': 5, 'buyers_prev': 10}))
        self.assertIn('turun 50%', lines[0])


class CacheTests(unittest.TestCase):
    def setUp(self):
        runtime_cache.invalidate_stats()

    def test_value_is_reused_briefly_and_never_shared_between_companies(self):
        calls = []

        def loader(tag):
            return lambda: calls.append(tag) or tag
        self.assertEqual(runtime_cache.cached_value('company-a', 'k', 60, loader('a1')), 'a1')
        self.assertEqual(runtime_cache.cached_value('company-a', 'k', 60, loader('a2')), 'a1')
        self.assertEqual(runtime_cache.cached_value('company-b', 'k', 60, loader('b1')), 'b1')
        self.assertEqual(calls, ['a1', 'b1'])

    def test_expiry_and_invalidation(self):
        self.assertEqual(runtime_cache.cached_value('c', 'k', 0, lambda: 1), 1)
        self.assertEqual(runtime_cache.cached_value('c', 'k', 0, lambda: 2), 2)      # ttl 0: always fresh
        runtime_cache.cached_value('c', 'k', 60, lambda: 3)
        runtime_cache.cached_value('other', 'k', 60, lambda: 'keep')
        runtime_cache.invalidate_stats('c')
        self.assertEqual(runtime_cache.cached_value('c', 'k', 60, lambda: 4), 4)
        self.assertEqual(runtime_cache.cached_value('other', 'k', 60, lambda: 'new'), 'keep')

    def test_a_failing_loader_is_not_cached(self):
        with self.assertRaises(HTTPException):
            runtime_cache.cached_value('c', 'bad', 60, lambda: (_ for _ in ()).throw(HTTPException(400, 'x')))
        self.assertEqual(runtime_cache.cached_value('c', 'bad', 60, lambda: 'ok'), 'ok')

    def test_worker_rebuild_refreshes_stats_without_waiting_for_expiry(self):
        self.assertEqual(runtime_cache.cached_stats('company-a', lambda: 'before', version=1), 'before')
        self.assertEqual(runtime_cache.cached_stats('company-a', lambda: 'unused', version=1), 'before')
        self.assertEqual(runtime_cache.cached_stats('company-b', lambda: 'other', version=1), 'other')
        self.assertEqual(runtime_cache.cached_stats('company-a', lambda: 'after', version=2), 'after')
        self.assertEqual(runtime_cache.cached_stats('company-b', lambda: 'unused', version=1), 'other')
        runtime_cache.invalidate_stats('company-a')
        self.assertEqual(runtime_cache.cached_stats('company-a', lambda: 'settings changed', version=2), 'settings changed')


if __name__ == '__main__':
    unittest.main()
