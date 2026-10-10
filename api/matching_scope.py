"""Company-owned eligibility for automatic matching, independent of uploader."""
from dataclasses import dataclass

from fastapi import HTTPException

from parser import normalize_phone
from search_terms import normalize_terms, search_filter
from stock import tracked_phones
from tenant import workspace_id


@dataclass(frozen=True)
class MatchingScope:
    mode: str
    terms: tuple[str, ...] = ()
    phones: frozenset[str] = frozenset()

    def includes(self, document):
        if self.mode == 'company':
            # Signatures may contain the company name even though the parser
            # deliberately removes them from normalized matching/embedding text.
            text = '\n'.join(str(document.get(key) or '') for key in
                             ('raw_text', 'normalized_text')).casefold()
            return not self.terms or any(term in text for term in self.terms)
        contacts = list(document.get('contact_phones') or [])
        if document.get('contact_phone'):
            contacts.append(document['contact_phone'])
        return any(normalize_phone(phone) in self.phones for phone in contacts)

    def allows_pair(self, buyer, listing):
        # One side must belong to the monitored company/sales. The other side
        # remains the marketplace, so an external buyer can match company stock.
        return self.includes(buyer) or self.includes(listing)


def load_matching_scope(conn, company_id, mode=None, *, require_sales=True):
    row = conn.execute(
        'SELECT matching_mode, search_terms FROM xm.app_preferences WHERE company_id=%s',
        (company_id,)).fetchone() or {'matching_mode': 'company', 'search_terms': []}
    mode = mode or row['matching_mode']
    if mode not in ('company', 'sales'):
        raise HTTPException(400, 'Mode pencocokan harus company atau sales.')
    if mode == 'sales':
        phones = frozenset(normalize_phone(phone) for phone in tracked_phones(conn, company_id))
        if not phones and require_sales:
            raise HTTPException(400, 'Watchlist nomor sales company kosong. Tambahkan nomor di Stok Sales sebelum memakai mode Sales.')
        return MatchingScope(mode, phones=phones)
    return MatchingScope(mode, terms=tuple(term.casefold() for term in normalize_terms(row['search_terms'])))


def history_scope_filter(conn):
    """Apply current ownership rules to historical events, without rewriting them.

    The two uncorrelated subqueries can be hashed by PostgreSQL: do not scan
    source messages separately for every event in a large import history.
    """
    scope = load_matching_scope(conn, workspace_id(), require_sales=False)
    if scope.mode == 'company':
        # contact_name can fall back to the WhatsApp sender when a signature
        # is absent; the sender is not evidence of company ownership.
        clause, params = search_filter(list(scope.terms), include_contact=False)
        if not clause:
            return '', []
    else:
        if not scope.phones:
            return ' AND false', []
        clause = ' AND (d.contact_phones && %s::text[] OR d.contact_phone=ANY(%s))'
        params = [list(scope.phones), list(scope.phones)]
    monitored = '''SELECT d.entity_id FROM xm.documents d
      JOIN xm.raw_messages r ON r.id=d.raw_message_id
      WHERE d.company_id=current_setting('xm.workspace_id') AND d.active''' + clause
    return f' AND (me.buyer_entity IN ({monitored}) OR me.listing_entity IN ({monitored}))', params * 2
