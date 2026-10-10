"""Company-owned eligibility for automatic matching, independent of uploader."""
from dataclasses import dataclass

from fastapi import HTTPException

from parser import normalize_phone
from search_terms import normalize_terms
from stock import tracked_phones


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
                             ('raw_text', 'normalized_text', 'contact_name')).casefold()
            return not self.terms or any(term in text for term in self.terms)
        contacts = list(document.get('contact_phones') or [])
        if document.get('contact_phone'):
            contacts.append(document['contact_phone'])
        return any(normalize_phone(phone) in self.phones for phone in contacts)

    def allows_pair(self, buyer, listing):
        # One side must belong to the monitored company/sales. The other side
        # remains the marketplace, so an external buyer can match company stock.
        return self.includes(buyer) or self.includes(listing)


def load_matching_scope(conn, company_id, mode=None):
    row = conn.execute(
        'SELECT matching_mode, search_terms FROM xm.app_preferences WHERE company_id=%s',
        (company_id,)).fetchone() or {'matching_mode': 'company', 'search_terms': []}
    mode = mode or row['matching_mode']
    if mode not in ('company', 'sales'):
        raise HTTPException(400, 'Mode pencocokan harus company atau sales.')
    if mode == 'sales':
        phones = frozenset(normalize_phone(phone) for phone in tracked_phones(conn, company_id))
        if not phones:
            raise HTTPException(400, 'Watchlist nomor sales company kosong. Tambahkan nomor di Stok Sales sebelum memakai mode Sales.')
        return MatchingScope(mode, phones=phones)
    return MatchingScope(mode, terms=tuple(term.casefold() for term in normalize_terms(row['search_terms'])))
