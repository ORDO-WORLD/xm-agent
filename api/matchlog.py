"""History of buyer/listing pairs: which matches appeared, and when.

``log_matches`` runs inside the recompute transaction, right after the group
tables are rebuilt. Pairs are identified by their *entities* (unique texts), so
the log survives the full match rebuild that every recompute performs.
"""
import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

import activity
from auth import current_user
from db import connect
from tenant import owner_id

router = APIRouter(prefix='/matches/recent')
WIB = ZoneInfo('Asia/Jakarta')
PAIR_FIELDS = '''g.entity_id, g.public_id, g.status AS entity_status, g.duplicate_count, g.last_seen_at,
  d.id, d.document_type, d.transaction_type, d.categories, d.locations, d.contact_name, d.contact_phone,
  d.land_area_min, d.land_area_max, d.building_area_min, d.building_area_max, d.price_min, d.price_max, d.price_basis,
  d.normalized_text, r.raw_text, r.sent_at, r.author, r.chat_name'''


def log_matches(conn, company_id, source, import_id=None, agent_name=None):
    """Record pairs that were never seen before; refresh the rest; retire pairs that vanished."""
    run = conn.execute('SELECT clock_timestamp() AS now').fetchone()['now']
    rows = conn.execute(
        '''WITH pairs AS (
             SELECT bg.entity_id AS buyer_entity, pg.entity_id AS listing_entity, max(gm.score) AS score
             FROM xm.group_matches gm
             JOIN xm.document_groups bg ON bg.group_id = gm.buyer_group_id
             JOIN xm.document_groups pg ON pg.group_id = gm.property_group_id
             WHERE gm.company_id = %(c)s AND bg.entity_id IS NOT NULL AND pg.entity_id IS NOT NULL
             GROUP BY 1, 2)
           INSERT INTO xm.match_events AS me(company_id, buyer_entity, listing_entity, first_score, last_score,
                  temperature, source, import_id, agent_name, found_at, hot_at, last_seen_at, active)
           SELECT %(c)s, p.buyer_entity, p.listing_entity, p.score, p.score,
                  CASE WHEN p.score >= 80 THEN 'hot' ELSE 'warm' END, %(source)s, %(import)s, %(agent)s,
                  %(run)s, CASE WHEN p.score >= 80 THEN %(run)s END, %(run)s, true
           FROM pairs p
           ON CONFLICT (company_id, buyer_entity, listing_entity) DO UPDATE SET
                  last_score = EXCLUDED.last_score, last_seen_at = EXCLUDED.last_seen_at, active = true,
                  hot_at = COALESCE(me.hot_at, EXCLUDED.hot_at)
           RETURNING (xmax = 0) AS inserted, me.temperature''',
        {'c': company_id, 'source': source, 'import': import_id, 'agent': agent_name, 'run': run}).fetchall()
    retired = conn.execute(
        'UPDATE xm.match_events SET active = false WHERE company_id = %s AND active AND last_seen_at < %s',
        (company_id, run)).rowcount
    created = [row for row in rows if row['inserted']]
    result = {'new': len(created), 'hot': sum(1 for row in created if row['temperature'] == 'hot'),
              'warm': sum(1 for row in created if row['temperature'] == 'warm'),
              'pairs': len(rows), 'retired': retired, 'source': source}
    conn.execute(
        "INSERT INTO xm.audit_events(company_id, event_type, entity_type, entity_id, details) VALUES (%s,'match_log','import',%s,%s::jsonb)",
        (company_id, str(import_id) if import_id else None, json.dumps(result)))
    return result


def wib_bounds(date_from: str, date_to: str):
    """Inclusive Jakarta calendar days -> [start, end) timestamps."""
    try:
        start = date.fromisoformat(date_from)
        end = date.fromisoformat(date_to or date_from)
    except ValueError:
        raise HTTPException(400, 'Tanggal tidak valid.')
    if start > end:
        raise HTTPException(400, 'Tanggal awal tidak boleh melewati tanggal akhir.')
    if (end - start).days > 366:
        raise HTTPException(400, 'Rentang tanggal maksimal 366 hari.')
    return (datetime.combine(start, time.min, WIB), datetime.combine(end + timedelta(days=1), time.min, WIB))


def _filters(include_inactive: bool):
    allowed = ['ready', 'on_hold', 'sold'] if include_inactive else ['ready']
    return allowed


