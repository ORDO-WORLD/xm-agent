"""Public IDs: look them up and mark buyers/listings ready, on-hold, sold or deleted."""
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import activity
from auth import current_user
from db import connect
from entities import lookup, set_entity_status, STATUSES
from runtime_cache import invalidate_stats
from tenant import owner_id, workspace_id

router = APIRouter(prefix='/entities')


class StatusChange(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)
    status: Literal['ready', 'on_hold', 'sold', 'deleted']
    note: str | None = Field(default=None, max_length=300)


@router.post('/status')
def change_status(payload: StatusChange, request: Request):
    user = current_user(request)
    with connect() as conn:
        result = set_entity_status(conn, workspace_id(), owner_id() or user['id'], payload.ids, payload.status, payload.note)
        changed = result['updated']
        if changed:
            label = activity.STATUS_LABEL[payload.status]
            if len(changed) == 1:
                text = f"mengubah status {changed[0]['public_id']} dari {activity.STATUS_LABEL[changed[0]['previous']]} ke {label}"
            else:
                text = f"mengubah status {len(changed)} data ke {label} ({', '.join(item['public_id'] for item in changed[:4])}{', …' if len(changed) > 4 else ''})"
            note = (payload.note or '').strip()
            activity.record(conn, 'change', 'entity.status', text + (f', catatan: {activity.quote(note)}' if note else ''), {
                'ke': label, 'catatan': note or None,
                'data': [{'id': item['public_id'], 'dari': activity.STATUS_LABEL[item['previous']]} for item in changed]})
        conn.commit()
    invalidate_stats(workspace_id())
    return result


@router.get('/lookup')
def find(q: str, limit: int = 8):
    if len(q.strip()) < 2:
        raise HTTPException(400, 'Ketik minimal 2 karakter ID.')
    with connect() as conn:
        return lookup(conn, workspace_id(), q, limit)


@router.get('/summary')
def summary():
    """How many unique buyers and listings sit in each status."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT document_type, status, count(*) AS n FROM xm.entities WHERE company_id = current_setting('xm.workspace_id') GROUP BY 1, 2").fetchall()
    out = {'buyer': dict.fromkeys(STATUSES, 0), 'listing': dict.fromkeys(STATUSES, 0)}
    for row in rows:
        out['buyer' if row['document_type'] == 'buyer_request' else 'listing'][row['status']] = row['n']
    return out
