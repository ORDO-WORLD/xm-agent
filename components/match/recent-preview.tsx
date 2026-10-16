'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Button, toast } from '@heroui/react';
import { PreviewApiProvider, useApi } from '@/lib/workspace-context';
import { useRoute } from '@/lib/router';
import { shiftDay, todayWib } from '@/lib/format';
import type { Direction, EntityStatus, RecentGroup, RecentResponse, Row } from '@/lib/types';

const SCENARIOS = [
  { id: 'filled', label: 'Terisi lengkap' }, { id: 'loading', label: 'Sedang memuat' },
  { id: 'empty', label: 'Hasil kosong' }, { id: 'error', label: 'Gagal memuat' },
  { id: 'changed', label: 'Detail sudah berubah' }, { id: 'export-failed', label: 'Export gagal' },
  { id: 'too-big', label: 'Export melebihi batas' },
] as const;
type Scenario = typeof SCENARIOS[number]['id'];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Only serves in-memory examples; unsupported operations never fall through to the real API. */
export function createRecentPreviewApi(scenario: Scenario): ReturnType<typeof useApi> {
  const statuses = new Map<string, EntityStatus>();
  let exportPages: number[] = [];
  const today = todayWib();
  const yesterday = shiftDay(today, -1);
  const names = ['Andi Pratama', 'Maya Putri', 'Budi Santoso', 'Dewi Lestari', 'Rudi Wijaya', ''];
  const locations = ['citraland', 'pakuwon indah', 'darmo', 'wiyung', 'rungkut', 'surabaya barat'];

  function row(index: number, direction: Direction, target = false): Row {
    const property = direction === 'property';
    const id = `preview-${direction}-${target ? 'target-' : ''}${index}`;
    const name = names[index % names.length];
    const location = locations[index % locations.length];
    return {
      id, entity_id: id, public_id: `${property ? 'L' : 'B'}-DEMO${String(index + 1).padStart(3, '0')}`,
      entity_status: statuses.get(id) ?? (index % 10 === 3 ? 'on_hold' : index % 10 === 4 ? 'sold' : 'ready'),
      document_type: property ? 'property_listing' : 'buyer_request',
      contact_name: name || null, contact_phone: index % 7 === 0 ? null : `628000000${String(index).padStart(3, '0')}`,
      author: ['Caesar (contoh)', 'Bambang (contoh)', 'Maya (contoh)'][index % 3], chat_name: 'Grup Properti Demo',
      raw_text: `[DATA CONTOH]\n${property ? 'Dijual' : 'Dicari'} rumah di ${location}.\nLT 150 m2, LB 120 m2. ${property ? 'Harga' : 'Budget'} Rp 2,5 miliar.\n${property ? '3 kamar tidur, akses jalan lebar, siap huni.' : 'Butuh 3 kamar tidur, akses mobil, untuk keluarga.'}\nKontak: ${name || 'Belum tersedia'}`,
      normalized_text: '', transaction_type: 'sale', locations: [location], categories: ['rumah'],
      land_area_min: 150, land_area_max: 180, building_area_min: 100, building_area_max: 140,
      price_min: 2000000000, price_max: 2500000000,
      sent_at: `${yesterday}T14:00:00+07:00`, last_seen_at: `${today}T07:00:00+07:00`,
      duplicate_count: index % 3 === 0 ? 3 : 1,
      explanation: ['Jenis properti sesuai: rumah', 'Lokasi sesuai kebutuhan', 'Harga dalam rentang anggaran', 'Luas tanah sesuai toleransi', 'Luas bangunan mendekati kebutuhan', 'Transaksi jual-beli sesuai'],
    };
  }

  function groups(direction: Direction): RecentGroup[] {
    return Array.from({ length: 60 }, (_, index) => {
      const found = `${index % 6 === 0 ? yesterday : today}T08:15:00+07:00`;
      const scores = index === 1 ? Array.from({ length: 65 }, (_value, matchIndex) => [92, 74, 86][matchIndex % 3]) : [92, 74, 86];
      const matches = scores.map((score, targetIndex) => ({
        event_id: index * 1000 + targetIndex + 1, found_at: found, score,
        temperature: score >= 80 ? 'hot' as const : 'warm' as const,
        import_id: 'preview-import', agent_name: ['Caesar (contoh)', 'Maya (contoh)'][index % 2],
        upgraded_to_hot: targetIndex === 2, target: row(index * 3 + targetIndex, direction === 'buyer' ? 'property' : 'buyer', true),
      }));
      return { source: row(index, direction), latest_found_at: found, matches, pair_count: matches.length, hot_count: matches.filter((match) => match.temperature === 'hot').length, warm_count: matches.filter((match) => match.temperature === 'warm').length };
    });
  }

  function filtered(params: URLSearchParams) {
    const direction: Direction = params.get('direction') === 'property' ? 'property' : 'buyer';
    const from = params.get('date_from') || params.get('found_from') || '';
    const to = params.get('date_to') || params.get('found_to') || '';
    const temperatures = (params.get('temps') ?? params.get('statuses') ?? 'hot,warm').split(',');
    const allowed = params.has('stock_status') ? (params.get('stock_status') ?? '').split(',') : params.get('include_inactive') === 'true' ? ['ready', 'on_hold', 'sold'] : ['ready'];
    return groups(direction).filter((group) => {
      const day = group.latest_found_at.slice(0, 10);
      return (!from || day >= from) && (!to || day <= to) && allowed.includes(group.source.entity_status ?? 'ready');
    }).map((group) => {
      const matches = group.matches.filter((match) => temperatures.includes(match.temperature) && allowed.includes(match.target.entity_status ?? 'ready'));
      return { ...group, matches, pair_count: matches.length, hot_count: matches.filter((match) => match.temperature === 'hot').length, warm_count: matches.filter((match) => match.temperature === 'warm').length };
    }).filter((group) => group.pair_count > 0);
  }

  function response(params: URLSearchParams): RecentResponse {
    let all = scenario === 'empty' ? [] : filtered(params);
    const source = params.get('source_entity');
    if (source) all = scenario === 'changed' ? [] : all.filter((group) => group.source.entity_id === source);
    const offset = Number(params.get('offset') || 0);
    const limit = Number(params.get('limit') || 30);
    const perSource = Number(params.get('per_source') || 0);
    const matchOffset = Number(params.get('match_offset') || 0);
    return {
      direction: params.get('direction') === 'property' ? 'property' : 'buyer',
      date_from: params.get('date_from') || today, date_to: params.get('date_to') || today,
      totals: { pairs: all.reduce((n, group) => n + group.pair_count, 0), hot: all.reduce((n, group) => n + group.hot_count, 0), warm: all.reduce((n, group) => n + group.warm_count, 0) },
      groups: all.slice(offset, offset + limit).map((group) => ({ ...group, matches: perSource ? group.matches.slice(matchOffset, matchOffset + perSource) : [] })),
      has_more: offset + limit < all.length,
    };
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, 'http://preview.local');
    if (url.pathname === '/matches/recent' && scenario === 'loading') return new Promise<T>((_resolve, reject) => {
      if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    await sleep(180); signal?.throwIfAborted();
    if (url.pathname === '/matches/recent' && scenario === 'error') throw new Error('Simulasi: hasil belum dapat dimuat. Pilih kondisi Terisi lengkap untuk melanjutkan.');
    if (url.pathname === '/matches/recent') return response(url.searchParams) as T;
    if (url.pathname === '/matches/recent/summary') return {
      unseen: 18, unseen_hot: 12, since: `${yesterday}T12:00:00+07:00`,
      last_import: { import_id: 'preview-import', found_at: `${today}T08:15:00+07:00`, total: 120, hot: 80, warm: 40, agent_name: 'Caesar (contoh)', file_name: 'Caesar - Demo Match Terbaru - cleaned.json' },
    } as T;
    if (url.pathname === '/matches/recent/days') {
      const days: Record<string, { total: number; hot: number; warm: number }> = {};
      for (const group of filtered(url.searchParams)) {
        const day = group.latest_found_at.slice(0, 10);
        const count = days[day] ??= { total: 0, hot: 0, warm: 0 };
        count.total += group.pair_count; count.hot += group.hot_count; count.warm += group.warm_count;
      }
      return { days, latest_date: today } as T;
    }
    throw new Error('Tindakan ini tidak tersedia dalam preview.');
  }

  async function post<T>(path: string, json?: unknown): Promise<T> {
    const body = (json ?? {}) as Record<string, unknown>;
    await sleep(350);
    if (path === '/entities/status') {
      for (const id of body.ids as string[]) statuses.set(id, body.status as EntityStatus);
      return {} as T;
    }
    if (path === '/export/all/plan') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) if (typeof value === 'string') params.set(key, value);
      let all = scenario === 'empty' ? [] : filtered(params);
      if (Array.isArray(body.recent_sources)) all = all.filter((group) => (body.recent_sources as string[]).includes(group.source.entity_id!));
      if (Array.isArray(body.recent_events)) all = all.map((group) => ({ ...group, matches: group.matches.filter((match) => (body.recent_events as number[]).includes(match.event_id)) })).filter((group) => group.matches.length);
      const planGroups = ['Caesar (contoh)', 'Bambang (contoh)', 'Maya (contoh)'].map((title, index) => {
        const sources = all.filter((_group, groupIndex) => groupIndex % 3 === index);
        const matches = sources.flatMap((group) => group.matches);
        return { key: `preview-export-${index}`, title, sources: sources.length, hot: matches.filter((match) => match.temperature === 'hot').length, warm: matches.filter((match) => match.temperature === 'warm').length, unmatched: 0, pages: matches.length };
      }).filter((group) => group.sources);
      exportPages = planGroups.map((group) => group.pages + 1);
      return { token: 'preview-only', group_by: 'sender', groups: planGroups, totals: { sources: all.length, hot: planGroups.reduce((n, group) => n + group.hot, 0), warm: planGroups.reduce((n, group) => n + group.warm, 0), unmatched: 0, pages: planGroups.reduce((n, group) => n + group.pages, 0) }, max_pages: scenario === 'too-big' ? 1 : 5000 } as T;
    }
    if (path === '/export/all/part') {
      if (scenario === 'export-failed') throw new Error('Simulasi export gagal. Data asli tidak terpengaruh.');
      await sleep(1000);
      return { pages: exportPages[Number(body.index)] ?? 1, next_offset: null } as T;
    }
    if (path === '/export/all/cancel') return {} as T;
    throw new Error('Tindakan ini tidak tersedia dalam preview.');
  }

  const unsupported = async <T,>(): Promise<T> => { throw new Error('Perubahan data asli tidak tersedia dalam preview.'); };
  return { get, post, put: unsupported, del: unsupported, form: unsupported, blob: unsupported, file: async () => { await sleep(1000); return new Blob(['Preview only']); } };
}

export function RecentPreview({ children }: { children: (scenario: string) => ReactNode }) {
  const [scenario, setScenario] = useState<Scenario>('filled');
  const { navigate } = useRoute();
  const api = useMemo(() => createRecentPreviewApi(scenario), [scenario]);
  return <PreviewApiProvider api={api}>
    <div className="general-settings mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-separator pb-4">
      <div><p className="text-sm font-semibold">Preview Match Terbaru · Data dummy</p><p className="mt-1 text-xs text-muted">Filter, status, dan export disimulasikan. Data asli tidak berubah.</p></div>
      <div className="flex flex-wrap items-center gap-2"><select aria-label="Kondisi preview Match Terbaru" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} className="max-w-56">{SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><Button variant="secondary" onPress={() => navigate('match-baru')}>Keluar preview</Button></div>
    </div>
    <div onClickCapture={(event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('a[href*="wa.me"]')) { event.preventDefault(); event.stopPropagation(); toast('Simulasi tombol WhatsApp. Tidak membuka kontak dummy.'); }
    }}>{children(scenario)}</div>
  </PreviewApiProvider>;
}
