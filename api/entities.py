"""Public IDs, the entity registry and listing/buyer status.

An *entity* is one unique complete message text per company and kind - exactly
what a card represents in the UI. Entities keep their public ID (``L-AB908``)
and status (ready / on_hold / sold / deleted) while the matching tables are
rebuilt, because they are keyed by the text hash rather than by row IDs that
change on every recompute.
"""
import json
import re
import uuid

from fastapi import HTTPException

from db import connect

DOCUMENT_TYPES = ('buyer_request', 'property_listing')
PREFIX = {'buyer_request': 'B', 'property_listing': 'L'}
TYPE_BY_PREFIX = {value: key for key, value in PREFIX.items()}
STATUSES = ('ready', 'on_hold', 'sold', 'deleted')
STATUS_LABELS = {'ready': 'Ready', 'on_hold': 'On-hold', 'sold': 'Sold', 'deleted': 'Dihapus'}

# No I or O: they are too easy to confuse with 1 and 0 when read aloud or typed.
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
BASE = len(ALPHABET)
DIGITS = 1000


def _letters(block: int) -> str:
    width, span = 2, BASE ** 2
    while block >= span:
        block -= span
        width += 1
        span *= BASE
    out = []
    for _ in range(width):
        out.append(ALPHABET[block % BASE])
        block //= BASE
    return ''.join(reversed(out))


def encode_public_id(document_type: str, seq: int) -> str:
    """``seq`` 0 -> L-AA000, 999 -> L-AA999, 1000 -> L-AB000, 575999 -> L-ZZ999, 576000 -> L-AAA000."""
    if seq < 0:
        raise ValueError('seq must not be negative')
    return f'{PREFIX[document_type]}-{_letters(seq // DIGITS)}{seq % DIGITS:03d}'


def decode_public_id(value: str):
    """Return ``(document_type, seq)`` for a canonical ID such as ``L-AB908``."""
    match = re.fullmatch(r'([BL])-([A-HJ-NP-Z]{2,})(\d{3})', (value or '').strip().upper())
    if not match:
        return None
    letters = match.group(2)
    offset = sum(BASE ** width for width in range(2, len(letters)))
    number = 0
    for char in letters:
        number = number * BASE + ALPHABET.index(char)
    return TYPE_BY_PREFIX[match.group(1)], (offset + number) * DIGITS + int(match.group(3))


def normalize_id_query(value: str) -> str:
    """Typed IDs are matched without hyphen, spaces or case: ``l ab-908`` -> ``LAB908``."""
    return re.sub(r'[^A-Za-z0-9]', '', value or '').upper()


def exact_public_ids(needle: str) -> list:
    """Every canonical ID a *complete* typed ID can mean, or ``[]`` for partial text.

    The L-/B- prefix is optional (``AB908`` may be a listing or a buyer), and
    ``LAB908`` may be ``L-AB908`` or a three-letter ID. Complete IDs are looked
    up through an index; only partial text needs a slow contains-search.
    """
    found = []
    pattern = r'[A-HJ-NP-Z]{2,}\d{3}'
    if re.fullmatch(pattern, needle):
        found += [f'{prefix}-{needle}' for prefix in PREFIX.values()]
    if needle[:1] in TYPE_BY_PREFIX and re.fullmatch(pattern, needle[1:]):
        found.append(f'{needle[0]}-{needle[1:]}')
    return found


def cache_lock(conn):
    """Serialises writers of the denormalised group tables (refresh, status changes)."""
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(current_setting('xm.workspace_id'), 9042028))")


def assign_entities(conn, company_id: str) -> int:
    """Create missing entities (allocating public IDs in order of first posting) and link documents."""
    created = 0
    for document_type in DOCUMENT_TYPES:
        fresh_sql = '''
          WITH todo AS (
            SELECT md5(r.raw_text) AS text_hash, min(r.sent_at) AS first_sent, min(d.id::text) AS tiebreak
            FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id
            WHERE d.company_id = %(c)s AND d.document_type = %(t)s AND d.entity_id IS NULL AND d.active
            GROUP BY 1
          ), fresh AS (
            SELECT t.* FROM todo t WHERE NOT EXISTS (
              SELECT 1 FROM xm.entities e
              WHERE e.company_id = %(c)s AND e.document_type = %(t)s AND e.text_hash = t.text_hash)
          )'''
        params = {'c': company_id, 't': document_type}
        count = conn.execute(fresh_sql + ' SELECT count(*) AS n FROM fresh', params).fetchone()['n']
        if count:
            base = conn.execute(
                '''INSERT INTO xm.entity_counters(company_id, document_type, next_seq) VALUES (%s, %s, %s)
                   ON CONFLICT (company_id, document_type)
                   DO UPDATE SET next_seq = xm.entity_counters.next_seq + EXCLUDED.next_seq
                   RETURNING next_seq - %s AS base''',
                (company_id, document_type, count, count)).fetchone()['base']
            inserted = conn.execute(
                fresh_sql + ''', numbered AS (
                  SELECT text_hash, first_sent, row_number() OVER (ORDER BY first_sent NULLS LAST, tiebreak) AS rn FROM fresh
                ) INSERT INTO xm.entities(company_id, document_type, text_hash, seq, public_id, first_seen_at)
                  SELECT %(c)s, %(t)s, n.text_hash, %(base)s + n.rn - 1,
                         xm.public_id(%(prefix)s, %(base)s + n.rn - 1), n.first_sent
                  FROM numbered n
                  ON CONFLICT (company_id, document_type, text_hash) DO NOTHING''',
                {**params, 'base': base, 'prefix': PREFIX[document_type]}).rowcount
            created += inserted
    if created > 1000:
        conn.execute('ANALYZE xm.entities')
    # The hash is computed once per document in a CTE so the unique index on
    # (company, kind, text_hash) drives the join; filtering on md5(...) directly
    # degenerates into a nested loop over every pair.
    conn.execute(
        '''WITH h AS MATERIALIZED (
             SELECT d.id AS document_id, d.document_type, md5(r.raw_text) AS text_hash
             FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id
             WHERE d.company_id = %(c)s AND d.entity_id IS NULL AND d.active)
           UPDATE xm.documents d SET entity_id = e.entity_id
           FROM h JOIN xm.entities e ON e.company_id = %(c)s AND e.document_type = h.document_type AND e.text_hash = h.text_hash
           WHERE d.id = h.document_id''', {'c': company_id})
    return created


