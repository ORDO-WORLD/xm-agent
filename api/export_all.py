"""Every match as one PDF or a ZIP of separate PDFs per sender/phone.

The browser drives the work in small parts so it can show real progress:
``plan`` (what will be exported) -> ``part`` (a slice of one sender or phone
number, written to disk) -> ``download`` (merge parts into a single PDF or one PDF per group).
"""
import os
import json
import zipfile
import re
import shutil
import tempfile
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

import workspace_cache
from company import company_row
from db import connect
from stock import clean_contact_name, display_phone
from tenant import workspace_id
from workspace import resolve_search, stock_statuses
from periods import MatchingPeriods

router = APIRouter(prefix='/export/all')
EXPORT_DIR = Path(os.getenv('XM_EXPORT_DIR') or Path(tempfile.gettempdir()) / 'xm-exports')
SLICE = 25  # buyers or listings per part: keeps every request short
STALE_SECONDS = 6 * 3600
TEMPERATURES = ('hot', 'warm', 'unmatched')
MAX_PAGES = 15000  # beyond this the file is too heavy to merge and to open on a phone


class Filters(MatchingPeriods):
    """The same filters as the Cocokkan list."""
    direction: Literal['buyer', 'property'] = 'buyer'
    search: str = Field(default='', max_length=4020)
    phones: str = ''
    statuses: str = 'hot,warm'
    stock_status: str = 'ready'
    public_id: str = ''
    group_by: Literal['sender', 'phone'] | None = None
    # Empty for manual export; an integration stream opts in to delivery deduplication.
    delivery_scope: str = Field(default='', max_length=200)


class Part(Filters):
    token: uuid.UUID
    index: int = Field(ge=0, le=99999)
    group_key: str
    offset: int = Field(default=0, ge=0)
    first_page: int = Field(default=1, ge=1)


def temperatures(filters):
    chosen = [item for item in TEMPERATURES if item in filters.statuses.split(',')]
    if not chosen:
        raise HTTPException(400, 'Pilih minimal satu jenis hasil: Hot, Warm, atau Belum cocok.')
    return chosen


def scope(conn, request, filters, group_key=None):
    """The filtered sources as a CTE, keyed by the company's own grouping (sender or phone)."""
    if not workspace_cache.ready(conn):
        raise HTTPException(409, 'Hasil pencocokan sedang disiapkan. Coba lagi sebentar.')
    group_by = filters.group_by or company_row(conn)['listing_group_by'] or 'sender'
    (clause, date_params), (target_clause, target_params) = filters.windows(filters.direction)
    eligible, params = workspace_cache._eligible(
        filters.direction, resolve_search(conn, request, filters.search), filters.phones, filters.statuses, clause, date_params,
        stock_statuses(filters.stock_status), filters.public_id, group_by, group_key, per_key=True,
        target_clause=target_clause, target_params=target_params, delivery_scope=filters.delivery_scope)
    return group_by, eligible, params


def group_stats(conn, eligible, params, group_by, chosen):
    rows = conn.execute('WITH ' + eligible + '''
      SELECT e.group_key AS key, count(*) AS sources, coalesce(sum(e.hot_count),0) AS hot, coalesce(sum(e.warm_count),0) AS warm,
             count(*) FILTER (WHERE e.hot_count+e.warm_count=0) AS unmatched,
             mode() WITHIN GROUP (ORDER BY e.contact_name) AS contact_name,
             mode() WITHIN GROUP (ORDER BY e.contact_phone) AS contact_phone
      FROM eligible e JOIN xm.document_groups g ON g.group_id=e.group_id
      GROUP BY e.group_key ORDER BY count(*) DESC,e.group_key''', params).fetchall()
    groups = []
    for row in rows:
        counts = {key: int(row[key]) if key in chosen else 0 for key in TEMPERATURES}
        if group_by == 'phone':
            name = clean_contact_name(row['contact_name'])
            title = (f'{name} · ' if name else '') + display_phone(row['key']) if row['key'] else 'Tanpa nomor telepon'
        else:
            title = row['key']
        groups.append({'key': row['key'], 'title': title, 'sources': row['sources'], 'contact_name': clean_contact_name(row['contact_name']) or '',
                       'phone': row['contact_phone'] or '', **counts, 'pages': sum(counts.values())})
    return [group for group in groups if group['pages']]


def folder(token):
    return EXPORT_DIR / re.sub(r'[^A-Za-z0-9_-]', '_', workspace_id()) / str(token)


def sweep():
    """Parts of exports nobody downloaded are removed after a few hours."""
    limit = time.time() - STALE_SECONDS
    for path in EXPORT_DIR.glob('*/*'):
        if path.is_dir() and path.stat().st_mtime < limit:
            shutil.rmtree(path, ignore_errors=True)


@router.post('/plan')
def plan(filters: Filters, request: Request):
    chosen = temperatures(filters)
    with connect() as conn:
        if workspace_cache.ready(conn):
            group_by, eligible, params = scope(conn, request, filters)
            groups = group_stats(conn, eligible, params, group_by, chosen)
        else:  # nothing uploaded yet: an empty plan, like the empty list on screen
            group_by, groups = filters.group_by or company_row(conn)['listing_group_by'] or 'sender', []
    sweep()
    totals = {key: sum(group[key] for group in groups) for key in ('sources', *TEMPERATURES, 'pages')}
    return {'token': uuid.uuid4(), 'group_by': group_by, 'groups': groups, 'totals': totals, 'max_pages': MAX_PAGES}


