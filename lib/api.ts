/** One place that talks to the Python API and turns failures into readable Indonesian messages. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const UNAUTHORIZED_EVENT = 'xm:unauthorized';
export const LOCKED_EVENT = 'xm:locked';

type Detail = string | { msg?: string }[] | undefined;

function readableDetail(detail: Detail, fallback: string) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    // Validation errors from the API: show the first one, not the raw structure.
    return 'Periksa kembali isian Anda' + (detail[0]?.msg ? ` — ${detail[0].msg}` : '.');
  }
  return fallback;
}

export async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const data = (body ?? {}) as { detail?: Detail; code?: string };
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    if (response.status === 403 && data.code === 'account_locked' && typeof window !== 'undefined') window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiError(readableDetail(data.detail, response.status >= 500 ? 'Server sedang bermasalah. Coba lagi sebentar.' : 'Permintaan tidak dapat diproses.'), response.status, data.code);
  }
  return body as T;
}

export function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export function errorMessage(reason: unknown, fallback = 'Terjadi kendala. Silakan coba lagi.') {
  if (reason instanceof Error && reason.name !== 'AbortError') return reason.message || fallback;
  return fallback;
}

export function isAbort(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError';
}
