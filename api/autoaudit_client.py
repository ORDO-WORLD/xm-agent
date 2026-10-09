"""The only code that talks HTTP to the main AutoAudit app. Read-only: every call is a GET."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

# Worth another attempt: the artifact may still be mirroring, or the service is briefly unavailable.
RETRYABLE_STATUS = {202, 404, 408, 429}
PAGE_LIMIT = 100
MAX_PAGES = 100


class AutoAuditError(Exception):
    def __init__(self, message, status=None, code=None, retryable=True):
        super().__init__(message)
        self.status = status
        self.code = code
        self.retryable = retryable


def configured() -> bool:
    return bool(os.getenv('AUTOAUDIT_BASE_URL', '').strip() and os.getenv('AUTOAUDIT_API_KEY', '').strip())


def _retryable(status: int) -> bool:
    return status in RETRYABLE_STATUS or status >= 500


class AutoAuditClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 120, opener=urllib.request.urlopen):
        self.base_url = base_url.rstrip('/')
        self._api_key = api_key
        self.timeout = timeout
        self._opener = opener

    def _get(self, path: str, params: dict | None = None):
        url = f'{self.base_url}/api/v1/integrations{path}'
        if params:
            url += '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={'Authorization': f'Bearer {self._api_key}', 'Accept': 'application/json'})
        try:
            with self._opener(request, timeout=self.timeout) as response:
                status = int(getattr(response, 'status', 200) or 200)
                content_type = str(response.headers.get('Content-Type') or '')
                body = response.read()
        except urllib.error.HTTPError as exc:
            code = None
            try:
                code = (json.loads(exc.read() or b'{}').get('error') or {}).get('code')
            except Exception:
                pass
            # Never echo the response text: keep messages free of anything the server sent back.
            raise AutoAuditError(f'AutoAudit menjawab {exc.code}' + (f' ({code})' if code else ''),
                                 status=exc.code, code=code, retryable=_retryable(exc.code)) from None
        except (urllib.error.URLError, OSError) as exc:
            raise AutoAuditError(f'AutoAudit tidak dapat dihubungi ({type(exc).__name__})') from None
        if status != 200:
            raise AutoAuditError(f'AutoAudit menjawab {status}', status=status, retryable=_retryable(status))
        if 'json' not in content_type.lower():
            raise AutoAuditError('Jawaban AutoAudit bukan JSON', status=status)
        try:
            payload = json.loads(body)
        except ValueError:
            raise AutoAuditError('Jawaban AutoAudit tidak dapat dibaca', status=status) from None
        if not isinstance(payload, dict):
            raise AutoAuditError('Bentuk jawaban AutoAudit tidak dikenali', status=status)
        return payload

    def list_sales(self) -> list[dict]:
        rows = []
        for page in range(1, MAX_PAGES + 1):
            payload = self._get('/sales', {'page': page, 'limit': PAGE_LIMIT})
            items = payload.get('data') or []
            for item in items:
                if isinstance(item, dict) and item.get('id') is not None:
                    company = item.get('company') or {}
                    rows.append({'id': int(item['id']), 'name': str(item.get('name') or f"Sales #{item['id']}"),
                                 'company': company.get('name'), 'company_id': company.get('id')})
            pagination = payload.get('pagination') or {}
            total_pages = pagination.get('total_pages') or pagination.get('totalPages')
            if not items or (total_pages and page >= int(total_pages)) or (not total_pages and len(items) < PAGE_LIMIT):
                break
        return rows

    def dataset_summary(self, sales_id: int) -> dict:
        data = self._get(f'/sales/{int(sales_id)}').get('data')
        dataset = data.get('dataset') if isinstance(data, dict) else None
        if not isinstance(dataset, dict):
            raise AutoAuditError('Ringkasan dataset tidak ditemukan')
        # The owning company travels with the summary so a pull can confirm the sales is still in scope.
        return {**dataset, 'company_id': (data.get('company') or {}).get('id')}

    def download_range(self, sales_id: int, start: date, end: date) -> dict:
        payload = self._get(f'/sales/{int(sales_id)}/artifacts/download',
                            {'start_date': start.isoformat(), 'end_date': end.isoformat()})
        data = payload.get('data')
        dataset = data.get('dataset') if isinstance(data, dict) else None
        if not isinstance(dataset, dict) or not isinstance(dataset.get('chats'), dict):
            raise AutoAuditError('Isi chat tidak ditemukan pada jawaban AutoAudit')
        return dataset


def companies_from(sales: list[dict]) -> list[dict]:
    """The AutoAudit companies behind a sales list, by name."""
    found = {row['company_id']: row.get('company') or f"Company #{row['company_id']}" for row in sales if row.get('company_id') is not None}
    return sorted(({'id': key, 'name': name} for key, name in found.items()), key=lambda item: item['name'].lower())


def from_env() -> AutoAuditClient:
    return AutoAuditClient(os.environ['AUTOAUDIT_BASE_URL'].strip(), os.environ['AUTOAUDIT_API_KEY'].strip(),
                           timeout=float(os.getenv('AUTOAUDIT_TIMEOUT_SECONDS', '120')))
