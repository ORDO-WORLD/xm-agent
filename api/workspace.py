import json
import uuid
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
import activity
from db import connect
from parser import normalize_phone
from reindex import glossary_values
from auth import current_user
from company import company_row, effective_terms, personal_terms
from entities import STATUSES
from tenant import owner_id
from search_terms import normalize_terms, search_filter

router = APIRouter()

class Settings(BaseModel):
    land_tolerance_pct: float = Field(ge=0, le=100)
    building_tolerance_pct: float = Field(ge=0, le=100)
    price_tolerance_pct: float = Field(ge=0, le=100)
    location_weight_pct: float = Field(ge=0, le=100)
    land_weight_pct: float = Field(ge=0, le=100)
    building_weight_pct: float = Field(ge=0, le=100)
    price_weight_pct: float = Field(ge=0, le=100)
    semantic_weight_pct: float = Field(ge=0, le=100)
    data_quality_weight_pct: float = Field(ge=0, le=100)

    def validate_weights(self):
        total = sum((
            self.location_weight_pct,
            self.land_weight_pct,
            self.building_weight_pct,
            self.price_weight_pct,
            self.semantic_weight_pct,
            self.data_quality_weight_pct,
        ))
        if abs(total - 100) > 0.001:
            raise HTTPException(400, "Total bobot pencocokan harus 100%")

class Glossary(BaseModel):
    entries: dict[str, str]


SETTING_LABELS = {
    'land_tolerance_pct': 'toleransi luas tanah', 'building_tolerance_pct': 'toleransi luas bangunan', 'price_tolerance_pct': 'toleransi harga',
    'location_weight_pct': 'bobot lokasi', 'land_weight_pct': 'bobot luas tanah', 'building_weight_pct': 'bobot luas bangunan',
    'price_weight_pct': 'bobot harga', 'semantic_weight_pct': 'bobot kemiripan teks', 'data_quality_weight_pct': 'bobot kelengkapan data',
}


def _pct(value):
    return f'{float(value):g}%'


def _term_changes(before, after):
    added = [item for item in after if item not in before]
    removed = [item for item in before if item not in after]
    parts = ([f'menambah {activity.listed(added)}'] if added else []) + ([f'menghapus {activity.listed(removed)}'] if removed else [])
    return parts, {'ditambah': added, 'dihapus': removed}

@router.put('/settings')
def save_settings(payload: Settings):
    payload.validate_weights()
    with connect() as conn:
        before = conn.execute("SELECT * FROM xm.match_settings WHERE company_id=current_setting('xm.workspace_id') FOR UPDATE").fetchone() or {}
        conn.execute(
            '''UPDATE xm.match_settings SET land_tolerance_pct=%s, building_tolerance_pct=%s,
               price_tolerance_pct=%s, location_weight_pct=%s, land_weight_pct=%s,
               building_weight_pct=%s, price_weight_pct=%s, semantic_weight_pct=%s,
               data_quality_weight_pct=%s, updated_at=now() WHERE company_id=current_setting('xm.workspace_id') ''',
            tuple(payload.model_dump().values()),
        )
        changed = {key: value for key, value in payload.model_dump().items()
                   if before.get(key) is None or abs(float(before[key]) - float(value)) > 0.0001}
        if changed:
            activity.record(conn, 'change', 'match.settings', 'mengubah ' + ', '.join(
                f"{SETTING_LABELS[key]} dari {_pct(before[key]) if before.get(key) is not None else '-'} ke {_pct(value)}"
                for key, value in changed.items()), {
                'sebelum': {SETTING_LABELS[key]: float(before[key]) if before.get(key) is not None else None for key in changed},
                'sesudah': {SETTING_LABELS[key]: value for key, value in changed.items()}})
        conn.commit()
    return payload

@router.get('/glossary')
def get_glossary():
    with connect() as conn:
        return glossary_values(conn)


class Preferences(BaseModel):
    direction: Literal['buyer', 'property'] = 'buyer'
    statuses: list[Literal['hot', 'warm', 'unmatched']] = ['hot', 'warm']


@router.get('/preferences')
def get_preferences(request: Request):
    user = current_user(request)
    with connect() as conn:
        row = conn.execute(
            'SELECT preferences FROM xm.user_preferences WHERE user_id=%s',
            (owner_id() or user['id'],),
        ).fetchone()
    return {**Preferences().model_dump(), **(row['preferences'] if row else {})}


