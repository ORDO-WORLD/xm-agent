"""Dashboard statistics.

SQL only gathers compact aggregates (distinct unique texts, so identical posts
count once). Everything a person reads - periods, buckets, budget ranges,
supply/demand gaps and the plain-language insights - is shaped here in Python.
"""
import calendar
from collections import Counter
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from db import connect
from runtime_cache import cached_value
from tenant import workspace_id
from matching_scope import history_scope_filter

router = APIRouter(prefix='/dashboard')
WIB = ZoneInfo('Asia/Jakarta')

CATEGORY_LABELS = {
    'house': 'Rumah', 'warehouse': 'Gudang', 'apartment': 'Apartemen', 'shophouse': 'Ruko', 'land': 'Tanah',
    'factory': 'Pabrik', 'office': 'Kantor', 'villa': 'Villa', 'commercial_building': 'Gedung komersial',
    'hotel': 'Hotel', 'unknown': 'Belum terbaca',
}
TRANSACTION_LABELS = {'sale': 'Beli', 'rent': 'Sewa', 'unknown': 'Belum jelas'}
STATUS_LABELS = {'ready': 'Ready', 'on_hold': 'On-hold', 'sold': 'Sold', 'deleted': 'Dihapus'}
# Budget bands in rupiah; the last band is open ended.
BUDGET_BANDS = [
    (0, 500_000_000, '<500 jt'), (500_000_000, 1_000_000_000, '500 jt–1 M'), (1_000_000_000, 2_000_000_000, '1–2 M'),
    (2_000_000_000, 5_000_000_000, '2–5 M'), (5_000_000_000, 10_000_000_000, '5–10 M'), (10_000_000_000, None, '>10 M'),
]
# Words the parser can pick up from a "lokasi:" line that are directions or filler, not places a buyer can be matched to.
GENERIC_LOCATIONS = {
    'sekitar', 'sekitarnya', 'timur', 'barat', 'utara', 'selatan', 'pusat', 'tengah', 'area', 'daerah', 'kota', 'lokasi',
    'bebas', 'mana', 'saja', 'dekat', 'raya', 'jalan', 'jl', 'jln', 'strategis', 'premium', 'prime', 'dll', 'dsb',
}


def is_place(name: str) -> bool:
    name = name.strip().lower()
    return len(name) >= 3 and name not in GENERIC_LOCATIONS
PERIODS = ('week', 'last_week', 'month', 'last_month', 'last30', 'custom')
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']


def pretty_day(day: date) -> str:
    return f'{day.day} {MONTHS[day.month - 1]} {day.year}'


def month_bounds(day: date):
    return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])


def resolve_period(period: str, date_from: str | None = None, date_to: str | None = None, today: date | None = None):
    """Inclusive Jakarta dates for a period, plus the equally long period it is compared with."""
    today = today or datetime.now(WIB).date()
    monday = today - timedelta(days=today.weekday())
    if period == 'week':
        start, end = monday, monday + timedelta(days=6)
    elif period == 'last_week':
        start, end = monday - timedelta(days=7), monday - timedelta(days=1)
    elif period == 'month':
        start, end = month_bounds(today)
    elif period == 'last_month':
        start, end = month_bounds(today.replace(day=1) - timedelta(days=1))
    elif period == 'last30':
        start, end = today - timedelta(days=29), today
    elif period == 'custom':
        try:
            start, end = date.fromisoformat(date_from or ''), date.fromisoformat(date_to or date_from or '')
        except ValueError:
            raise HTTPException(400, 'Tanggal tidak valid.')
        if start > end:
            raise HTTPException(400, 'Tanggal awal tidak boleh melewati tanggal akhir.')
        if (end - start).days > 731:
            raise HTTPException(400, 'Rentang tanggal maksimal 2 tahun.')
    else:
        raise HTTPException(400, 'Periode tidak dikenal.')
    # A running period is compared on the same elapsed days, never against a full previous one.
    effective_end = min(end, today) if start <= today else end
    length = (effective_end - start).days + 1
    if period == 'month':
        prev_start = month_bounds(start - timedelta(days=1))[0]
        prev_end = min(prev_start + timedelta(days=length - 1), month_bounds(prev_start)[1])
    elif period == 'last_month':
        prev_start, prev_end = month_bounds(start - timedelta(days=1))
    elif period == 'week':
        prev_start = start - timedelta(days=7)
        prev_end = prev_start + timedelta(days=length - 1)
    else:
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=(end - start).days)
    return {'period': period, 'start': start, 'end': end, 'effective_end': effective_end,
            'prev_start': prev_start, 'prev_end': prev_end, 'days': (end - start).days + 1}


