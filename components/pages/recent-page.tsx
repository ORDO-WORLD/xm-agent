'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Switch, ToggleButton, ToggleButtonGroup, toast, useOverlayState } from '@heroui/react';
import { ArrowRight, Download, Sparkles } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingIndicator, LoadingRows, PageHeader, Panel, Segmented } from '@/components/app/primitives';
import { PeriodPicker, type Period, type Preset } from '@/components/app/period-picker';
import { SourceCard } from '@/components/match/cards';
import { useStatusActions } from '@/components/app/status-menu';
import { RecentDetailModal } from '@/components/match/recent-detail-modal';
import { ExportAllModal } from '@/components/match/export-all-modal';
import { BorderBeam } from '@/components/magicui/border-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { query } from '@/lib/api';
import { dateTime, mondayOf, number, prettyRange, shiftDay, todayWib } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
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
  const [includeInactive, setIncludeInactive] = useState(false);
  const filterKey = [direction, period.from, period.to, temps.join(','), includeInactive].join('|');
  // Paging restarts by itself whenever a filter changes: the extra rows belong to one filter key.
  const [more, setMore] = useState({ key: '', extra: 0 });
  const limit = 30 + (more.key === filterKey ? more.extra : 0);
  const [markers, setMarkers] = useState<Record<string, number>>({});
  const [latest, setLatest] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ key: string; group: RecentGroup } | null>(null);
  const active = opened?.key === filterKey ? opened.group : null;
  const [selection, setSelection] = useState<{ key: string; ids: string[]; enabled: boolean }>({ key: '', ids: [], enabled: false });
  const selected = selection.key === filterKey ? selection.ids : [];
  const bulkMode = selection.key === filterKey && selection.enabled;
  const exportState = useOverlayState();
  const [exportFilters, setExportFilters] = useState<Record<string, unknown>>({});
  const [exportDirection, setExportDirection] = useState<Direction>('buyer');

  const summary = useData((signal) => api.get<Summary>('/matches/recent/summary', signal), []);
  const data = useData(async (signal) => {
    const groups: RecentGroup[] = [];
    let result: RecentResponse;
    for (let offset = 0; ; offset += 30) {
      result = await api.get<RecentResponse>(`/matches/recent?${query({ direction, date_from: period.from, date_to: period.to, temps: temps.join(','), include_inactive: includeInactive, limit: 30, offset, per_source: 0 })}`, signal);
      groups.push(...result.groups);
      if (!result.has_more || groups.length >= limit) break;
    }
    return { ...result, groups };
  }, [filterKey, limit]);

  // Reading the page counts as seeing the matches; give the person a moment first.
  const since = summary.data?.since;
  const marked = useRef(false);
  useEffect(() => {
    if (!summary.data || marked.current) return;
    const timer = window.setTimeout(() => { marked.current = true; markSeen(); }, 4000);
    return () => window.clearTimeout(timer);
  }, [summary.data, markSeen]);

  const loadMarkers = useCallback((monthIso: string) => {
    void api.get<Days>(`/matches/recent/days?${query({ date_from: monthIso, date_to: shiftDay(monthIso, 62) })}`).then((result) => {
      setLatest(result.latest_date);
      setMarkers((current) => ({ ...current, ...Object.fromEntries(Object.entries(result.days).map(([day, value]) => [day, value.total])) }));
    }).catch(() => {});
  }, [api]);
  useEffect(() => { loadMarkers(`${shiftDay(today, -45).slice(0, 8)}01`); }, [loadMarkers, today]);

  const totals = data.data?.totals;
  const last = summary.data?.last_import;
  const isNew = useCallback((found: string) => !!since && new Date(found).getTime() > new Date(since).getTime(), [since]);
  const { request: requestStatus, dialog: statusDialog } = useStatusActions(() => { setOpened(null); data.reload(); summary.reload(); });
  const changeStatus = (row: Row, status: EntityStatus) => requestStatus({ refs: [row.entity_id ?? row.id], status, previous: row.entity_status ?? 'ready', name: `${row.document_type === 'buyer_request' ? 'Buyer' : 'Listing'} ${row.public_id ?? ''}` });
  const exportResults = (pick: Record<string, unknown> = {}) => {
    setExportDirection(direction);
    setExportFilters({ recent: true, direction, found_from: period.from, found_to: period.to, statuses: temps.join(','), stock_status: includeInactive ? 'ready,on_hold,sold' : 'ready', ...pick });
    setOpened(null);
    exportState.open();
  };
  const toggleSource = (id: string) => {
    if (selected.length >= 200 && !selected.includes(id)) { toast('Maksimal 200 kartu per pilihan. Gunakan Export semua PDF untuk seluruh hasil.'); return; }
    setSelection({ key: filterKey, enabled: true, ids: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] });
  };


  return (
    <div className="space-y-5">
      <PageHeader title="Match Terbaru" description="Pasangan buyer dan listing yang baru ditemukan setiap kali Anda mengunggah data chat. Pilih tanggal, lalu klik kartu untuk melihat sumber dan pasangan hasilnya." />

      {last && (
        <div className="relative overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-accent-soft to-surface p-4 sm:p-5">
          {!!summary.data?.unseen && <BorderBeam size={120} duration={8} colorFrom="#0a3be0" colorTo="#5dd0ea" />}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <LottiePlayer name="match-found" className="hidden w-28 shrink-0 sm:block" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-bold text-accent"><Sparkles className="size-4" aria-hidden="true" />Upload terakhir</p>
              <p className="mt-1 text-lg font-bold leading-snug">
                {last.file_name ?? 'Data chat'}{last.agent_name ? <span className="font-medium text-muted"> · {last.agent_name}</span> : null}
              </p>
              <p className="mt-0.5 text-base text-muted">{dateTime(last.found_at)} · menghasilkan <strong className="text-foreground">{number(last.total)}</strong> match baru ({last.hot} Hot, {last.warm} Warm)</p>
            </div>
            <Button variant="primary" size="lg" onPress={() => { const day = last.found_at.slice(0, 10); setPeriod({ preset: 'custom', from: day, to: day }); }}>Lihat hasil upload ini<ArrowRight className="size-4" aria-hidden="true" /></Button>
          </div>
        </div>
      )}

      <Panel bodyClassName="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Arah" value={direction} onChange={setDirection} options={[{ id: 'buyer', label: 'Buyer → Listing' }, { id: 'property', label: 'Listing → Buyer' }]} />
        </div>
        <div>
          <p className="mb-2 text-base font-bold">Tanggal ditemukan</p>
          <PeriodPicker value={period} onChange={setPeriod} presets={presets()} max={today} markers={markers} onMonthChange={loadMarkers} />
          <p className="mt-2 text-sm text-muted">{prettyRange(period.from, period.to)} · angka hijau di kalender = jumlah match baru pada hari itu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="mb-2 text-base font-bold">Tampilkan</p>
            <ToggleButtonGroup aria-label="Jenis match" selectionMode="multiple" isDetached selectedKeys={new Set(temps)} onSelectionChange={(keys) => setTemps([...keys] as Temperature[])}>
              <ToggleButton id="hot" className="min-h-11 px-4 font-semibold">🔥 Hot</ToggleButton>
              <ToggleButton id="warm" className="min-h-11 px-4 font-semibold">🌡️ Warm</ToggleButton>
            </ToggleButtonGroup>
          </div>
          <Switch isSelected={includeInactive} onChange={setIncludeInactive} className="self-end pb-2">
            <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-[0.95rem] font-semibold">Sertakan on-hold &amp; sold</span></Switch.Content>
          </Switch>
        </div>
      </Panel>

      <p className="text-sm text-muted">{company?.matching_mode === 'sales' ? 'Hanya pasangan dengan setidaknya satu nomor sales dalam watchlist perusahaan.' : company?.search_terms?.length ? `Hanya pasangan dengan setidaknya satu pesan yang memuat keyword perusahaan: ${company.search_terms.join(', ')}.` : 'Menampilkan pasangan dari data perusahaan ini.'} Aturan perusahaan juga berlaku pada riwayat dan export.</p>

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Pasangan baru" value={totals.pairs} loading={data.loading} />
          <Mini label="🔥 Hot" value={totals.hot} tone="hot" loading={data.loading} />
          <Mini label="🌡️ Warm" value={totals.warm} tone="warm" loading={data.loading} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-bold">Galeri {direction === 'buyer' ? 'buyer' : 'listing'}</p><p className="text-sm text-muted">Klik kartu untuk melihat detail dan hasil pencocokan.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" isDisabled={data.loading || !!data.error || !data.data?.groups.length} onPress={() => setSelection({ key: filterKey, enabled: !bulkMode, ids: [] })}>{bulkMode ? 'Selesai memilih' : 'Pilih beberapa'}</Button>
          <Button variant="primary" isDisabled={data.loading || !!data.error || !data.data?.groups.length} onPress={() => exportResults()}><Download className="size-4" aria-hidden="true" />Export semua PDF</Button>
        </div>
      </div>
      {bulkMode && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/25 bg-accent-soft p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{selected.length} kartu dipilih</span><Button variant="tertiary" onPress={() => setSelection({ key: filterKey, enabled: true, ids: (data.data?.groups ?? []).map((group) => group.source.entity_id!).slice(0, 200) })}>Pilih kartu yang tampil</Button><Button variant="tertiary" onPress={() => setSelection({ key: filterKey, enabled: true, ids: [] })}>Kosongkan</Button></div>
        <Button variant="primary" isDisabled={data.loading || !selected.length} onPress={() => exportResults({ recent_sources: selected })}><Download className="size-4" aria-hidden="true" />Export {selected.length} kartu PDF</Button>
      </div>}
      <ErrorNotice message={data.error} onRetry={data.reload} />
      {data.loading && !data.data && <LoadingRows rows={3} />}
      {data.loading && data.data && <LoadingIndicator />}

      {!data.loading && data.data && data.data.groups.length === 0 && (
        <div className="xm-card">
          <EmptyState animation="match-found" title={`Belum ada match baru pada ${prettyRange(data.data.date_from, data.data.date_to)}`}
            description={temps.length === 0 ? 'Aktifkan Hot dan/atau Warm di atas.' : latest ? `Match terbaru terakhir ditemukan pada ${prettyRange(latest, latest)}.` : 'Match baru muncul otomatis setelah Anda mengunggah data chat dan ada pasangan buyer–listing baru.'}
            action={latest ? <Button variant="primary" size="lg" onPress={() => setPeriod({ preset: 'custom', from: latest, to: latest })}>Lihat {prettyRange(latest, latest)}</Button> : undefined} />
        </div>
      )}

      <div aria-busy={data.loading} inert={data.loading || !!data.error} className={cn('grid items-start gap-4 sm:grid-cols-2 2xl:grid-cols-3 transition-opacity', data.loading && data.data && 'opacity-60')}>
        {data.data?.groups.map((group) => (
          <SourceCard key={group.source.entity_id} row={{ ...group.source, hot_count: group.hot_count, warm_count: group.warm_count, match_count: group.pair_count }} direction={direction} selected={active?.source.entity_id === group.source.entity_id} onSelect={() => setOpened({ key: filterKey, group })} onStatus={(status) => changeStatus(group.source, status)} showSender
            bulk={bulkMode ? { checked: selected.includes(group.source.entity_id!), onToggle: () => toggleSource(group.source.entity_id!) } : undefined}
            extra={<div className="mt-3 border-t border-separator pt-3"><p className="text-sm text-muted">Ditemukan {dateTime(group.latest_found_at)}{isNew(group.latest_found_at) ? ' · Baru' : ''}</p><p className="mt-1 text-sm font-semibold text-accent">Lihat {number(group.pair_count)} hasil pencocokan →</p></div>} />
        ))}
      </div>
      {data.data?.has_more && <Button variant="secondary" size="lg" fullWidth isDisabled={data.loading} onPress={() => setMore({ key: filterKey, extra: limit - 30 + 30 })}>Tampilkan lebih banyak</Button>}
      {active && <RecentDetailModal key={filterKey + active.source.entity_id} group={active} direction={direction} filters={{ date_from: period.from, date_to: period.to, temps: temps.join(','), include_inactive: includeInactive }} onClose={() => setOpened(null)} onStatus={changeStatus} onExport={(ids) => exportResults(ids ? { recent_events: ids } : { recent_sources: [active.source.entity_id] })} onManual={navigate ? () => { setOpened(null); navigate('cocokkan', { arah: direction, id: active.source.public_id }); } : undefined} />}
      <ExportAllModal state={exportState} direction={exportDirection} filters={exportFilters} />
      {statusDialog}
    </div>
  );
}

function Mini({ label, value, tone, loading }: { label: string; value: number; tone?: 'hot' | 'warm'; loading?: boolean }) {
  return (
    <div className="xm-card p-3.5 text-center sm:p-4">
      <p className="text-sm font-semibold text-muted sm:text-base">{label}</p>
      <p className={cn('mt-0.5 text-3xl font-bold tracking-tight', tone === 'hot' && 'text-hot', tone === 'warm' && 'text-amber-700')}>{loading ? <span className="animate-pulse text-muted" aria-label="Memuat jumlah hasil">…</span> : <NumberTicker value={value} key={value} />}</p>
    </div>
  );
}