@router.put('/preferences')
def save_preferences(payload: Preferences, request: Request):
    user = current_user(request)
    with connect() as conn:
        conn.execute(
            '''INSERT INTO xm.user_preferences(user_id, preferences) VALUES(%s,%s::jsonb)
               ON CONFLICT(user_id) DO UPDATE SET preferences=xm.user_preferences.preferences || excluded.preferences, updated_at=now()''',
            (owner_id() or user['id'], json.dumps(payload.model_dump())),
        )
        conn.commit()
    return payload

class SearchDefault(BaseModel):
    search: str = Field(default='', max_length=4020)
    terms: list[str] | None = Field(default=None, max_length=20)
    locked: bool | None = None
    # Explicitly use every message (no keyword filter). Never inferred from an empty list.
    clear: bool = False


def search_state(conn, role='admin', user_key=None):
    """Keywords as one person experiences them, plus what they may change."""
    company = company_row(conn)
    mine = personal_terms(conn, user_key) if user_key else None
    terms = effective_terms(role, company, mine)
    return {'search': '\n'.join(terms), 'terms': terms, 'company_terms': list(company['search_terms']),
            'personal_terms': mine, 'locked': company['search_locked'],
            'can_edit_company': role in ('admin', 'company_admin'),
            'can_edit_personal': role == 'user' and not company['search_locked']}


def resolve_search(conn, request, search):
    """A locked company makes every member search with the company keywords, whatever the client sends."""
    if request is None:
        return search
    user = current_user(request)
    if user and user['role'] == 'user':
        company = company_row(conn)
        if company['search_locked']:
            return '\n'.join(company['search_terms'])
    return search


@router.get('/search-default')
def get_search_default(request: Request = None):
    user = current_user(request) if request is not None else None
    if request is not None:
        # The first thing the Pengaturan page loads.
        activity.record_view('page.open', 'membuka Pengaturan')
    with connect() as conn:
        return search_state(conn, user['role'] if user else 'admin', (owner_id() or user['id']) if user else None)


@router.put('/search-default')
def save_search_default(payload: SearchDefault, request: Request = None):
    terms = [] if payload.clear else normalize_terms(payload.terms if payload.terms is not None else payload.search)
    if not terms and not payload.clear:
        raise HTTPException(400, 'Default pencarian wajib diisi.')
    user = current_user(request) if request is not None else None
    with connect() as conn:
        before = company_row(conn)
        if payload.locked is None:
            conn.execute("UPDATE xm.app_preferences SET search_terms=%s,updated_at=now() WHERE company_id=current_setting('xm.workspace_id')", (terms,))
        else:
            conn.execute("UPDATE xm.app_preferences SET search_terms=%s,search_locked=%s,updated_at=now() WHERE company_id=current_setting('xm.workspace_id')",
                         (terms, payload.locked))
        parts, details = _term_changes(list(before['search_terms']), terms)
        if payload.locked is not None and payload.locked != before['search_locked']:
            parts.append('mengunci kata kunci' if payload.locked else 'membuka kunci kata kunci')
            details['dikunci'] = payload.locked
        if parts:
            activity.record(conn, 'change', 'search.company', 'kata kunci company: ' + ', '.join(parts), details)
        conn.commit()
        return search_state(conn, user['role'] if user else 'admin', (owner_id() or user['id']) if user else None)


class PersonalSearch(BaseModel):
    search: str = Field(default='', max_length=4020)
    terms: list[str] | None = Field(default=None, max_length=20)


