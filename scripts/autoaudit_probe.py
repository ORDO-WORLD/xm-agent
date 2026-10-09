#!/usr/bin/env python3
"""Uji baca ke API AutoAudit. Hanya GET; tidak menulis ke AutoAudit maupun ke database XM.

Contoh:
  python3 scripts/autoaudit_probe.py
  python3 scripts/autoaudit_probe.py --sales-id 57 --start 2026-09-10 --end 2026-09-16 --manual-json unggahan.json

Membaca AUTOAUDIT_BASE_URL dan AUTOAUDIT_API_KEY dari environment. Key tidak pernah dicetak.
"""
import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'api'))

from autoaudit_client import AutoAuditError, configured, from_env  # noqa: E402
from parser import message_hash  # noqa: E402


def hashes(chats: dict, start: date, end: date) -> dict:
    """message hash -> a short readable sample, for messages dated inside [start, end]."""
    found = {}
    for chat_id, chat in chats.items():
        for message in chat.get('messages', []):
            timestamp = str(message[0]) if len(message) > 0 else ''
            text = str(message[1]) if len(message) > 1 else ''
            author = str(message[2]) if len(message) > 2 else ''
            if not (start.isoformat() <= timestamp[:10] <= end.isoformat()):
                continue
            found[message_hash(chat_id, timestamp, author, text)] = f'{chat_id} | {timestamp} | {author} | {text[:60]!r}'
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--sales-id', type=int)
    parser.add_argument('--start', type=date.fromisoformat)
    parser.add_argument('--end', type=date.fromisoformat)
    parser.add_argument('--manual-json', type=Path, help='file unggahan manual lama sebagai pembanding')
    args = parser.parse_args()
    if not configured():
        print('AUTOAUDIT_BASE_URL dan AUTOAUDIT_API_KEY belum diisi di environment.')
        return 2
    client = from_env()
    try:
        if not args.sales_id:
            for row in client.list_sales():
                print(f"{row['id']:>6}  {row['name']}  —  {row['company'] or '-'}")
            return 0
        print('Ringkasan dataset:', json.dumps(client.dataset_summary(args.sales_id), ensure_ascii=False, indent=2))
        if not (args.start and args.end):
            return 0
        began = time.monotonic()
        dataset = client.download_range(args.sales_id, args.start, args.end)
        elapsed = time.monotonic() - began
        size = len(json.dumps(dataset, ensure_ascii=False).encode('utf-8'))
        chats = dataset['chats']
        total = sum(len(chat.get('messages', [])) for chat in chats.values())
        print(f'Unduhan {args.start}..{args.end}: {elapsed:.1f} detik, {size / 1_048_576:.2f} MB, {len(chats)} chat, {total} pesan')
        print('Kunci dataset:', sorted(dataset))
        if args.manual_json:
            manual = json.loads(args.manual_json.read_text(encoding='utf-8'))
            ours, theirs = hashes(manual.get('chats', {}), args.start, args.end), hashes(chats, args.start, args.end)
            same, only_api, only_manual = ours.keys() & theirs.keys(), theirs.keys() - ours.keys(), ours.keys() - theirs.keys()
            print(f'Sidik pesan: sama {len(same)}, hanya di API {len(only_api)}, hanya di file manual {len(only_manual)}')
            for label, keys, source in (('hanya di API', only_api, theirs), ('hanya di file manual', only_manual, ours)):
                for key in list(keys)[:3]:
                    print(f'  contoh {label}: {source[key]}')
    except AutoAuditError as exc:
        print(f'Gagal: {exc} (status={exc.status}, code={exc.code}, retryable={exc.retryable})')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