@router.post('/part')
def part(payload: Part, request: Request):
    from report import build_report
    chosen = temperatures(payload)
    with connect() as conn:
        group_by, eligible, params = scope(conn, request, payload, payload.group_key)
        stats = group_stats(conn, eligible, params, group_by, chosen)
        rows = conn.execute('WITH ' + eligible + ' SELECT id FROM eligible ORDER BY sent_at DESC NULLS LAST,id LIMIT %s OFFSET %s',
                            params + [SLICE + 1, payload.offset]).fetchall()
        ids = [row['id'] for row in rows[:SLICE]]
        _, (target_clause, target_params) = payload.windows(payload.direction)
        found = {group['source']['id']: group for group in workspace_cache.recommendations(
            conn, payload.direction, ids, target_clause=target_clause, target_params=target_params,
            delivery_scope=payload.delivery_scope)['groups']} if ids else {}
    pairs = []
    for source_id in ids:
        group = found.get(source_id)
        if not group:
            continue
        if not group['recommendations'] and 'unmatched' in chosen:
            pairs.append((group['source'], None))
        pairs += [(group['source'], target) for target in group['recommendations']
                  if ('hot' if float(target['score']) >= 80 else 'warm') in chosen]
    cover = None
    if payload.offset == 0 and stats:
        cover = {**stats[0], 'kind': 'Nomor telepon' if group_by == 'phone' else 'Pengirim', 'direction': payload.direction}
    pages = len(pairs) + (1 if cover else 0)
    if pages:
        target = folder(payload.token)
        target.mkdir(parents=True, exist_ok=True)
        pdf = build_report(pairs, payload.direction, section=stats[0]['title'] if stats else '', cover=cover, first_page=payload.first_page)
        (target / f'{payload.index:05d}-{payload.offset:08d}.pdf').write_bytes(pdf)
        if payload.offset == 0 and stats:
            (target / f'{payload.index:05d}.json').write_text(json.dumps({**stats[0], 'group_by': group_by, 'direction': payload.direction, 'first_page': payload.first_page}))
    entity_pairs = []
    for source, target in pairs:
        if target and source.get('entity_id') and target.get('entity_id'):
            buyer, listing = (source, target) if payload.direction == 'buyer' else (target, source)
            entity_pairs.append([str(buyer['entity_id']), str(listing['entity_id'])])
    return {'pages': pages, 'next_offset': payload.offset + SLICE if len(rows) > SLICE else None,
            'entity_pairs': entity_pairs}


def merge_pdf_parts(items):
    from pypdf import PdfWriter
    writer = PdfWriter()
    for item in items:
        writer.append(str(item))
    writer.compress_identical_objects()
    output = BytesIO()
    writer.write(output)
    count = len(writer.pages)
    writer.close()
    return output.getvalue(), count


def group_filename(index, metadata, count):
    """Names for manual downloads and workflow attachments follow the same contract."""
    name = metadata['key'] if metadata['group_by'] == 'sender' else metadata['contact_name']
    name = re.sub(r'[^\w-]+', '-', name, flags=re.UNICODE).strip('-')[:100] or 'Tanpa-nama'
    phone = re.sub(r'[^0-9]', '', metadata['phone']) or 'Tanpa-nomor'
    first = metadata['first_page']
    unit = 'buyer' if metadata['direction'] == 'buyer' else 'listing'
    return f"{index + 1:02d}_{name}_{phone}_{metadata['sources']}{unit}_hal{first}-{first + count - 1}.pdf"


@router.get('/{token}/download')
def download(token: uuid.UUID, output: Literal['single', 'grouped'] = 'single'):
    target = folder(token)
    parts = sorted(target.glob('*.pdf')) if target.is_dir() else []
    if not parts:
        raise HTTPException(404, 'File export tidak ditemukan. Mulai export lagi.')
    if output == 'single':
        content, _ = merge_pdf_parts(parts)
        media_type, filename = 'application/pdf', 'Semua-Pencocokan.pdf'
    else:
        archive = BytesIO()
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
            indexes = sorted({item.name.split('-')[0] for item in parts})
            for index in indexes:
                metadata_path = target / f'{index}.json'
                if not metadata_path.exists():
                    raise HTTPException(409, 'Data kelompok tidak lengkap. Mulai export lagi.')
                metadata = json.loads(metadata_path.read_text())
                content, count = merge_pdf_parts([item for item in parts if item.name.startswith(index + '-')])
                filename = group_filename(int(index), metadata, count)
                bundle.writestr(filename, content)
        content = archive.getvalue()
        media_type, filename = 'application/zip', 'Semua-Pencocokan.zip'
    return Response(content, media_type=media_type,
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'},
                    background=BackgroundTask(shutil.rmtree, target, True))


class Cancel(BaseModel):
    token: uuid.UUID


@router.post('/cancel')
def cancel(payload: Cancel):
    shutil.rmtree(folder(payload.token), ignore_errors=True)
    return {'ok': True}
