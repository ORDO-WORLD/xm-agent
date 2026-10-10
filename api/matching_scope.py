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


def document_scope_filter(conn):
    """Mandatory company ownership filter for document/raw-message aliases d/r."""
    scope = load_matching_scope(conn, workspace_id(), require_sales=False)
    if scope.mode == 'company':
        # contact_name can fall back to the WhatsApp sender when a signature
        # is absent; the sender is not evidence of company ownership.
        clause, params = search_filter(list(scope.terms), include_contact=False)
    else:
        if not scope.phones:
            return ' AND false', []
        clause = ' AND (d.contact_phones && %s::text[] OR d.contact_phone=ANY(%s))'
        params = [list(scope.phones), list(scope.phones)]
    return clause, params


def history_scope_filter(conn, direction=None):
    """Filter the chosen source by current rules; aggregate views accept either side.

    Events are undirected history. A company listing can match an external buyer,
    but that buyer must never become a source in the company buyer gallery.
    Uncorrelated subqueries let PostgreSQL hash the monitored entities once.
    """
    clause, params = document_scope_filter(conn)
    if not clause or clause == ' AND false':
        return clause, params
    monitored = '''SELECT d.entity_id FROM xm.documents d
      JOIN xm.raw_messages r ON r.id=d.raw_message_id
      WHERE d.company_id=current_setting('xm.workspace_id') AND d.active''' + clause
    if direction is not None:
        source = {'buyer': 'buyer_entity', 'property': 'listing_entity'}[direction]
        return f' AND me.{source} IN ({monitored})', params
    return f' AND (me.buyer_entity IN ({monitored}) OR me.listing_entity IN ({monitored}))', params * 2


def queue_scope_recompute(conn):
    """Refresh cached pairs after ownership changes in the same settings transaction.

    A processing job may already have read the previous rules. Flag it for one
    successor after completion, preserving the single active job per company.
    """
    import uuid

    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(current_setting('xm.workspace_id'), 9042027))")
    scope = load_matching_scope(conn, workspace_id(), require_sales=False)
    if scope.mode == 'sales' and not scope.phones:
        return None
    if not conn.execute("SELECT 1 FROM xm.documents WHERE company_id=current_setting('xm.workspace_id') AND active LIMIT 1").fetchone():
        return None
    active = conn.execute("SELECT * FROM xm.maintenance_jobs WHERE company_id=current_setting('xm.workspace_id') AND status IN ('queued','processing') ORDER BY created_at LIMIT 1 FOR UPDATE").fetchone()
    if active:
        if active['status'] == 'processing':
            return conn.execute("""UPDATE xm.maintenance_jobs
              SET result=coalesce(result,'{}'::jsonb) || '{"scope_changed":true}'::jsonb
              WHERE id=%s RETURNING *""", (active['id'],)).fetchone()
        return active
    return conn.execute('INSERT INTO xm.maintenance_jobs(id) VALUES(%s) RETURNING *', (uuid.uuid4(),)).fetchone()