@router.put('/search-default/personal')
def save_personal_search(payload: PersonalSearch, request: Request):
    user = current_user(request)
    if user['role'] != 'user':
        raise HTTPException(400, 'Super admin mengatur kata kunci company dari pengaturan company.')
    terms = normalize_terms(payload.terms if payload.terms is not None else payload.search)
    if not terms:
        raise HTTPException(400, 'Isi minimal satu kata kunci.')
    with connect() as conn:
        if company_row(conn)['search_locked']:
            raise HTTPException(403, 'Kata kunci dikunci oleh super admin company.')
        key = owner_id() or user['id']
        parts, details = _term_changes(personal_terms(conn, key) or [], terms)
        conn.execute(
            '''INSERT INTO xm.user_preferences(user_id, preferences) VALUES(%s,%s::jsonb)
               ON CONFLICT(user_id) DO UPDATE SET preferences=xm.user_preferences.preferences || excluded.preferences, updated_at=now()''',
            (key, json.dumps({'search_terms': terms})))
        if parts:
            activity.record(conn, 'change', 'search.personal', 'kata kunci pribadi: ' + ', '.join(parts), details)
        conn.commit()
        return search_state(conn, user['role'], key)


@router.delete('/search-default/personal')
def reset_personal_search(request: Request):
    user = current_user(request)
    key = owner_id() or user['id']
    with connect() as conn:
        had = personal_terms(conn, key)
        conn.execute("UPDATE xm.user_preferences SET preferences=preferences - 'search_terms', updated_at=now() WHERE user_id=%s", (key,))
        if had:
            activity.record(conn, 'change', 'search.personal', 'menghapus kata kunci pribadi dan kembali memakai kata kunci company', {'dihapus': had})
        conn.commit()
        return search_state(conn, user['role'], key)


@router.put('/glossary')
def save_glossary(payload: Glossary):
    entries = {k.strip().lower():v.strip().lower() for k,v in payload.entries.items()}
    if len(entries) > 500 or any(not k or not v or len(k)>100 or len(v)>100 for k,v in entries.items()):
        raise HTTPException(400, 'Istilah dan nama baku wajib diisi (maks. 100 karakter, 500 istilah).')
    with connect() as conn:
        before = glossary_values(conn)
        conn.execute("DELETE FROM xm.glossary WHERE company_id=current_setting('xm.workspace_id')")
        for k,v in entries.items():
            conn.execute('INSERT INTO xm.glossary(alias,canonical) VALUES(%s,%s)',(k,v))
        added = {k: v for k, v in entries.items() if k not in before}
        removed = {k: v for k, v in before.items() if k not in entries}
        altered = {k: f'{before[k]} → {v}' for k, v in entries.items() if k in before and before[k] != v}
        parts = [f'{verb} {len(group)} istilah' for verb, group in (('menambah', added), ('menghapus', removed), ('mengubah', altered)) if group]
        if parts:
            activity.record(conn, 'change', 'glossary.save', 'glosarium: ' + ', '.join(parts),
                            {'ditambah': added, 'dihapus': removed, 'diubah': altered})
        conn.commit()
    return entries

@router.post('/index/recompute', status_code=202)
def rebuild_index():
    with connect() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(current_setting('xm.workspace_id'), 9042027))")
        current=conn.execute("SELECT * FROM xm.maintenance_jobs WHERE company_id=current_setting('xm.workspace_id') AND status IN ('queued','processing') LIMIT 1").fetchone()
        if current: return current
        row=conn.execute('INSERT INTO xm.maintenance_jobs(id) VALUES(%s) RETURNING *',(uuid.uuid4(),)).fetchone()
        activity.record(conn, 'change', 'index.recompute', 'meminta proses ulang semua data dan hitung ulang match')
        conn.commit()
        return row

@router.get('/index/status')
def index_status():
    with connect() as conn:
        return conn.execute("SELECT * FROM xm.maintenance_jobs WHERE company_id=current_setting('xm.workspace_id') ORDER BY created_at DESC LIMIT 1").fetchone()

def date_filter(date_from, date_to, time_from='00:00', time_to='23:59'):
    from datetime import date, time, datetime, timedelta
    import re
    if any(not re.fullmatch(r'\d{2}:\d{2}', v) for v in (time_from,time_to)):
        raise HTTPException(400,'Jam tidak valid; gunakan HH:MM.')
    try:
        lower = datetime.combine(date.fromisoformat(date_from),time.fromisoformat(time_from)) if date_from else None
        upper = datetime.combine(date.fromisoformat(date_to),time.fromisoformat(time_to)) if date_to else None
    except ValueError:
        raise HTTPException(400,'Tanggal atau jam tidak valid.')
    if lower and upper and lower > upper:
        raise HTTPException(400,'Awal rentang tidak boleh melewati akhir rentang.')
    clause, params = '', []
    if lower:
        clause += ' AND r.sent_at >= %s'
        params.append(lower)
    if upper:
        clause += ' AND r.sent_at < %s'
        params.append(upper + timedelta(minutes=1))
    return clause, params


