import type { EntityStatus, Row } from '@/lib/types';

const decimal = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export const number = (value: number | null | undefined) => whole.format(Number(value ?? 0));

/** "Rp 1,8 M", "Rp 450 jt" — how people actually say prices. */
export function money(value?: number | null) {
  const amount = Number(value);
  if (!amount) return null;
  if (amount >= 1e12) return `Rp ${decimal.format(amount / 1e12)} T`;
  if (amount >= 1e9) return `Rp ${decimal.format(amount / 1e9)} M`;
  if (amount >= 1e6) return `Rp ${decimal.format(amount / 1e6)} jt`;
  if (amount >= 1e3) return `Rp ${decimal.format(amount / 1e3)} rb`;
  return `Rp ${whole.format(amount)}`;
}

export function area(min?: number | null, max?: number | null) {
  if (!min && !max) return null;
  const low = Number(min ?? max);
  const high = Number(max ?? 0);
  return `${decimal.format(low)}${high && low !== high ? `–${decimal.format(high)}` : ''} m²`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  house: 'Rumah', warehouse: 'Gudang', apartment: 'Apartemen', shophouse: 'Ruko', land: 'Tanah', factory: 'Pabrik',
  office: 'Kantor', villa: 'Villa', commercial_building: 'Gedung komersial', hotel: 'Hotel', unknown: 'Belum terbaca',
};
export const categoryLabel = (key: string) => CATEGORY_LABELS[key] ?? key;
export const TRANSACTION_LABELS: Record<string, string> = { sale: 'Jual / beli', rent: 'Sewa', unknown: 'Belum jelas' };

export function structuredSummary(row: Row) {
  const price = money(row.price_max ?? row.price_min);
  const basis = row.price_basis === 'per_m2' ? '/m²' : row.price_basis === 'per_year' ? '/tahun' : '';
  return [
    row.categories?.map(categoryLabel).join(', '),
    row.locations?.map(titleCase).join(' / '),
    area(row.land_area_min, row.land_area_max) && `LT ${area(row.land_area_min, row.land_area_max)}`,
    area(row.building_area_min, row.building_area_max) && `LB ${area(row.building_area_min, row.building_area_max)}`,
    price && `${price}${basis}`,
  ].filter(Boolean).join(' · ');
}

/** The parser sometimes keeps the signature label ("Info lanjut: Andi"); show just the name. */
export function cleanName(name?: string | null) {
  const cleaned = (name ?? '').replace(/^\s*(?:info\s+lanjut|informasi|contact(?:\s+person)?|kontak|hubungi|marketing|call|wa)\s*[:：\-–]?\s*/i, '').replace(/^[~\s]+/, '').trim();
  return cleaned || '';
}

export function titleCase(text: string) {
  return text.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

/** Chat timestamps have no zone; they are Jakarta time. */
export function asWib(value?: string | null) {
  if (!value) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+07:00`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date;
}

const wibDay = (time: number) => Math.floor((time + 7 * 3_600_000) / 86_400_000);

export function relativeDate(value?: string | null) {
  const date = asWib(value);
  if (!date) return 'tanggal tidak tersedia';
  const days = wibDay(Date.now()) - wibDay(date.getTime());
  if (days < 0) return 'tanggal mendatang';
  if (days === 0) return 'hari ini';
  if (days === 1) return 'kemarin';
  if (days < 7) return `${days} hari lalu`;
  if (days < 30) return `${Math.floor(days / 7)} minggu lalu`;
  if (days < 365) return `${Math.floor(days / 30)} bulan lalu`;
  return `${Math.floor(days / 365)} tahun lalu`;
}

export function dateTime(value?: string | null, withZone = true) {
  const date = asWib(value);
  if (!date) return '—';
  const text = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(date);
  return withZone ? `${text} WIB` : text;
}

export function dateOnly(value?: string | null) {
  const date = asWib(value);
  return date ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date) : '—';
}

/** 6281234567890 -> +62 812-3456-7890 */
export function formatPhone(phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const national = digits.startsWith('62') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : digits;
  const parts = [national.slice(0, 3), national.slice(3, 7), national.slice(7)].filter(Boolean);
  return `+62 ${parts.join('-')}`;
}

export function normalizePhone(value?: string | null) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function waLink(phone: string | null | undefined, text: string) {
  const number = normalizePhone(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export function followUpMessage(row: Row, kind: 'buyer' | 'property') {
  const summary = structuredSummary(row) || (row.raw_text || row.normalized_text).slice(0, 500);
  const id = row.public_id ? ` (ID ${row.public_id})` : '';
  return `Halo ${row.contact_name || 'Bapak/Ibu'}, saya ingin menindaklanjuti ${kind === 'buyer' ? 'kebutuhan properti' : 'listing properti'}${id} yang Anda bagikan:\n\n${summary}\n\nApakah masih tersedia? Saya memiliki calon pasangan yang sesuai. Boleh saya meminta informasi lebih lanjut? Terima kasih.`;
}

export const STATUS_LABELS: Record<EntityStatus, string> = { ready: 'Ready', on_hold: 'On-hold', sold: 'Sold', deleted: 'Dihapus' };

export function initials(name?: string | null) {
  const parts = (name ?? '').replace(/^[~\s]+/, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Jakarta calendar helpers (YYYY-MM-DD). */
export function todayWib() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function shiftDay(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function mondayOf(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  return shiftDay(iso, -((date.getUTCDay() + 6) % 7));
}
export function monthStart(iso: string) { return `${iso.slice(0, 8)}01`; }
export function monthEnd(iso: string) {
  const date = new Date(`${iso.slice(0, 8)}01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}
export function prettyRange(from: string, to: string) {
  const fmt = (iso: string, year = true) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  return from === to ? fmt(from) : `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to)}`;
}

export function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date()));
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}