def bounds(start: date, end: date):
    """Inclusive dates -> naive [start, end) (the chat timestamps are stored in Jakarta time)."""
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def change(current: int, previous: int):
    """Percent change, or None when there is no earlier base to compare with."""
    if not previous:
        return None if not current else 100.0
    return round((current - previous) / previous * 100, 1)


def bucket_series(daily: dict, start: date, end: date):
    """Daily counts, or weekly (Monday) counts when the range is long enough to be unreadable per day."""
    span = (end - start).days + 1
    if span <= 62:
        days = [start + timedelta(days=i) for i in range(span)]
        return 'day', [d.isoformat() for d in days], [daily.get(d, 0) for d in days]
    weeks, labels = Counter(), []
    cursor = start - timedelta(days=start.weekday())
    while cursor <= end:
        labels.append(cursor)
        cursor += timedelta(days=7)
    for day, value in daily.items():
        weeks[day - timedelta(days=day.weekday())] += value
    return 'week', [d.isoformat() for d in labels], [weeks.get(d, 0) for d in labels]


def budget_histogram(rows):
    """Count buyers per budget band. Only whole-property prices; per-m² or per-year amounts are skipped."""
    sale, rent, skipped = Counter(), Counter(), 0
    for row in rows:
        amount = row['price_max'] or row['price_min']
        if not amount or row['price_basis'] not in (None, 'total'):
            skipped += 1
            continue
        target = rent if row['transaction_type'] == 'rent' else sale
        for index, (low, high, _) in enumerate(BUDGET_BANDS):
            if amount >= low and (high is None or amount < high):
                target[index] += 1
                break
    labels = [label for _, _, label in BUDGET_BANDS]
    return {'labels': labels, 'sale': [sale.get(i, 0) for i in range(len(labels))],
            'rent': [rent.get(i, 0) for i in range(len(labels))], 'skipped': skipped}


def supply_demand(demand: dict, supply: dict, labeler, minimum_demand: int = 1, limit: int = 8):
    """Where buyers ask more than the ready stock can answer, most pressing first."""
    rows = []
    for key, buyers in demand.items():
        if buyers < minimum_demand:
            continue
        stock = supply.get(key, 0)
        rows.append({'key': key, 'label': labeler(key), 'buyers': buyers, 'listings': stock,
                     'pressure': round(buyers / max(stock, 1), 2)})
    rows.sort(key=lambda row: (-row['pressure'], -row['buyers'], row['label']))
    return rows[:limit]