@router.get('')
def recent_matches(direction: Literal['buyer', 'property'] = 'buyer', date_from: str = '', date_to: str = '',
                   temps: str = 'hot,warm', include_inactive: bool = False, limit: int = 30, offset: int = 0,
                   per_source: int = 20):
    """New matches grouped by the buyer (``buyer``) or the listing (``property``) they belong to."""
    today = datetime.now(WIB).date().isoformat()
    start, end = wib_bounds(date_from or today, date_to or date_from or today)
    wanted = {item for item in temps.split(',') if item in {'hot', 'warm'}}
    source_col, target_col = ('buyer_entity', 'listing_entity') if direction == 'buyer' else ('listing_entity', 'buyer_entity')
    allowed = _filters(include_inactive)
    limit = min(max(limit, 1), 100)
    per_source = min(max(per_source, 1), 50)
    base = f'''FROM xm.match_events me
       JOIN xm.entities se ON se.entity_id = me.{source_col} JOIN xm.entities te ON te.entity_id = me.{target_col}
       WHERE me.company_id = current_setting('xm.workspace_id') AND me.source = 'import' AND me.active
         AND me.found_at >= %s AND me.found_at < %s AND se.status = ANY(%s) AND te.status = ANY(%s)'''
    base_params = [start, end, allowed, allowed]
    temp_sql = ''
    if wanted == {'hot'}:
        temp_sql = ' AND me.last_score >= 80'
    elif wanted == {'warm'}:
        temp_sql = ' AND me.last_score < 80'
    elif not wanted:
        temp_sql = ' AND false'
    with connect() as conn:
        totals = conn.execute(
            'SELECT count(*) AS pairs, count(*) FILTER (WHERE me.last_score >= 80) AS hot, '
            'count(*) FILTER (WHERE me.last_score < 80) AS warm ' + base, base_params).fetchone()
        page = conn.execute(
            f'SELECT me.{source_col} AS entity_id, max(me.found_at) AS latest, count(*) AS pairs ' + base + temp_sql +
            f' GROUP BY me.{source_col} ORDER BY max(me.found_at) DESC, me.{source_col} LIMIT %s OFFSET %s',
            base_params + [limit + 1, max(0, offset)]).fetchall()
        has_more = len(page) > limit
        page = page[:limit]
        source_ids = [str(row['entity_id']) for row in page]
        events = conn.execute(
            f'''SELECT me.id AS event_id, me.{source_col} AS source_entity, me.{target_col} AS target_entity, me.found_at, me.hot_at,
                       me.import_id, me.agent_name, me.first_score, me.last_score ''' + base + temp_sql +
            f' AND me.{source_col} = ANY(%s::uuid[]) ORDER BY me.last_score DESC, me.found_at DESC',
            base_params + [source_ids]).fetchall() if source_ids else []
        by_source = {}
        for event in events:
            bucket = by_source.setdefault(str(event['source_entity']), [])
            if len(bucket) < per_source:
                bucket.append(event)
        entity_ids = list(source_ids) + [str(event['target_entity']) for bucket in by_source.values() for event in bucket]
        people = {}
        if entity_ids:
            for row in conn.execute(
                f'''SELECT {PAIR_FIELDS} FROM xm.document_groups g
                    JOIN xm.documents d ON d.id = g.group_id JOIN xm.raw_messages r ON r.id = d.raw_message_id
                    WHERE g.company_id = current_setting('xm.workspace_id') AND g.entity_id = ANY(%s::uuid[])''',
                (list(dict.fromkeys(entity_ids)),)).fetchall():
                people[str(row['entity_id'])] = row
    groups = []
    for row in page:
        key = str(row['entity_id'])
        if key not in people:
            continue
        matches = []
        for event in by_source.get(key, []):
            target = people.get(str(event['target_entity']))
            if not target:
                continue
            score = float(event['last_score'])
            matches.append({'event_id': event['event_id'], 'found_at': event['found_at'], 'score': score,
                            'temperature': 'hot' if score >= 80 else 'warm', 'import_id': event['import_id'],
                            'agent_name': event['agent_name'],
                            'upgraded_to_hot': bool(event['hot_at'] and float(event['first_score']) < 80 and score >= 80),
                            'target': target})
        groups.append({'source': people[key], 'latest_found_at': row['latest'], 'pair_count': row['pairs'], 'matches': matches})
    return {'direction': direction, 'date_from': start.date().isoformat(), 'date_to': (end - timedelta(days=1)).date().isoformat(),
            'totals': totals, 'groups': groups, 'has_more': has_more}


