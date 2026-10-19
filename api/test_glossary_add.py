"""Single-entry contributions preserve existing company glossary entries."""
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from workspace import GlossaryEntry, add_glossary


class GlossaryAddTests(unittest.TestCase):
    def connection(self, entries):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = [
            {'alias': alias, 'canonical': canonical} for alias, canonical in entries.items()
        ]
        return conn

    def test_add_normalizes_and_only_inserts_one_entry(self):
        conn = self.connection({'cl': 'citraland'})
        with patch('workspace.connect') as connect:
            connect.return_value.__enter__.return_value = conn
            result = add_glossary(GlossaryEntry(alias=' RGCY ', canonical=' Regency '))
        self.assertEqual(result, {'alias': 'rgcy', 'canonical': 'regency'})
        writes = [(args[0], args[1:]) for args, _ in conn.execute.call_args_list if args[0].startswith('INSERT')]
        self.assertEqual(writes, [('INSERT INTO xm.glossary(alias,canonical) VALUES(%s,%s)', (('rgcy', 'regency'),))])
        self.assertIn("current_setting('xm.workspace_id')", conn.execute.call_args_list[1].args[0])
        self.assertIn('pg_advisory_xact_lock', conn.execute.call_args_list[0].args[0])
        conn.commit.assert_called_once()

    def test_duplicate_and_capacity_do_not_commit(self):
        for entries, alias, code in [({'rgcy': 'regency'}, ' RGCY ', 409),
                                      ({str(i): str(i) for i in range(500)}, 'new', 400)]:
            conn = self.connection(entries)
            with patch('workspace.connect') as connect:
                connect.return_value.__enter__.return_value = conn
                with self.assertRaises(HTTPException) as error:
                    add_glossary(GlossaryEntry(alias=alias, canonical='new meaning'))
            self.assertEqual(error.exception.status_code, code)
            conn.commit.assert_not_called()
            self.assertFalse(any(call.args[0].startswith('INSERT') for call in conn.execute.call_args_list))

    def test_blank_and_oversized_values_rejected(self):
        for alias, canonical in [(' ', 'meaning'), ('word', ' ')]:
            with self.assertRaises(HTTPException):
                add_glossary(GlossaryEntry(alias=alias, canonical=canonical))
        with self.assertRaises(ValidationError):
            GlossaryEntry(alias='x' * 101, canonical='meaning')


from harness import ServerTestCase


class GlossaryContributionTests(ServerTestCase):
    def test_member_add_persists_without_overwriting_or_crossing_companies(self):
        _, _, admin = self.make_company('Glossary A')
        _, member = self.make_member(admin)
        self.call(admin, '/glossary', 'PUT', {'entries': {'cl': 'citraland'}})
        self.call(member, '/glossary', 'POST', {'alias': ' RGCY ', 'canonical': ' Regency '}, status=201)
        self.assertEqual(self.call(member, '/glossary'), {'cl': 'citraland', 'rgcy': 'regency'})
        self.call(member, '/glossary', 'POST', {'alias': 'RGCY', 'canonical': 'overwrite'}, status=409)
        self.call(member, '/glossary', 'PUT', {'entries': {}}, status=403)
        self.call(member, '/glossary', 'DELETE', status=403)
        self.call(member, '/glossary', 'POST', {'alias': ' ', 'canonical': 'blank'}, status=400)
        self.call(member, '/glossary', 'POST', {'alias': 'x' * 101, 'canonical': 'long'}, status=422)
        _, _, other = self.make_company('Glossary B')
        self.assertEqual(self.call(other, '/glossary'), {})
        self.call(other, '/glossary', 'POST', {'alias': 'rgcy', 'canonical': 'other company'}, status=201)
        self.assertEqual(self.call(member, '/glossary')['rgcy'], 'regency')