@router.get('/workspace/dates')
def workspace_dates(direction: Literal['buyer','property']='buyer', date_from: str='', date_to: str=''):
    from datetime import date
    try:
        start,end=date.fromisoformat(date_from),date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(400,'Tanggal tidak valid.')
    if not 0 < (end-start).days <= 93:
        raise HTTPException(400,'Rentang kalender maksimal 93 hari.')
    kind='buyer_request' if direction=='buyer' else 'property_listing'
    with connect() as conn:
        import workspace_cache
        if workspace_cache.ready(conn):
            latest=conn.execute("SELECT max(last_seen_at)::date latest_date FROM xm.document_groups WHERE company_id=current_setting('xm.workspace_id') AND document_type=%s AND status='ready'",(kind,)).fetchone()
            rows=conn.execute('''SELECT r.sent_at::date posted_day,count(DISTINCT gm.group_id) count
              FROM xm.document_group_members gm JOIN xm.document_groups g ON g.group_id=gm.group_id
              JOIN xm.documents d ON d.id=gm.document_id JOIN xm.raw_messages r ON r.id=d.raw_message_id
              WHERE g.company_id=current_setting('xm.workspace_id') AND g.document_type=%s AND g.status='ready' AND r.sent_at >= %s AND r.sent_at < %s
              GROUP BY r.sent_at::date''',(kind,start,end)).fetchall()
            return {'counts':{str(row['posted_day'])[:10]:int(row['count']) for row in rows},
                    'latest_date':str(latest['latest_date'])[:10] if latest['latest_date'] else None}
        latest=conn.execute("""SELECT max(r.sent_at)::date AS latest_date
          FROM xm.documents d JOIN xm.raw_messages r ON r.id=d.raw_message_id
          WHERE d.company_id=current_setting('xm.workspace_id') AND d.active AND d.document_type=%s""",(kind,)).fetchone()
        rows=conn.execute("""SELECT r.sent_at::date AS posted_day,count(DISTINCT r.raw_text) AS count
          FROM xm.documents d JOIN xm.raw_messages r ON r.id=d.raw_message_id
          WHERE d.company_id=current_setting('xm.workspace_id') AND d.active AND d.document_type=%s
            AND r.sent_at >= %s AND r.sent_at < %s GROUP BY r.sent_at::date""",(kind,start,end)).fetchall()
    return {'counts': {str(row['posted_day'])[:10]:int(row['count']) for row in rows},
            'latest_date': str(latest['latest_date'])[:10] if latest['latest_date'] else None}


def stock_statuses(value):
    """``ready,on_hold`` -> validated tuple; the default view only shows ready items."""
    chosen = [item for item in dict.fromkeys(v.strip() for v in value.split(',')) if item]
    if not chosen or any(item not in STATUSES for item in chosen):
        raise HTTPException(400, 'Status listing/buyer tidak dikenal.')
    return tuple(chosen)


def attach_entities(conn, rows):
    """Rows built without the group cache still need their public ID and status."""
    ids = list({str(r['entity_id']) for r in rows if r.get('entity_id')})
    if ids:
        found = {str(e['entity_id']): e for e in conn.execute('SELECT entity_id, public_id, status FROM xm.entities WHERE entity_id=ANY(%s::uuid[])', (ids,)).fetchall()}
        for r in rows:
            entity = found.get(str(r.get('entity_id')))
            if entity:
                r['public_id'], r['entity_status'] = entity['public_id'], entity['status']
    return rows


