'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Dropdown, Label, toast, useOverlayState } from '@heroui/react';
import { Header } from 'react-aria-components';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Download, Flame, Search, Sparkles, Thermometer, Workflow, X } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingIndicator, LoadingRows } from '@/components/app/primitives';
import { RangeButton, type Period, type Preset } from '@/components/app/period-picker';
import { RecentSourceCard } from '@/components/match/recent-source-card';
import { useStatusActions } from '@/components/app/status-menu';
import { RecentDetailModal } from '@/components/match/recent-detail-modal';
import { ExportAllModal } from '@/components/match/export-all-modal';
import { BorderBeam } from '@/components/magicui/border-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { query } from '@/lib/api';
import { asWib, dateTime, mondayOf, number, prettyRange, shiftDay, todayWib } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData, useDebounced } from '@/lib/use-data';
import type { Direction, EntityStatus, RecentGroup, RecentResponse, Row, Temperature } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

type Summary = {
  unseen: number; unseen_hot: number; since: string;
  last_import: { import_id: string; found_at: string; total: number; hot: number; warm: number; agent_name: string | null; file_name: string | null } | null;
};
type Days = { days: Record<string, { total: number; hot: number; warm: number }>; latest_date: string | null };

function presets(): Preset[] {
  const today = todayWib();
  const monday = mondayOf(today);
  const month = `${today.slice(0, 8)}01`;
  return [
    { id: 'today', label: 'Hari ini', range: () => ({ from: today, to: today }) },
    { id: 'yesterday', label: 'Kemarin', range: () => ({ from: shiftDay(today, -1), to: shiftDay(today, -1) }) },
    { id: 'week', label: 'Minggu ini', range: () => ({ from: monday, to: today }) },
    { id: 'last_week', label: 'Minggu lalu', range: () => ({ from: shiftDay(monday, -7), to: shiftDay(monday, -1) }) },
    { id: 'month', label: 'Bulan ini', range: () => ({ from: month, to: today }) },
  ];
}