def make_insights(ctx):
    """A few plain sentences that point out what changed; never more than five."""
    out = []
    label = ctx['period_label']
    buyers, previous = ctx['kpi']['buyers'], ctx['kpi']['buyers_prev']
    delta = change(buyers, previous)
    if buyers == 0:
        out.append(f'Belum ada demand buyer pada {label.lower()}.')
    else:
        trend = ''
        if delta is not None and previous:
            if delta >= 500:
                trend = f', naik {buyers / previous:.1f} kali lipat dibanding periode sebelumnya'.replace('.', ',')
            else:
                trend = f', {"naik" if delta >= 0 else "turun"} {abs(delta):g}% dibanding periode sebelumnya'.replace('.', ',')
        out.append(f'{buyers} demand buyer unik pada {label.lower()}{trend}.')
    cats = ctx['categories']
    if cats and buyers:
        top = cats[0]
        out.append(f"Paling banyak dicari: {top['label']} ({round(top['value'] / buyers * 100)}% dari demand).")
    gaps = [g for g in ctx['gap_locations'] if g['buyers'] >= 2 and g['pressure'] >= 1.5]
    if gaps:
        g = gaps[0]
        out.append(f"Peluang: {g['label']} dicari {g['buyers']} buyer, stok ready baru {g['listings']} listing.")
    new = ctx['matches']
    if new['total']:
        out.append(f"{new['total']} match baru ditemukan ({new['hot']} Hot, {new['warm']} Warm) dari upload pada periode ini.")
    if ctx['status']['listing'].get('sold'):
        out.append(f"{ctx['status']['listing']['sold']} listing sudah ditandai Sold.")
    return out[:5]


def _daily(conn, document_type, start, end):
    low, high = bounds(start, end)
    rows = conn.execute(
        '''SELECT r.sent_at::date AS day, count(DISTINCT d.entity_id) AS n
           FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
           WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = %s AND e.status <> 'deleted'
             AND r.sent_at >= %s AND r.sent_at < %s GROUP BY 1''', (document_type, low, high)).fetchall()
    return {row['day']: row['n'] for row in rows}


def _distinct(conn, document_type, start, end):
    low, high = bounds(start, end)
    row = conn.execute(
        '''SELECT count(DISTINCT d.entity_id) AS n
           FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
           WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = %s AND e.status <> 'deleted'
             AND r.sent_at >= %s AND r.sent_at < %s''', (document_type, low, high)).fetchone()
    return row['n']


def _match_counts(conn, start, end):
    low = datetime.combine(start, time.min, WIB)
    high = datetime.combine(end + timedelta(days=1), time.min, WIB)
    scope_sql, scope_params = history_scope_filter(conn)
    rows = conn.execute(
        '''SELECT (me.found_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS total,
                  count(*) FILTER (WHERE me.last_score >= 80) AS hot
           FROM xm.match_events me
           WHERE me.company_id = current_setting('xm.workspace_id') AND me.source = 'import' AND me.active
             AND me.found_at >= %s AND me.found_at < %s''' + scope_sql + ' GROUP BY 1',
        [low, high, *scope_params]).fetchall()
    return {row['day']: (row['total'], row['hot']) for row in rows}


OVERVIEW_TTL = 30


def _imports_version():
    """Changes whenever an upload finishes. The worker is another process, so it cannot clear this API's cache."""
    with connect() as conn:
        row = conn.execute(
            '''SELECT count(*) AS n, max(finished_at) AS last FROM xm.imports
               WHERE company_id = current_setting('xm.workspace_id') AND status = 'completed' ''').fetchone()
    return row['n'], row['last']


@router.get('/overview')
def overview(period: Literal['week', 'last_week', 'month', 'last_month', 'last30', 'custom'] = 'week',
             date_from: str = '', date_to: str = ''):
    # Several people and tabs open the same period; the figures only need to be a few seconds fresh.
    # A finished upload is part of the key, so new data never hides behind a cached answer.
    return cached_value(workspace_id(), ('overview', period, date_from, date_to, _imports_version()), OVERVIEW_TTL,
                        lambda: compute_overview(period, date_from, date_to))