@router.get('/days')
def recent_days(date_from: str, date_to: str, include_inactive: bool = False):
    """Per-day counts for the calendar: how many new matches were found on each Jakarta day."""
    start, end = wib_bounds(date_from, date_to)
    allowed = _filters(include_inactive)
    # Only the Match Terbaru page asks for its calendar.
    activity.record_view('page.open', 'membuka Match Terbaru')
    with connect() as conn:
        rows = conn.execute(
            '''SELECT (me.found_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS total,
                      count(*) FILTER (WHERE me.last_score >= 80) AS hot, count(*) FILTER (WHERE me.last_score < 80) AS warm
               FROM xm.match_events me JOIN xm.entities se ON se.entity_id = me.buyer_entity
               JOIN xm.entities te ON te.entity_id = me.listing_entity
               WHERE me.company_id = current_setting('xm.workspace_id') AND me.source = 'import' AND me.active
                 AND me.found_at >= %s AND me.found_at < %s AND se.status = ANY(%s) AND te.status = ANY(%s)
               GROUP BY 1 ORDER BY 1''', (start, end, allowed, allowed)).fetchall()
        latest = conn.execute(
            '''SELECT max(found_at AT TIME ZONE 'Asia/Jakarta')::date AS day FROM xm.match_events
               WHERE company_id = current_setting('xm.workspace_id') AND source = 'import' AND active''').fetchone()
    return {'days': {str(row['day']): {'total': row['total'], 'hot': row['hot'], 'warm': row['warm']} for row in rows},
            'latest_date': str(latest['day']) if latest and latest['day'] else None}


def _seen_at(conn, user_key):
    row = conn.execute('SELECT preferences FROM xm.user_preferences WHERE user_id = %s', (user_key,)).fetchone()
    value = (row['preferences'] if row else {}).get('recent_seen_at')
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


@router.get('/summary')
def recent_summary(request: Request):
    """Badge for the navigation, plus what the latest upload produced."""
    user = current_user(request)
    user_key = owner_id() or user['id']
    with connect() as conn:
        since = _seen_at(conn, user_key) or (datetime.now(WIB) - timedelta(days=7))
        unseen = conn.execute(
            '''SELECT count(*) AS total, count(*) FILTER (WHERE me.last_score >= 80) AS hot
               FROM xm.match_events me JOIN xm.entities se ON se.entity_id = me.buyer_entity
               JOIN xm.entities te ON te.entity_id = me.listing_entity
               WHERE me.company_id = current_setting('xm.workspace_id') AND me.source = 'import' AND me.active
                 AND me.found_at > %s AND se.status = 'ready' AND te.status = 'ready' ''', (since,)).fetchone()
        last = conn.execute(
            '''SELECT me.import_id, max(me.found_at) AS found_at, count(*) AS total,
                      count(*) FILTER (WHERE me.last_score >= 80) AS hot, count(*) FILTER (WHERE me.last_score < 80) AS warm,
                      i.agent_name, i.file_name
               FROM xm.match_events me JOIN xm.imports i ON i.id = me.import_id
               WHERE me.company_id = current_setting('xm.workspace_id') AND me.source = 'import'
               GROUP BY me.import_id, i.agent_name, i.file_name ORDER BY max(me.found_at) DESC LIMIT 1''').fetchone()
    return {'unseen': unseen['total'], 'unseen_hot': unseen['hot'], 'since': since, 'last_import': last}


@router.post('/seen', status_code=204)
def mark_seen(request: Request):
    user = current_user(request)
    stamp = json.dumps({'recent_seen_at': datetime.now(timezone.utc).isoformat()})
    with connect() as conn:
        conn.execute(
            '''INSERT INTO xm.user_preferences(user_id, preferences) VALUES (%s, %s::jsonb)
               ON CONFLICT (user_id) DO UPDATE SET preferences = xm.user_preferences.preferences || excluded.preferences,
                 updated_at = now()''', (owner_id() or user['id'], stamp))
        conn.commit()