export default function RecentPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { markSeen, company } = useCompany();
  const today = todayWib();
  const [direction, setDirection] = useState<Direction>('buyer');
  const [temps, setTemps] = useState<Temperature[]>(['hot', 'warm']);
  const [period, setPeriod] = useState<Period>({ preset: 'today', from: today, to: today });
  const [includedStatuses, setIncludedStatuses] = useState<('on_hold' | 'sold')[]>([]);
  const stockStatus = ['ready', ...includedStatuses].join(',');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchTerm = useDebounced(search.trim().toLocaleLowerCase('id-ID'), 250);
  const scopeKey = JSON.stringify([company?.matching_mode, company?.search_terms, company?.tracked_phones]);
  const filterKey = [scopeKey, direction, period.from, period.to, temps.join(','), stockStatus, searchTerm].join('|');
  // Paging restarts by itself whenever a filter changes: the extra rows belong to one filter key.
  const [more, setMore] = useState({ key: '', extra: 0 });
  const limit = 30 + (more.key === filterKey ? more.extra : 0);
  const markerKey = `${scopeKey}|${direction}|${stockStatus}`;
  const [calendar, setCalendar] = useState<{ key: string; markers: Record<string, number>; latest: string | null }>({ key: '', markers: {}, latest: null });
  const markers = calendar.key === markerKey ? calendar.markers : {};
  const latest = calendar.key === markerKey ? calendar.latest : null;
  const currentMarkerKey = useRef(markerKey);
  useEffect(() => { currentMarkerKey.current = markerKey; }, [markerKey]);
  const [opened, setOpened] = useState<{ key: string; group: RecentGroup } | null>(null);
  const active = opened?.key === filterKey ? opened.group : null;
  const [selection, setSelection] = useState<{ key: string; ids: string[]; enabled: boolean }>({ key: '', ids: [], enabled: false });
  const selected = selection.key === filterKey ? selection.ids : [];
  const bulkMode = selection.key === filterKey && selection.enabled;
  const exportState = useOverlayState();
  const [exportFilters, setExportFilters] = useState<Record<string, unknown>>({});
  const [exportDirection, setExportDirection] = useState<Direction>('buyer');

  const summary = useData((signal) => api.get<Summary>(`/matches/recent/summary?${query({ direction })}`, signal), [scopeKey, direction]);
  const data = useData(async (signal) => {
    const groups: RecentGroup[] = [];
    let result: RecentResponse;
    for (let offset = 0; ; offset += 30) {
      result = await api.get<RecentResponse>(`/matches/recent?${query({ direction, date_from: period.from, date_to: period.to, temps: temps.join(','), stock_status: stockStatus, limit: 30, offset, per_source: 0 })}`, signal);
      groups.push(...result.groups);
      if (!result.has_more || (!searchTerm && groups.length >= limit)) break;
    }
    if (searchTerm) {
      const matched = groups.filter(({ source }) => [source.contact_name, source.author, source.public_id, source.contact_phone, source.raw_text, ...source.locations, ...source.categories].filter(Boolean).join(' ').toLocaleLowerCase('id-ID').includes(searchTerm));
      return { ...result, groups: matched.slice(0, limit), has_more: matched.length > limit, filterKey, searchSources: matched.map((group) => group.source.entity_id!), totals: { pairs: matched.reduce((n, group) => n + group.pair_count, 0), hot: matched.reduce((n, group) => n + group.hot_count, 0), warm: matched.reduce((n, group) => n + group.warm_count, 0) } };
    }
    return { ...result, groups, filterKey, searchSources: null };
  }, [filterKey, limit]);

  const results = data.data?.filterKey === filterKey ? data.data : undefined;

  // Reading the page counts as seeing the matches; give the person a moment first.
  const since = summary.data?.since;
  const marked = useRef(false);
  useEffect(() => {
    if (!summary.data || marked.current) return;
    const timer = window.setTimeout(() => { marked.current = true; markSeen(); }, 4000);
    return () => window.clearTimeout(timer);
  }, [summary.data, markSeen]);

  const loadMarkers = useCallback((monthIso: string) => {
    void api.get<Days>(`/matches/recent/days?${query({ direction, stock_status: stockStatus, date_from: monthIso, date_to: shiftDay(monthIso, 62) })}`).then((result) => {
      if (currentMarkerKey.current !== markerKey) return;
      setCalendar((current) => ({ key: markerKey, latest: result.latest_date, markers: { ...(current.key === markerKey ? current.markers : {}), ...Object.fromEntries(Object.entries(result.days).map(([day, value]) => [day, value.total])) } }));
    }).catch(() => {});
  }, [api, direction, stockStatus, markerKey]);
  useEffect(() => { loadMarkers(`${shiftDay(today, -45).slice(0, 8)}01`); }, [loadMarkers, today]);

  const totals = results?.totals;
  const last = summary.loading ? null : summary.data?.last_import;
  const isNew = useCallback((found: string) => !!since && new Date(found).getTime() > new Date(since).getTime(), [since]);
  const { request: requestStatus, dialog: statusDialog } = useStatusActions(() => { setOpened(null); data.reload(); summary.reload(); }, true);
  const changeStatus = (row: Row, status: EntityStatus) => requestStatus({ refs: [row.entity_id ?? row.id], status, previous: row.entity_status ?? 'ready', name: `${row.document_type === 'buyer_request' ? 'Buyer' : 'Listing'} ${row.public_id ?? ''}` });
  const exportResults = (pick: Record<string, unknown> = {}) => {
    if (searchTerm && results?.searchSources && results.searchSources.length > 200 && !pick.recent_sources && !pick.recent_events) { toast('Hasil pencarian melebihi 200 sumber. Persempit pencarian atau pilih kartu untuk export.'); return; }
    setExportDirection(direction);
    setExportFilters({ recent: true, direction, found_from: period.from, found_to: period.to, statuses: temps.join(','), stock_status: stockStatus, ...(searchTerm && results?.searchSources && !pick.recent_sources && !pick.recent_events ? { recent_sources: results.searchSources } : {}), ...pick });
    setOpened(null);
    exportState.open();
  };
  const toggleSource = (id: string) => {
    if (selected.length >= 200 && !selected.includes(id)) { toast('Maksimal 200 kartu per pilihan. Gunakan Export semua PDF untuk seluruh hasil.'); return; }
    setSelection({ key: filterKey, enabled: true, ids: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] });
  };


  return (
    <div className="general-settings recent-page space-y-5">
      {last && (
        <div className="relative overflow-hidden rounded-lg border border-accent/25 bg-gradient-to-br from-accent-soft to-surface p-4 sm:p-5">
          {!!summary.data?.unseen && <BorderBeam size={120} duration={8} colorFrom="#0a3be0" colorTo="#5dd0ea" />}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <LottiePlayer name="match-found" className="hidden w-28 shrink-0 sm:block" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-accent"><Sparkles className="size-4 shrink-0" aria-hidden="true" /><span>Upload terakhir pada {dateTime(last.found_at)}</span></p>
              <p className="mt-1 text-lg font-bold leading-snug">
                {last.file_name ?? 'Data chat'}{last.agent_name ? <span className="font-medium text-muted"> · {last.agent_name}</span> : null}
              </p>
              <p className="mt-0.5 text-base text-muted">Menghasilkan <strong className="text-foreground">{number(last.total)}</strong> match baru ({last.hot} Hot, {last.warm} Warm)</p>
            </div>
            <Button variant="primary" className="recent-upload-action" onPress={() => { const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(asWib(last.found_at) ?? new Date()); setPeriod({ preset: 'custom', from: day, to: day }); }}>Lihat hasil upload ini<ArrowRight className="size-4" aria-hidden="true" /></Button>
          </div>
        </div>
      )}

      <section className="recent-content" aria-label="Filter dan hasil match terbaru">
        <div className="recent-filter-row">
          <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari nama, ID, kontak, atau isi pesan" placeholder="Cari nama, ID, kontak, atau isi pesan..." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Hapus pencarian match" onClick={() => setSearch('')}><X className="size-4" /></button>}</div>
          <div className="recent-date-controls">
            <div className="recent-filter-select"><select aria-label="Tanggal ditemukan" value={period.preset} onChange={(event) => {
              const value = event.target.value;
              if (value === 'custom') { setPeriod((current) => ({ ...current, preset: 'custom' })); setCalendarOpen(true); return; }
              const preset = presets().find((item) => item.id === value);
              if (preset) { setPeriod({ preset: value, ...preset.range() }); setCalendarOpen(false); }
            }}>{presets().map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}<option value="custom">Pilih tanggal tertentu</option></select><ChevronDown className="size-4" aria-hidden="true" /></div>
            {period.preset === 'custom' && <RangeButton value={period} active={!!period.from} max={today} markers={markers} onMonthChange={loadMarkers} isOpen={calendarOpen} onOpenChange={setCalendarOpen} onChange={(range) => setPeriod({ preset: 'custom', ...range })} iconOnly highlightToday={false} helpText="Angka hijau di kalender = jumlah match baru pada hari itu." />}
          </div>
          <Dropdown><Dropdown.Trigger className="upload-history-sort recent-temperature-filter" aria-label="Jenis match dan status yang ditampilkan"><span>{temps.length === 2 ? 'Hot & Warm' : temps.length === 1 ? temps[0] === 'hot' ? 'Hot' : 'Warm' : 'Tampilkan'}{includedStatuses.length > 0 ? ` (+${includedStatuses.length})` : ''}</span><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger>
            <Dropdown.Popover placement="bottom start" className="upload-history-sort-menu recent-display-menu"><Dropdown.Menu aria-label="Tampilkan jenis match dan sertakan status" selectionMode="multiple" selectedKeys={new Set([...temps, ...includedStatuses])} onSelectionChange={(keys) => {
              const values = keys === 'all' ? ['hot', 'warm', 'on_hold', 'sold'] : [...keys];
              setTemps((['hot', 'warm'] as const).filter((value) => values.includes(value)));
              setIncludedStatuses((['on_hold', 'sold'] as const).filter((value) => values.includes(value)));
            }}>
              <Dropdown.Section>
                {([{ id: 'hot', label: 'Hot', icon: '🔥' }, { id: 'warm', label: 'Warm', icon: '🌡️' }] as const).map((item) => <Dropdown.Item key={item.id} id={item.id} textValue={item.label} shouldCloseOnSelect={false}><span className={temps.includes(item.id) ? 'recent-filter-checkbox is-checked' : 'recent-filter-checkbox'} aria-hidden="true">{temps.includes(item.id) && <Check className="size-3" />}</span><Label>{item.icon} {item.label}</Label></Dropdown.Item>)}
              </Dropdown.Section>
              <Dropdown.Section><Header className="recent-filter-section-heading">Sertakan</Header>
                {([{ id: 'on_hold', label: 'On-hold' }, { id: 'sold', label: 'Sold' }] as const).map((item) => <Dropdown.Item key={item.id} id={item.id} textValue={item.label} shouldCloseOnSelect={false}><span className={includedStatuses.includes(item.id) ? 'recent-filter-checkbox is-checked' : 'recent-filter-checkbox'} aria-hidden="true">{includedStatuses.includes(item.id) && <Check className="size-3" />}</span><Label>{item.label}</Label></Dropdown.Item>)}
              </Dropdown.Section>
            </Dropdown.Menu></Dropdown.Popover>
          </Dropdown>
          <Dropdown><Dropdown.Trigger className="upload-history-sort recent-direction-filter" aria-label="Arah pencocokan"><ArrowDownUp className="size-4" aria-hidden="true" /><span>{direction === 'buyer' ? 'Buyer → Listing' : 'Listing → Buyer'}</span><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="upload-history-sort-menu"><Dropdown.Menu aria-label="Arah pencocokan" selectionMode="single" selectedKeys={new Set([direction])} onAction={(key) => setDirection(String(key) as Direction)}>{([{ id: 'buyer', label: 'Buyer → Listing' }, { id: 'property', label: 'Listing → Buyer' }] as const).map((item) => <Dropdown.Item key={item.id} id={item.id} textValue={item.label} className={direction === item.id ? 'is-current' : ''}><Label>{item.label}</Label></Dropdown.Item>)}</Dropdown.Menu></Dropdown.Popover></Dropdown>

        </div>

      <p className="text-sm text-muted">{company?.matching_mode === 'sales' ? `Sumber ${direction === 'buyer' ? 'buyer' : 'listing'} wajib memiliki nomor sales dalam watchlist perusahaan.` : company?.search_terms?.length ? `Sumber ${direction === 'buyer' ? 'buyer' : 'listing'} wajib memuat keyword perusahaan: ${company.search_terms.join(', ')}.` : 'Menampilkan sumber dari data perusahaan ini.'} Aturan yang sama berlaku pada detail dan export.</p>

      {totals && (
        <div className="recent-summary-grid">
          <Mini label="Pasangan baru" value={totals.pairs} loading={data.loading} />
          <Mini label="Hot" value={totals.hot} tone="hot" loading={data.loading} />
          <Mini label="Warm" value={totals.warm} tone="warm" loading={data.loading} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-bold">Galeri {direction === 'buyer' ? 'buyer' : 'listing'}</p><p className="text-sm text-muted">Klik kartu untuk melihat detail dan hasil pencocokan.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" isDisabled={data.loading || !!data.error || !results?.groups.length} onPress={() => setSelection({ key: filterKey, enabled: !bulkMode, ids: [] })}>{bulkMode ? 'Selesai memilih' : 'Pilih beberapa'}</Button>
          <Button variant="primary" isDisabled={data.loading || !!data.error || !results?.groups.length} onPress={() => exportResults()}><Download className="size-4" aria-hidden="true" />Export semua PDF</Button>
        </div>
      </div>
      {bulkMode && <div className="recent-selection-bar">
        <span className="font-medium">{selected.length} kartu dipilih</span>
        <div className="recent-selection-actions"><button type="button" className="recent-selection-link" onClick={() => setSelection({ key: filterKey, enabled: true, ids: (results?.groups ?? []).map((group) => group.source.entity_id!).slice(0, 200) })}>Pilih kartu yang tampil</button><button type="button" className="recent-selection-link" onClick={() => setSelection({ key: filterKey, enabled: true, ids: [] })}>Kosongkan</button>
        <Button variant="primary" isDisabled={data.loading || !selected.length} onPress={() => exportResults({ recent_sources: selected })}><Download className="size-4" aria-hidden="true" />Export {selected.length} kartu PDF</Button>
        </div>
      </div>}
      <ErrorNotice message={data.error} onRetry={data.reload} />
      {data.loading && !results && <LoadingRows rows={3} />}
      {data.loading && results && <LoadingIndicator />}

      {!data.loading && results && results.groups.length === 0 && (
        <div className="recent-empty">
          <EmptyState animation="match-found" title={`Belum ada match baru pada ${prettyRange(results.date_from, results.date_to)}`}
            description={searchTerm ? 'Tidak ada sumber yang cocok dengan pencarian. Coba nama, ID, kontak, atau kata lain.' : temps.length === 0 ? 'Aktifkan Hot dan/atau Warm di atas.' : latest ? `Match terbaru terakhir ditemukan pada ${prettyRange(latest, latest)}.` : 'Match baru muncul otomatis setelah Anda mengunggah data chat dan ada pasangan buyer–listing baru.'}
            action={latest ? <Button variant="primary" size="lg" onPress={() => setPeriod({ preset: 'custom', from: latest, to: latest })}>Lihat {prettyRange(latest, latest)}</Button> : undefined} />
        </div>
      )}

      <div aria-busy={data.loading} inert={data.loading || !!data.error} className={cn('recent-gallery grid items-start gap-4 sm:grid-cols-2 2xl:grid-cols-3 transition-opacity', data.loading && results && 'opacity-60')}>
        {results?.groups.map((group) => (
          <RecentSourceCard key={group.source.entity_id} row={{ ...group.source, hot_count: group.hot_count, warm_count: group.warm_count, match_count: group.pair_count }} direction={direction} foundAt={group.latest_found_at} isNew={isNew(group.latest_found_at)} selected={active?.source.entity_id === group.source.entity_id} onSelect={() => setOpened({ key: filterKey, group })} onStatus={(status) => changeStatus(group.source, status)}
            bulk={bulkMode ? { checked: selected.includes(group.source.entity_id!), onToggle: () => toggleSource(group.source.entity_id!) } : undefined}
          />
        ))}
      </div>
      {results?.has_more && <Button variant="secondary" size="lg" fullWidth isDisabled={data.loading} onPress={() => setMore({ key: filterKey, extra: limit - 30 + 30 })}>Tampilkan lebih banyak</Button>}
      </section>
      {active && <RecentDetailModal key={filterKey + active.source.entity_id} group={active} direction={direction} filters={{ date_from: period.from, date_to: period.to, temps: temps.join(','), stock_status: stockStatus }} onClose={() => setOpened(null)} onStatus={changeStatus} onExport={(ids) => exportResults(ids ? { recent_events: ids } : { recent_sources: [active.source.entity_id] })} onManual={navigate ? () => { setOpened(null); navigate('cocokkan', { arah: direction, id: active.source.public_id }); } : undefined} />}
      <ExportAllModal state={exportState} direction={exportDirection} filters={exportFilters} />
      {statusDialog}
    </div>
  );
}

function Mini({ label, value, tone, loading }: { label: string; value: number; tone?: 'hot' | 'warm'; loading?: boolean }) {
  const Icon = tone === 'hot' ? Flame : tone === 'warm' ? Thermometer : Workflow;
  const color = tone === 'hot' ? '#ef4444' : tone === 'warm' ? '#f59e0b' : '#3a7bf0';
  return <article className="stock-summary" style={{ '--stock-summary-color': color } as CSSProperties}>
    <strong className="stock-summary-value">{loading ? <span className="animate-pulse" aria-label="Memuat jumlah hasil">...</span> : <NumberTicker value={value} key={value} />}</strong>
    <div className="stock-summary-label"><h2><span aria-hidden="true" />{label}</h2><p>{tone ? `Pasangan ${label}` : 'Sesuai filter yang dipilih'}</p></div>
    <Icon className="stock-summary-icon" aria-hidden="true" />
  </article>;
}
