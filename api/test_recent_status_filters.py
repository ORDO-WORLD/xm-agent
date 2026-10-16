import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
import matchlog


class RecentStatusFiltersTests(unittest.TestCase):
    def test_independent_statuses_and_legacy_toggle(self):
        self.assertEqual(matchlog._filters(False), ['ready'])
        self.assertEqual(matchlog._filters(True), ['ready', 'on_hold', 'sold'])
        self.assertEqual(matchlog._filters(True, 'ready,on_hold'), ['ready', 'on_hold'])
        self.assertEqual(matchlog._filters(True, 'ready,sold'), ['ready', 'sold'])
        self.assertEqual(matchlog._filters(False, 'ready,on_hold,sold'), ['ready', 'on_hold', 'sold'])

    def test_invalid_status_is_rejected(self):
        for value in ('', 'deleted', 'ready,unknown'):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                matchlog._filters(False, value)

    def test_gallery_and_calendar_bind_only_selected_statuses(self):
        for endpoint in ('gallery', 'calendar'):
            for status in ('on_hold', 'sold'):
                with self.subTest(endpoint=endpoint, status=status):
                    conn = MagicMock()
                    conn.execute.return_value.fetchall.return_value = []
                    conn.execute.return_value.fetchone.return_value = {'pairs': 0, 'hot': 0, 'warm': 0, 'day': None}
                    with patch.object(matchlog, 'connect') as connect, patch.object(matchlog, 'history_scope_filter', return_value=('', [])), patch.object(matchlog.activity, 'record_view'):
                        connect.return_value.__enter__.return_value = conn
                        arguments = dict(date_from='2026-10-16', date_to='2026-10-16', stock_status=f'ready,{status}')
                        if endpoint == 'gallery':
                            matchlog.recent_matches(**arguments)
                        else:
                            matchlog.recent_days(**arguments)
                    for call in conn.execute.call_args_list:
                        params = call.args[1]
                        status_lists = [value for value in params if isinstance(value, list)]
                        self.assertEqual(status_lists, [['ready', status], ['ready', status]])


if __name__ == '__main__':
    unittest.main()