def recount_groups(conn, company_id: str, entity_ids):
    """Refresh hot/warm counters of every group matched with the given entities.

    Counters only include counterparts whose status is ``ready``; this runs
    when a status changes so the cards update without a full cache rebuild.
    """
    conn.execute(
        '''WITH changed AS (
             SELECT group_id FROM xm.document_groups WHERE company_id = %(c)s AND entity_id = ANY(%(ids)s::uuid[])
           ), affected AS (
             SELECT gm.property_group_id AS group_id FROM xm.group_matches gm JOIN changed c ON c.group_id = gm.buyer_group_id
             WHERE gm.company_id = %(c)s
             UNION
             SELECT gm.buyer_group_id FROM xm.group_matches gm JOIN changed c ON c.group_id = gm.property_group_id
             WHERE gm.company_id = %(c)s
           ), counts AS (
             SELECT a.group_id,
                    count(x.score) FILTER (WHERE x.score >= 80) AS hot,
                    count(x.score) FILTER (WHERE x.score < 80) AS warm
             FROM affected a LEFT JOIN LATERAL (
               SELECT gm.score FROM xm.group_matches gm
                 JOIN xm.document_groups o ON o.group_id = gm.property_group_id AND o.status = 'ready'
               WHERE gm.buyer_group_id = a.group_id
               UNION ALL
               SELECT gm.score FROM xm.group_matches gm
                 JOIN xm.document_groups o ON o.group_id = gm.buyer_group_id AND o.status = 'ready'
               WHERE gm.property_group_id = a.group_id
             ) x ON true
             GROUP BY a.group_id
           )
           UPDATE xm.document_groups g SET hot_count = counts.hot, warm_count = counts.warm
           FROM counts WHERE g.group_id = counts.group_id''',
        {'c': company_id, 'ids': [str(item) for item in entity_ids]})


def resolve_refs(conn, company_id: str, refs):
    """Entity rows (locked) for a mix of entity UUIDs and public IDs of this company."""
    uuids, publics = [], []
    for ref in refs:
        text = str(ref).strip()
        if not text:
            continue
        try:
            uuids.append(str(uuid.UUID(text)))
        except ValueError:
            publics.append(text.upper())
    if not uuids and not publics:
        return []
    return conn.execute(
        '''SELECT entity_id, document_type, public_id, status FROM xm.entities
           WHERE company_id = %s AND (entity_id = ANY(%s::uuid[]) OR public_id = ANY(%s))
           ORDER BY seq FOR UPDATE''', (company_id, uuids, publics)).fetchall()