@router.get('/workspace')
def workspace(direction: Literal['buyer','property']='buyer', search: str='', phones: str='', statuses: str='hot,warm,unmatched', date_from: str='', date_to: str='', offset: int=0, time_from: str='00:00', time_to: str='23:59', stock_status: str='ready', public_id: str='', group_by: str='', group_key: str | None=None, request: Request = None):
    import workspace_cache
    clause, date_params = date_filter(date_from,date_to,time_from,time_to)
    chosen = stock_statuses(stock_status)
    if group_by and (direction != 'property' or group_by not in ('sender','phone')):
        raise HTTPException(400, 'Pengelompokan hanya untuk listing property: sender atau phone.')
    with connect() as conn:
        search = resolve_search(conn, request, search)
        if request is not None and offset == 0:
            _log_list_view(conn, direction, search, phones, public_id, date_from, date_to, group_key)
        if workspace_cache.ready(conn):
            return workspace_cache.sources(conn,direction,search,phones,statuses,clause,date_params,offset,chosen,public_id,group_by or None,group_key)
    kind, relation = ('buyer_request','buyer_request_id') if direction=='buyer' else ('property_listing','property_listing_id')
    other = 'property_listing_id' if direction == 'buyer' else 'buyer_request_id'
    selected=set(statuses.split(','))
    all_statuses={'hot','warm','unmatched'}.issubset(selected)
    # With every status included, paginate groups before counting their matches.
    # This avoids aggregating the entire match archive just to show 200 cards.
    page_cte = ''
    if all_statuses:
        page_cte = '''), page AS (
          SELECT * FROM ranked WHERE group_rank=1
          ORDER BY sent_at DESC NULLS LAST,id LIMIT 201 OFFSET %s'''
    query = """WITH eligible AS (
       SELECT d.*,r.raw_text,r.chat_name,r.sent_at
       FROM xm.documents d JOIN xm.raw_messages r ON r.id=d.raw_message_id
       WHERE d.company_id=current_setting('xm.workspace_id') AND d.active AND d.document_type=%s"""
    params=[kind]
    search_clause, search_params = search_filter(search)
    query += search_clause
    params += search_params
    if phones.strip() and direction=='property':
        import re
        numbers=[normalize_phone(v) for v in re.split(r'[,;\n]+',phones) if v.strip()]
        if any(not n.startswith('628') or not 10<=len(n)<=15 for n in numbers):
            raise HTTPException(400,'Nomor tidak valid. Pisahkan beberapa nomor dengan koma atau baris baru.')
        # Read all contact numbers in a signature, including second/alternate numbers.
        query += " AND (d.contact_phones && %s::text[] OR d.contact_phone = ANY(%s))"
        params.extend([numbers,numbers])
    clause, date_params = date_filter(date_from,date_to,time_from,time_to)
    query += clause
    params.extend(date_params)
    query += f"""), ranked AS (
       SELECT eligible.*, row_number() OVER(PARTITION BY raw_text ORDER BY sent_at DESC NULLS LAST,id) group_rank,
              count(*) OVER(PARTITION BY raw_text) duplicate_count
       FROM eligible
    {page_cte}
    ), pairs AS (
       SELECT e.raw_text, tr.raw_text target_text, max(m.score) score
       FROM (SELECT DISTINCT raw_text FROM {'page' if all_statuses else 'eligible'}) e
       JOIN xm.raw_messages sr ON sr.company_id=current_setting('xm.workspace_id') AND md5(sr.raw_text)=md5(e.raw_text) AND sr.raw_text=e.raw_text
       JOIN xm.documents source ON source.raw_message_id=sr.id AND source.company_id=current_setting('xm.workspace_id') AND source.active
           AND source.document_type='{kind}'
       JOIN xm.matches m ON m.{relation}=source.id AND m.company_id=current_setting('xm.workspace_id')
       JOIN xm.documents t ON t.id=m.{other} AND t.active AND t.company_id=current_setting('xm.workspace_id')
       JOIN xm.raw_messages tr ON tr.id=t.raw_message_id
       WHERE m.score>=60 GROUP BY e.raw_text,tr.raw_text
    ), counts AS (
       SELECT raw_text,count(*) match_count,count(*) FILTER(WHERE score>=80) hot_count,
              count(*) FILTER(WHERE score<80) warm_count FROM pairs GROUP BY raw_text
    ) SELECT d.*,coalesce(c.match_count,0) match_count,coalesce(c.hot_count,0) hot_count,
             coalesce(c.warm_count,0) warm_count
      FROM {'page' if all_statuses else 'ranked'} d LEFT JOIN counts c USING(raw_text) WHERE group_rank=1 AND ("""
    filters=[]
    if 'hot' in selected: filters.append('coalesce(c.hot_count,0)>0')
    if 'warm' in selected: filters.append('coalesce(c.warm_count,0)>0')
    if 'unmatched' in selected: filters.append('coalesce(c.match_count,0)=0')
    query+=' OR '.join(filters or ['false'])+') ORDER BY d.sent_at DESC NULLS LAST,d.id'
    if not all_statuses:
        query+=' LIMIT 201 OFFSET %s'
    params.append(max(0,offset))
    with connect() as conn:
        rows=attach_entities(conn,conn.execute(query,params).fetchall())
    return {'rows':rows[:200],'has_more':len(rows)>200}


