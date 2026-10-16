"""Bounded, retry-safe delivery of committed configuration activities. No DB transaction spans HTTP."""
import hashlib
import hmac
import json
import os
import time
import urllib.request

from db import connect


def signature(secret, timestamp, raw):
    message = f'property-activity-v1\n{timestamp}\nPOST\n/api/property/activity-events\n'.encode() + raw
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def relay_batch():
    secret = os.getenv('PROPERTY_SSO_SECRET', '')
    base = os.getenv('AUTOAUDIT_BASE_URL', '').strip().rstrip('/')
    if len(secret) < 32 or not base:
        return 0
    with connect() as conn:
        rows = conn.execute("SELECT id,autoaudit_event_id,details FROM xm.activity_log WHERE autoaudit_delivery_state='pending' ORDER BY id LIMIT 50").fetchall()
    delivered = 0
    deadline = time.monotonic() + 5
    for row in rows:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        event = {'event_id': str(row['autoaudit_event_id']), **row['details']['_autoaudit']}
        raw = json.dumps(event, separators=(',', ':')).encode()
        timestamp = str(int(time.time()*1000))
        request = urllib.request.Request(base + '/api/property/activity-events', data=raw, method='POST',
                                        headers={'Content-Type': 'application/json', 'X-Property-Timestamp': timestamp,
                                                 'X-Property-Signature': signature(secret, timestamp, raw)})
        try:
            with urllib.request.urlopen(request, timeout=min(5, remaining)) as response:
                answer = json.loads(response.read(65536))
                if response.status != 200 or answer.get('event_id') != event['event_id'] or answer.get('acknowledged') is not True:
                    break
        except Exception:
            # Leave the oldest event pending; avoid up to 50 timeouts on one outage.
            break
        with connect() as conn:
            conn.execute("UPDATE xm.activity_log SET autoaudit_delivery_state='sent' WHERE id=%s AND autoaudit_event_id=%s", (row['id'], row['autoaudit_event_id']))
            conn.commit()
        delivered += 1
    return delivered


def purge_sessions():
    with connect() as conn:
        conn.execute('DELETE FROM xm.sessions WHERE id IN (SELECT id FROM xm.sessions WHERE expires_at <= now() ORDER BY expires_at LIMIT 500)')
        conn.commit()