def set_entity_status(conn, company_id: str, user_id, refs, status: str, note: str | None = None):
    """Mark buyers/listings ready, on_hold, sold or deleted. Soft state: always reversible."""
    if status not in STATUSES:
        raise HTTPException(400, 'Status tidak dikenal.')
    refs = list(dict.fromkeys(str(item) for item in refs))
    if not refs:
        raise HTTPException(400, 'Pilih minimal satu ID.')
    if len(refs) > 200:
        raise HTTPException(400, 'Maksimal 200 ID dalam satu perubahan status.')
    cache_lock(conn)
    rows = resolve_refs(conn, company_id, refs)
    if not rows:
        raise HTTPException(404, 'ID tidak ditemukan.')
    changing = [row for row in rows if row['status'] != status]
    if changing:
        ids = [str(row['entity_id']) for row in changing]
        conn.execute(
            '''UPDATE xm.entities SET status = %s, status_note = %s, status_changed_at = now(), status_changed_by = %s
               WHERE company_id = %s AND entity_id = ANY(%s::uuid[])''',
            (status, (note or '').strip()[:300] or None, user_id, company_id, ids))
        conn.execute('UPDATE xm.document_groups SET status = %s WHERE company_id = %s AND entity_id = ANY(%s::uuid[])',
                     (status, company_id, ids))
        recount_groups(conn, company_id, ids)
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO xm.audit_events(company_id, event_type, entity_type, entity_id, details) VALUES (%s,'entity_status',%s,%s,%s::jsonb)",
                [(company_id, row['document_type'], row['public_id'],
                  json.dumps({'from': row['status'], 'to': status, 'by': str(user_id), 'note': note or None}))
                 for row in changing])
        listing_ids = [str(row['entity_id']) for row in changing if row['document_type'] == 'property_listing']
        if listing_ids:
            import stock
            stock.snapshot_for_entities(conn, company_id, listing_ids)
    return {
        'status': status,
        'updated': [{'entity_id': row['entity_id'], 'public_id': row['public_id'], 'document_type': row['document_type'],
                     'previous': row['status']} for row in changing],
        'unchanged': [row['public_id'] for row in rows if row['status'] == status],
        'missing': max(0, len(refs) - len(rows)),
    }


def lookup(conn, company_id: str, query: str, limit: int = 8):
    """Resolve a typed ID (partial allowed) to entities with a short preview."""
    needle = normalize_id_query(query)
    if len(needle) < 2:
        return []
    exact = exact_public_ids(needle)
    match_sql, match_arg = ('e.public_id = ANY(%s)', exact) if exact else ("replace(e.public_id, '-', '') LIKE %s", '%' + needle + '%')
    return conn.execute(
        f'''SELECT e.entity_id, e.public_id, e.document_type, e.status, d.contact_name, d.categories, d.locations
           FROM xm.entities e
           LEFT JOIN xm.document_groups g ON g.entity_id = e.entity_id
           LEFT JOIN xm.documents d ON d.id = g.group_id
           WHERE e.company_id = %s AND {match_sql}
           ORDER BY e.seq DESC LIMIT %s''',
        (company_id, match_arg, min(max(limit, 1), 20))).fetchall()


def sync_groups_from_entities(conn, company_id: str) -> int:
    """Fill entity columns of already-built group rows (used once, when upgrading)."""
    return conn.execute(
        '''UPDATE xm.document_groups g SET entity_id = d.entity_id, public_id = e.public_id, status = e.status
           FROM xm.documents d JOIN xm.entities e ON e.entity_id = d.entity_id
           WHERE g.company_id = %s AND g.entity_id IS NULL AND d.id = g.group_id''', (company_id,)).rowcount


def _migrate_company(conn, company_id: str):
    conn.execute(
        '''INSERT INTO xm.app_preferences(company_id, company_name) VALUES (%s, NULL) ON CONFLICT (company_id) DO NOTHING''',
        (company_id,))
    conn.execute(
        '''UPDATE xm.app_preferences ap SET company_name = coalesce(
              (SELECT CASE WHEN ap.company_id = 'xm' THEN 'Property' ELSE u.display_name END
               FROM xm.users u WHERE u.workspace_id = ap.company_id ORDER BY u.created_at LIMIT 1),
              ap.company_id)
           WHERE ap.company_id = %s AND ap.company_name IS NULL''', (company_id,))
    assign_entities(conn, company_id)
    sync_groups_from_entities(conn, company_id)
    # Pairs that exist at upgrade time are history, not news.
    conn.execute(
        '''INSERT INTO xm.match_events(company_id, buyer_entity, listing_entity, first_score, last_score, temperature,
                                       source, found_at, last_seen_at)
           SELECT %(c)s, bg.entity_id, pg.entity_id, max(gm.score), max(gm.score),
                  CASE WHEN max(gm.score) >= 80 THEN 'hot' ELSE 'warm' END, 'baseline', now(), now()
           FROM xm.group_matches gm
           JOIN xm.document_groups bg ON bg.group_id = gm.buyer_group_id
           JOIN xm.document_groups pg ON pg.group_id = gm.property_group_id
           WHERE gm.company_id = %(c)s AND bg.entity_id IS NOT NULL AND pg.entity_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM xm.match_events WHERE company_id = %(c)s)
           GROUP BY bg.entity_id, pg.entity_id
           ON CONFLICT (company_id, buyer_entity, listing_entity) DO NOTHING''', {'c': company_id})


def migrate_v4():
    """One-time, restartable backfill after upgrading from v3: IDs, group links, match baseline."""
    with connect() as conn:
        # Serialises API and worker when both start together after an upgrade.
        conn.execute('SELECT pg_advisory_xact_lock(9042099)')
        companies = conn.execute(
            '''SELECT company_id FROM (SELECT DISTINCT company_id FROM xm.documents
               UNION SELECT workspace_id FROM xm.users WHERE workspace_id IS NOT NULL) c
               WHERE company_id IS NOT NULL ORDER BY 1''').fetchall()
        for row in companies:
            _migrate_company(conn, row['company_id'])
        conn.commit()
    return len(companies)