@router.get('/workspace/groups')
def workspace_groups(group_by: str='', search: str='', phones: str='', statuses: str='hot,warm,unmatched', date_from: str='', date_to: str='', time_from: str='00:00', time_to: str='23:59', stock_status: str='ready', public_id: str='', group_search: str='', offset: int=0, request: Request = None):
    """Listings grouped by message sender or by the phone number written in the bubble."""
    import workspace_cache
    clause, date_params = date_filter(date_from,date_to,time_from,time_to)
    chosen = stock_statuses(stock_status)
    with connect() as conn:
        mode = group_by or company_row(conn)['listing_group_by']
        if mode not in ('sender','phone'):
            raise HTTPException(400, 'Pengelompokan tidak dikenal.')
        search = resolve_search(conn, request, search)
        if not workspace_cache.ready(conn):
            return {'group_by': mode, 'groups': [], 'has_more': False}
        return workspace_cache.group_summary(conn,'property',search,phones,statuses,clause,date_params,chosen,public_id,mode,group_search,offset=offset)

def _log_list_view(conn, direction, search, phones, public_id, date_from, date_to, group_key):
    """One line for what a person asked the Cocokkan list to show."""
    way = 'Buyer ke Properti' if direction == 'buyer' else 'Properti ke Buyer'
    span = f', {date_from} s.d. {date_to}' if date_from and date_to else ''
    terms = normalize_terms(search)
    details = {'arah': way, 'kata_kunci': terms, 'nomor': phones or None, 'id': public_id or None,
               'tanggal': [date_from, date_to] if span else None, 'kelompok': group_key}
    if phones.strip():
        activity.record_view('stock.listings', f"melihat listing sales {', '.join(phones.replace(';', ',').split(',')[:3]).strip()}", details)
    elif public_id.strip():
        activity.record_view('match.search', f'mencari ID {public_id.strip()[:40]} di Cocokkan ({way})', details)
    elif group_key is not None:
        activity.record_view('match.detail', f'membuka kelompok {activity.quote(group_key or "tanpa nama")} di Cocokkan ({way}{span})', details)
    elif terms and set(terms) != set(company_row(conn)['search_terms']):
        activity.record_view('match.search', f'mencari {activity.listed(terms)} di Cocokkan ({way}{span})', details)
    else:
        activity.record_view('page.open', f'membuka Cocokkan ({way}{span})', details)


class Batch(BaseModel):
    direction: Literal['buyer','property']='buyer'
    ids: list[uuid.UUID] = Field(max_length=50)
    target_status: list[Literal['ready','on_hold','sold']] = ['ready']

@router.post('/workspace/recommendations')
def open_recommendations(payload: Batch):
    result = recommendations(payload)
    names = [group['source'].get('public_id') for group in result['groups'] if group['source'].get('public_id')]
    kind = 'buyer' if payload.direction == 'buyer' else 'listing'
    if result['groups']:
        activity.record_view('match.detail', f'membuka rekomendasi untuk {names[0]}' if len(names) == 1 and len(result['groups']) == 1
                             else f"membuka rekomendasi untuk {len(result['groups'])} {kind}", {'data': names})
    return result