def compute_overview(period, date_from, date_to):
    info = resolve_period(period, date_from, date_to)
    start, end = info['start'], info['end']
    low, high = bounds(start, end)
    today = datetime.now(WIB).date()
    labels = {'week': 'Minggu ini', 'last_week': 'Minggu lalu', 'month': 'Bulan ini', 'last_month': 'Bulan lalu',
              'last30': '30 hari terakhir',
              'custom': pretty_day(start) if start == end else f'{pretty_day(start)} – {pretty_day(end)}'}
    with connect() as conn:
        ws = workspace_id()
        buyer_daily = _daily(conn, 'buyer_request', start, end)
        listing_daily = _daily(conn, 'property_listing', start, end)
        kpi = {
            'buyers': _distinct(conn, 'buyer_request', start, end),
            'listings': _distinct(conn, 'property_listing', start, end),
            'buyers_prev': _distinct(conn, 'buyer_request', info['prev_start'], info['prev_end']),
            'listings_prev': _distinct(conn, 'property_listing', info['prev_start'], info['prev_end']),
        }
        monday = today - timedelta(days=today.weekday())
        quick = {'this_week': _distinct(conn, 'buyer_request', monday, monday + timedelta(days=6)),
                 'this_month': _distinct(conn, 'buyer_request', *month_bounds(today))}
        categories = [{'key': row['k'], 'label': CATEGORY_LABELS.get(row['k'], row['k']), 'value': row['n']} for row in conn.execute(
            '''SELECT coalesce(d.primary_category, 'unknown') AS k, count(DISTINCT d.entity_id) AS n
               FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'buyer_request'
                 AND e.status <> 'deleted' AND r.sent_at >= %s AND r.sent_at < %s GROUP BY 1 ORDER BY 2 DESC, 1''', (low, high)).fetchall()]
        transactions = [{'key': row['k'], 'label': TRANSACTION_LABELS.get(row['k'], row['k']), 'value': row['n']} for row in conn.execute(
            '''SELECT d.transaction_type AS k, count(DISTINCT d.entity_id) AS n
               FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'buyer_request'
                 AND e.status <> 'deleted' AND r.sent_at >= %s AND r.sent_at < %s GROUP BY 1 ORDER BY 2 DESC''', (low, high)).fetchall()]
        locations = conn.execute(
            '''SELECT loc AS k, count(DISTINCT d.entity_id) AS n
               FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
               CROSS JOIN LATERAL unnest(d.locations) AS loc
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'buyer_request'
                 AND e.status <> 'deleted' AND r.sent_at >= %s AND r.sent_at < %s GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 80''',
            (low, high)).fetchall()
        locations = [row for row in locations if is_place(row['k'])][:40]
        demand_locations = {row['k']: row['n'] for row in locations}
        stock_by_category = {row['k']: row['n'] for row in conn.execute(
            '''SELECT coalesce(d.primary_category, 'unknown') AS k, count(DISTINCT d.entity_id) AS n
               FROM xm.documents d JOIN xm.entities e ON e.entity_id = d.entity_id
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'property_listing'
                 AND e.status = 'ready' GROUP BY 1''').fetchall()}
        stock_by_location = {row['k']: row['n'] for row in conn.execute(
            '''SELECT loc AS k, count(DISTINCT d.entity_id) AS n
               FROM xm.documents d JOIN xm.entities e ON e.entity_id = d.entity_id
               CROSS JOIN LATERAL unnest(d.locations) AS loc
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'property_listing'
                 AND e.status = 'ready' AND loc = ANY(%s) GROUP BY 1''', (list(demand_locations),)).fetchall()} if demand_locations else {}
        budget_rows = conn.execute(
            '''SELECT DISTINCT ON (d.entity_id) d.transaction_type, d.price_min, d.price_max, d.price_basis
               FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id JOIN xm.entities e ON e.entity_id = d.entity_id
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active AND d.document_type = 'buyer_request'
                 AND e.status <> 'deleted' AND r.sent_at >= %s AND r.sent_at < %s
               ORDER BY d.entity_id, r.sent_at DESC''', (low, high)).fetchall()
        status_rows = conn.execute(
            'SELECT document_type, status, count(*) AS n FROM xm.entities WHERE company_id = %s GROUP BY 1, 2', (ws,)).fetchall()
        match_daily = _match_counts(conn, start, end)
        match_prev = _match_counts(conn, info['prev_start'], info['prev_end'])
        pref = conn.execute('SELECT listing_group_by FROM xm.app_preferences WHERE company_id = %s', (ws,)).fetchone()
        group_by = pref['listing_group_by'] if pref else 'sender'
        key_sql = "coalesce(nullif(btrim(r.author),''),'Tanpa nama pengirim')" if group_by == 'sender' else "coalesce(nullif(d.contact_phone,''),'')"
        top_sales = conn.execute(
            f'''SELECT {key_sql} AS k, count(*) AS n, mode() WITHIN GROUP (ORDER BY d.contact_name) AS contact_name
                FROM xm.document_groups g JOIN xm.documents d ON d.id = g.group_id JOIN xm.raw_messages r ON r.id = d.raw_message_id
                WHERE g.company_id = current_setting('xm.workspace_id') AND g.document_type = 'property_listing' AND g.status = 'ready'
                GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10''').fetchall()
        latest = conn.execute(
            '''SELECT max(r.sent_at)::date AS day FROM xm.documents d JOIN xm.raw_messages r ON r.id = d.raw_message_id
               WHERE d.company_id = current_setting('xm.workspace_id') AND d.active''').fetchone()
    bucket, labels_x, buyers_series = bucket_series(buyer_daily, start, end)
    _, _, listings_series = bucket_series(listing_daily, start, end)
    match_days = {day: values[0] for day, values in match_daily.items()}
    match_hot = {day: values[1] for day, values in match_daily.items()}
    _, _, match_series = bucket_series(match_days, start, end)
    _, _, hot_series = bucket_series(match_hot, start, end)
    match_total = sum(match_days.values())
    match_hot_total = sum(match_hot.values())
    status = {'buyer': {}, 'listing': {}}
    for row in status_rows:
        status['buyer' if row['document_type'] == 'buyer_request' else 'listing'][row['status']] = row['n']
    gap_categories = supply_demand({item['key']: item['value'] for item in categories if item['key'] != 'unknown'},
                                   stock_by_category, lambda key: CATEGORY_LABELS.get(key, key))
    gap_locations = supply_demand(demand_locations, stock_by_location, lambda key: key.title(), minimum_demand=2)
    ctx = {
        'period_label': labels[period], 'kpi': kpi, 'categories': categories, 'gap_locations': gap_locations,
        'matches': {'total': match_total, 'hot': match_hot_total, 'warm': match_total - match_hot_total}, 'status': status,
    }
    prev_total = sum(values[0] for values in match_prev.values())
    return {
        'period': {'key': period, 'label': labels[period], 'date_from': start.isoformat(), 'date_to': end.isoformat(),
                   'compare_from': info['prev_start'].isoformat(), 'compare_to': info['prev_end'].isoformat(),
                   'days': info['days'], 'bucket': bucket, 'in_future': start > today},
        'latest_data_date': latest['day'].isoformat() if latest and latest['day'] else None,
        'quick': quick,
        'kpi': {**kpi, 'buyers_change': change(kpi['buyers'], kpi['buyers_prev']), 'listings_change': change(kpi['listings'], kpi['listings_prev']),
                'matches': match_total, 'matches_hot': match_hot_total, 'matches_prev': prev_total,
                'matches_change': change(match_total, prev_total)},
        'trend': {'labels': labels_x, 'buyers': buyers_series, 'listings': listings_series,
                  'matches': match_series, 'matches_hot': hot_series},
        'categories': categories, 'transactions': transactions,
        'locations': [{'label': row['k'].title(), 'value': row['n'], 'stock': stock_by_location.get(row['k'], 0)} for row in locations[:10]],
        'budget': budget_histogram(budget_rows),
        'gap_categories': gap_categories, 'gap_locations': gap_locations,
        'status': {side: {key: counts.get(key, 0) for key in ('ready', 'on_hold', 'sold', 'deleted')} for side, counts in status.items()},
        'top_sales': {'group_by': group_by, 'rows': [{'key': row['k'], 'label': row['k'] or 'Tanpa nomor',
                                                         'contact_name': row['contact_name'], 'value': row['n']} for row in top_sales]},
        'matches': ctx['matches'],
        'insights': make_insights(ctx),
    }