def recommendations(payload: Batch):
    relation, other, kind = ('buyer_request_id','property_listing_id','buyer_request') if payload.direction=='buyer' else ('property_listing_id','buyer_request_id','property_listing')
    ids=list(dict.fromkeys(payload.ids))
    with connect() as conn:
        import workspace_cache
        if workspace_cache.ready(conn):
            return workspace_cache.recommendations(conn,payload.direction,ids,tuple(payload.target_status) or ('ready',))
        sources=conn.execute('''SELECT d.*,r.raw_text,r.chat_name,r.sent_at FROM xm.documents d JOIN xm.raw_messages r ON r.id=d.raw_message_id WHERE d.company_id=current_setting('xm.workspace_id') AND d.active AND d.id=ANY(%s) AND d.document_type=%s''',(ids,kind)).fetchall()
        # Resolve all copies of a selected source; aggregate before rendering so
        # copies with different historic candidate edges do not lose matches.
        rows=conn.execute(f'''WITH source_copies AS (
          SELECT chosen.id source_id, copy.id copy_id
          FROM xm.documents chosen JOIN xm.raw_messages cr ON cr.id=chosen.raw_message_id
          JOIN xm.raw_messages rr ON md5(rr.raw_text)=md5(cr.raw_text) AND rr.raw_text=cr.raw_text AND rr.company_id=chosen.company_id
          JOIN xm.documents copy ON copy.raw_message_id=rr.id AND copy.active
             AND copy.company_id=chosen.company_id AND copy.document_type=chosen.document_type
          WHERE chosen.company_id=current_setting('xm.workspace_id') AND chosen.active AND chosen.id=ANY(%s) AND chosen.document_type=%s
        ) SELECT m.id match_id,s.source_id,m.score,m.explanation,d.*,r.raw_text,r.chat_name,r.sent_at
          FROM source_copies s JOIN xm.matches m ON m.{relation}=s.copy_id
          JOIN xm.documents d ON d.id=m.{other} JOIN xm.raw_messages r ON r.id=d.raw_message_id
          WHERE m.company_id=current_setting('xm.workspace_id') AND d.company_id=current_setting('xm.workspace_id') AND d.active AND m.score>=60
          ORDER BY m.score DESC,r.sent_at DESC NULLS LAST,d.id''',(ids,kind)).fetchall()
        attach_entities(conn,sources); attach_entities(conn,rows)
    return {'groups':[{'source':s,'recommendations':group_identical([r for r in rows if r['source_id']==s['id']])} for s in sources]}


def group_identical(rows):
    """Full raw text equality only; never merge different contact signatures."""
    groups = {}
    for row in rows:
        key = row['raw_text']
        if key not in groups:
            groups[key] = {**row, 'duplicate_count': 0, '_ids': set(), 'last_seen_at': row.get('sent_at')}
        group = groups[key]
        if row.get('sent_at') and (not group['last_seen_at'] or row['sent_at'] > group['last_seen_at']):
            group['last_seen_at'] = row['sent_at']
        group['_ids'].add(row['id'])
        group['duplicate_count'] = len(group['_ids'])
    return [{k: v for k, v in row.items() if k != '_ids'} for row in groups.values()]


class ExportPair(BaseModel):
    source_id: uuid.UUID
    target_id: uuid.UUID | None=None

class Export(BaseModel):
    direction: Literal['buyer','property']='buyer'
    pairs: list[ExportPair] = Field(min_length=1,max_length=200)

@router.post('/export/pdf')
def export_pdf(payload: Export):
    from report import build_report
    groups=recommendations(Batch(direction=payload.direction,ids=list(dict.fromkeys(p.source_id for p in payload.pairs))))['groups']
    selected=[]
    for p in payload.pairs:
        group=next((g for g in groups if g['source']['id']==p.source_id),None)
        if group is None: raise HTTPException(404,'Data pilihan tidak ditemukan')
        target=next((r for r in group['recommendations'] if r['id']==p.target_id),None)
        if p.target_id and target is None: raise HTTPException(409,'Hasil pencocokan berubah. Muat ulang lalu pilih kembali.')
        if not p.target_id and group['recommendations']: raise HTTPException(409,'Data sudah memiliki kecocokan. Muat ulang hasil.')
        selected.append((group['source'],target))
    pdf=build_report(selected,payload.direction)
    activity.record_now('export', 'export.pdf', f'mengunduh PDF {len(selected)} pasangan dari Cocokkan', {
        'arah': 'Buyer ke Properti' if payload.direction == 'buyer' else 'Properti ke Buyer',
        'data': list(dict.fromkeys(source.get('public_id') for source, _ in selected if source.get('public_id')))})
    return Response(pdf,media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="XM-Matching-Report.pdf"'})
