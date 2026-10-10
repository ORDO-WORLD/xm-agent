'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Accordion, Button, Chip, Label, SearchField, Switch, ToggleButton, ToggleButtonGroup, toast, useOverlayState } from '@heroui/react';
import { ArrowLeft, Building2, Download, FileText, ListChecks, ListFilter, SlidersHorizontal, Trash2, UsersRound, X } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, Panel, Segmented } from '@/components/app/primitives';
import { PeriodPicker, type Period, type Preset } from '@/components/app/period-picker';
import { useStatusActions } from '@/components/app/status-menu';
import { RecommendationCard, SourceCard } from '@/components/match/cards';
import { ExportAllModal } from '@/components/match/export-all-modal';
import { errorMessage, isAbort, query } from '@/lib/api';
import { STATUS_LABELS, cleanName, formatPhone, monthEnd, monthStart, mondayOf, number, shiftDay, shiftMonth, structuredSummary, todayWib } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData, useDebounced } from '@/lib/use-data';
import type { Direction, EntityStatus, Group, GroupBy, MatchFilter, Row, RowGroupSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

const PAGE = 200;
const TEMPS: { id: MatchFilter; label: string }[] = [{ id: 'hot', label: '🔥 Hot' }, { id: 'warm', label: '🌡️ Warm' }, { id: 'unmatched', label: 'Belum cocok' }];
const STOCK: { id: EntityStatus; label: string }[] = [{ id: 'ready', label: 'Ready' }, { id: 'on_hold', label: 'On-hold' }, { id: 'sold', label: 'Sold' }, { id: 'deleted', label: 'Dihapus' }];

function presets(): Preset[] {
  const today = todayWib();
  const monday = mondayOf(today);
  const lastMonthEnd = shiftDay(monthStart(today), -1);
  return [
    { id: 'all', label: 'Semua tanggal', range: () => ({ from: '', to: '' }) },
    { id: 'today', label: 'Hari ini', range: () => ({ from: today, to: today }) },
    { id: 'last_1_month', label: '1 bulan terakhir', range: () => ({ from: shiftMonth(today, -1), to: today }) },
    { id: 'last_3_months', label: '3 bulan terakhir', range: () => ({ from: shiftMonth(today, -3), to: today }) },
    { id: 'month', label: 'Bulan ini', range: () => ({ from: monthStart(today), to: monthEnd(today) }) },
    { id: 'week', label: 'Minggu ini', range: () => ({ from: monday, to: shiftDay(monday, 6) }) },
    { id: 'last_month', label: 'Bulan lalu', range: () => ({ from: monthStart(lastMonthEnd), to: lastMonthEnd }) },
  ];
}

type ListFilters = { temps: MatchFilter[]; stock: EntityStatus[]; buyerPeriod: Period; listingPeriod: Period; publicId: string; phones: string };
type RowsResponse = { rows: Row[]; has_more: boolean };
type Base = Record<string, string>;
const ALL_PERIOD: Period = { preset: 'all', from: '', to: '' };
const OPEN_FILTERS: Partial<ListFilters> = { buyerPeriod: ALL_PERIOD, listingPeriod: ALL_PERIOD, temps: ['hot', 'warm', 'unmatched'], stock: ['ready'], publicId: '', phones: '' };

function toggle<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

export default function MatchPage({ params, navigate }: { params?: URLSearchParams; navigate?: Navigate }) {
  const api = useApi();
  const { company } = useCompany();

  const [direction, setDirection] = useState<Direction>(params?.get('arah') === 'property' ? 'property' : 'buyer');
  // A link naming one item or one sales number must show everything of theirs, not only Hot/Warm matches that are still Ready.
  const fromLink = !!(params?.get('id') || params?.get('nomor'));
  const [filters, setFilters] = useState<ListFilters>({
    temps: fromLink ? ['hot', 'warm', 'unmatched'] : ['hot', 'warm'], stock: fromLink ? ['ready', 'on_hold', 'sold'] : ['ready'], buyerPeriod: ALL_PERIOD, listingPeriod: ALL_PERIOD, publicId: params?.get('id') ?? '', phones: params?.get('nomor') ?? '',
  });
  const [prefsReady, setPrefsReady] = useState(false);
  // Arriving with a specific ID or phone number: show the plain list so the card is right there.
  const [grouped, setGrouped] = useState(!params?.get('id') && !params?.get('nomor'));
  // Arriving from a link that names one item opens straight into its recommendations.
  const [mobileDetail, setMobileDetail] = useState(() => !!params?.get('id'));
  const [markers, setMarkers] = useState<Record<Direction, Record<string, number>>>({ buyer: {}, property: {} });
  const urlDirection = params?.get('arah');

  // Remember the last direction and the Hot/Warm choice per person.
  useEffect(() => {
    void api.get<{ direction: Direction; statuses: MatchFilter[] }>('/preferences').then((prefs) => {
      if (!urlDirection) setDirection(prefs.direction);
      if (prefs.statuses?.length && !fromLink) setFilters((current) => ({ ...current, temps: prefs.statuses }));
    }).catch(() => {}).finally(() => setPrefsReady(true));
  }, [api, urlDirection, fromLink]);
  useEffect(() => {
    if (!prefsReady || fromLink) return;
    const timer = window.setTimeout(() => { void api.put('/preferences', { direction, statuses: filters.temps.length ? filters.temps : ['hot', 'warm'] }).catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [api, direction, filters.temps, prefsReady, fromLink]);

  const groupBy: GroupBy = company?.listing_group_by ?? 'sender';
  const salesMode = company?.matching_mode === 'sales';
  const search = salesMode ? '' : (company?.effective_terms ?? []).join('\n');
  const debouncedId = useDebounced(filters.publicId, 350);
  const debouncedPhones = useDebounced(filters.phones, 500);
  const useGroups = direction === 'property' && grouped;
  const base = useMemo<Base>(() => ({
    direction, search, statuses: filters.temps.join(','), stock_status: filters.stock.join(',') || 'ready',
    public_id: debouncedId, phones: direction === 'property' ? (debouncedPhones || (salesMode ? company?.tracked_phones.join(',') ?? '' : '')) : '',
    buyer_date_from: filters.buyerPeriod.from, buyer_date_to: filters.buyerPeriod.to,
    listing_date_from: filters.listingPeriod.from, listing_date_to: filters.listingPeriod.to,
  }), [direction, search, salesMode, company?.tracked_phones, filters.temps, filters.stock, debouncedId, debouncedPhones, filters.buyerPeriod, filters.listingPeriod]);

  // Every change of a filter goes through here, so the open detail view closes with it.
  const update = (patch: Partial<ListFilters>) => { setFilters((current) => ({ ...current, ...patch })); setMobileDetail(false); };
  function changeDirection(next: Direction) {
    setDirection(next);
    setFilters((current) => ({ ...current, phones: '', publicId: '' }));
    setMobileDetail(false);
  }

  const loadMarkers = useCallback((kind: Direction, monthIso: string) => {
    void api.get<{ counts: Record<string, number> }>(`/workspace/dates?${query({ direction: kind, date_from: monthIso, date_to: shiftDay(monthIso, 62) })}`)
      .then((result) => setMarkers((current) => ({ ...current, [kind]: { ...current[kind], ...result.counts } }))).catch(() => {});
  }, [api]);

  const sourceLabel = direction === 'buyer' ? 'buyer' : 'listing';
  const targetLabel = direction === 'buyer' ? 'listing' : 'buyer';
  const filtersActive = (filters.stock.length !== 1 || filters.stock[0] !== 'ready' ? 1 : 0) + (filters.publicId ? 1 : 0) + (filters.phones ? 1 : 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Cocokkan" description={`Pilih satu ${sourceLabel} di daftar, lalu lihat ${targetLabel} yang paling cocok.`} />

      <fieldset aria-label="Arah pencocokan" className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
        {([['buyer', 'Buyer → Listing', 'Cari listing yang sesuai kebutuhan seorang buyer.', UsersRound], ['property', 'Listing → Buyer', 'Temukan buyer untuk sebuah listing.', Building2]] as const).map(([id, title, text, Icon]) => (
          <button key={id} type="button" aria-pressed={direction === id} onClick={() => changeDirection(id)}
            className={cn('flex items-start gap-3.5 rounded-2xl border p-4 text-left transition', direction === id ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/25' : 'border-border bg-surface hover:border-accent/50')}>
            <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', direction === id ? 'bg-accent text-accent-foreground' : 'bg-default text-muted')}><Icon className="size-5" aria-hidden="true" /></span>
            <span><span className="block text-lg font-bold">{title}</span><span className="mt-0.5 block text-base leading-snug text-muted">{text}</span></span>
          </button>
        ))}
      </fieldset>

      <Panel bodyClassName="space-y-4" className={cn(mobileDetail && 'hidden xl:block')}>
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-base font-bold"><ListFilter className="size-5 text-accent" aria-hidden="true" />Periode pencocokan</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onPress={() => update({ buyerPeriod: { preset: 'today', from: todayWib(), to: todayWib() }, listingPeriod: { preset: 'last_3_months', from: shiftMonth(todayWib(), -3), to: todayWib() } })}>Buyer hari ini × stok 3 bulan</Button>
            <Button variant="secondary" onPress={() => update({ buyerPeriod: { preset: 'last_1_month', from: shiftMonth(todayWib(), -1), to: todayWib() }, listingPeriod: { preset: 'today', from: todayWib(), to: todayWib() } })}>Listing hari ini × buyer 1 bulan</Button>
          </div>
          {([{ kind: 'buyer', key: 'buyerPeriod', label: 'Tanggal posting buyer' }, { kind: 'property', key: 'listingPeriod', label: 'Tanggal posting listing' }] as const).map(({ kind, key, label }) => (
            <div key={key} className="space-y-2">
              <p className="text-base font-semibold">{label}</p>
              <PeriodPicker label={label} value={filters[key]} onChange={(period) => update({ [key]: period })} presets={presets()} max={todayWib()} markers={markers[kind]} onMonthChange={(month) => loadMarkers(kind, month)} />
            </div>
          ))}
          <p className="text-sm text-muted">Periode buyer dan listing berlaku pada kedua arah pencocokan, termasuk hasil dan PDF. “Bulan lalu” adalah bulan kalender sebelumnya; “1 bulan terakhir” dihitung mundur dari hari ini.</p>
        </div>
        <div>
          <p className="mb-2 text-base font-bold">Tampilkan hasil</p>
          <ToggleButtonGroup aria-label="Jenis hasil" selectionMode="multiple" isDetached selectedKeys={new Set(filters.temps)} className="max-w-full flex-wrap gap-2"
            onSelectionChange={(keys) => update({ temps: [...keys] as MatchFilter[] })}>
            {TEMPS.map((item) => <ToggleButton key={item.id} id={item.id} className="min-h-11 px-4 text-[0.95rem] font-semibold">{item.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </div>
        <details className="group rounded-2xl border border-border bg-background" open={filtersActive > 0}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-base font-semibold">
            <span className="flex items-center gap-2"><SlidersHorizontal className="size-5 text-accent" aria-hidden="true" />Filter lainnya{filtersActive > 0 && <Chip color="accent" variant="soft" size="sm">{filtersActive} aktif</Chip>}</span>
            <span className="text-sm text-muted group-open:hidden">Buka</span><span className="hidden text-sm text-muted group-open:inline">Tutup</span>
          </summary>
          <div className="space-y-4 border-t border-border p-4">
            <div>
              <p className="mb-2 text-base font-bold">Status {sourceLabel} / {targetLabel}</p>
              <ToggleButtonGroup aria-label="Status stok" selectionMode="multiple" isDetached selectedKeys={new Set(filters.stock)} className="max-w-full flex-wrap gap-2"
                onSelectionChange={(keys) => update({ stock: ([...keys] as EntityStatus[]).length ? [...keys] as EntityStatus[] : ['ready'] })}>
                {STOCK.map((item) => <ToggleButton key={item.id} id={item.id} className="min-h-11 px-4 text-[0.95rem] font-semibold">{item.label}</ToggleButton>)}
              </ToggleButtonGroup>
              <p className="mt-1.5 text-sm text-muted">Standarnya hanya yang Ready. Pilih Sold, On-hold, atau Dihapus untuk melihat atau mengembalikan data itu.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SearchField value={filters.publicId} onChange={(value) => update({ publicId: value })} aria-label="Cari berdasarkan ID" name="id">
                <Label className="text-base font-bold">Cari ID</Label>
                <SearchField.Group><SearchField.SearchIcon /><SearchField.Input className="h-12 text-base" placeholder="mis. AB908 atau L-AB908" /><SearchField.ClearButton /></SearchField.Group>
              </SearchField>
              {direction === 'property' && (
                <SearchField value={filters.phones} onChange={(value) => update({ phones: value })} aria-label="Filter nomor sales" name="phones">
                  <Label className="text-base font-bold">Nomor sales</Label>
                  <SearchField.Group><SearchField.SearchIcon /><SearchField.Input className="h-12 text-base" placeholder="Pisahkan beberapa nomor dengan koma" inputMode="tel" /><SearchField.ClearButton /></SearchField.Group>
                </SearchField>
              )}
            </div>
          </div>
        </details>
        <p className="text-sm text-muted">{salesMode ? <>Mode Sales — watchlist company: <strong className="text-foreground">{company?.tracked_phones.join(' · ') || 'belum ada nomor'}</strong>.</> : <>Mode Company — pencarian kata kunci: <strong className="text-foreground">{(company?.effective_terms ?? []).join(' · ') || 'semua pesan'}</strong>{company?.search_locked ? ' (dikunci oleh super admin)' : ''}.</>} Ubah di <button type="button" className="font-semibold text-accent underline" onClick={() => navigate?.('pengaturan')}>Pengaturan</button>.</p>
      </Panel>

      {/* Remounting on every new list resets the selection, paging and open groups without any syncing effects. */}
      <MatchWorkspace
        key={`${JSON.stringify(base)}|${useGroups}|${groupBy}`}
        direction={direction} base={base} useGroups={useGroups} groupBy={groupBy} enabled={prefsReady && !!company}
        temps={filters.temps} grouped={grouped} onGrouped={setGrouped} canSetGrouping={!!company?.permissions.manage_settings}
        mobileDetail={mobileDetail} onMobileDetail={setMobileDetail} linkedId={params?.get('id') ?? ''}
        onReset={() => update(OPEN_FILTERS)}
      />
    </div>
  );
}

type WorkspaceProps = {
  direction: Direction; base: Base; useGroups: boolean; groupBy: GroupBy; enabled: boolean; temps: MatchFilter[];
  grouped: boolean; onGrouped: (value: boolean) => void; canSetGrouping: boolean; mobileDetail: boolean; onMobileDetail: (value: boolean) => void;
  linkedId: string; onReset: () => void;
};

function MatchWorkspace({ direction, base, useGroups, groupBy, enabled, temps, grouped, onGrouped, canSetGrouping, mobileDetail, onMobileDetail, linkedId, onReset }: WorkspaceProps) {
  const api = useApi();
  const [groupSearch, setGroupSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [includeHold, setIncludeHold] = useState(false);
  const [exports, setExports] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulk, setBulk] = useState<Record<string, Row>>({});
  const [selectingAll, setSelectingAll] = useState(false);
  const exportAll = useOverlayState();

  const bump = useCallback(() => setTick((value) => value + 1), []);
  const { request: requestStatus, dialog: statusDialog } = useStatusActions(bump);

  const flat = useData((signal) => api.get<RowsResponse>(`/workspace?${query({ ...base, offset })}`, signal), [base, offset, tick], enabled && !useGroups);
  const groups = useData((signal) => api.get<{ groups: RowGroupSummary[]; has_more: boolean }>(`/workspace/groups?${query({ ...base, group_by: groupBy, group_search: groupSearch })}`, signal),
    [base, groupBy, groupSearch, tick], enabled && useGroups);
  // A link from another page ("Buka di Cocokkan") that names exactly one item opens it without a click.
  const linked = !dismissed && linkedId && flat.data?.rows.length === 1 ? flat.data.rows[0] : null;
  const active = selected ?? linked;
  const recs = useData((signal) => api.post<{ groups: Group[] }>('/workspace/recommendations', {
    direction, ids: [active?.id], target_status: includeHold ? ['ready', 'on_hold'] : ['ready'],
    buyer_date_from: base.buyer_date_from, buyer_date_to: base.buyer_date_to,
    listing_date_from: base.listing_date_from, listing_date_to: base.listing_date_to,
  }, signal), [active?.id, direction, includeHold, tick, base], !!active);

  const select = useCallback((row: Row) => {
    setSelected(row);
    setExports([]);
    onMobileDetail(true);
    // Side by side on a wide screen the panel is already in view; on a phone it replaces the list.
    if (!window.matchMedia('(min-width: 1280px)').matches) window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, [onMobileDetail]);

  const group = recs.data?.groups[0];
  const visible = useMemo(() => (group?.recommendations ?? []).filter((row) => temps.includes(Number(row.score) >= 80 ? 'hot' : 'warm')), [group, temps]);
  const unmatched = !!group && group.recommendations.length === 0;
  const keyFor = (target?: Row) => `${group?.source.id}:${target?.id ?? ''}`;
  const keys = visible.length ? visible.map((target) => keyFor(target)) : unmatched ? [keyFor()] : [];
  const picked = exports.filter((key) => keys.includes(key));

  async function exportPdf() {
    setExporting(true);
    try {
      const pairs = picked.map((key) => { const [source_id, target_id] = key.split(':'); return { source_id, target_id: target_id || null }; });
      const blob = await api.blob('/export/pdf', { direction, pairs, target_status: includeHold ? ['ready', 'on_hold'] : ['ready'],
        buyer_date_from: base.buyer_date_from, buyer_date_to: base.buyer_date_to,
        listing_date_from: base.listing_date_from, listing_date_to: base.listing_date_to });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'Property-Matching-Report.pdf'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('PDF siap diunduh');
    } catch (reason) {
      toast.danger(errorMessage(reason, 'PDF belum dapat dibuat.'));
    } finally { setExporting(false); }
  }

  const sourceLabel = direction === 'buyer' ? 'buyer' : 'listing';
  const targetLabel = direction === 'buyer' ? 'listing' : 'buyer';
  const statusOf = (row: Row): EntityStatus => row.entity_status ?? 'ready';
  const refOf = (row: Row) => row.entity_id ?? row.public_id ?? '';
  const changeSource = (row: Row, status: EntityStatus) => {
    requestStatus({ refs: [refOf(row)], status, name: `${direction === 'buyer' ? 'Buyer' : 'Listing'} ${row.public_id ?? ''}`.trim(), previous: statusOf(row) });
    if (active?.id === row.id && status !== 'ready') { setSelected(null); setDismissed(true); onMobileDetail(false); }
  };
  const changeTarget = (row: Row, status: EntityStatus) => requestStatus({ refs: [refOf(row)], status, name: `${direction === 'buyer' ? 'Listing' : 'Buyer'} ${row.public_id ?? ''}`.trim(), previous: statusOf(row) });
  const bulkRows = Object.values(bulk);

  function applyBulk(status: EntityStatus) {
    if (!bulkRows.length) return;
    const previous = bulkRows.every((row) => statusOf(row) === statusOf(bulkRows[0])) ? statusOf(bulkRows[0]) : undefined;
    requestStatus({ refs: bulkRows.map(refOf), status, name: `${bulkRows.length} ${sourceLabel}`, previous });
    setBulk({});
    setBulkMode(false);
  }
  // The same buyer or listing can be shown through different copies of its message, so a choice follows the entity.
  const bulkKey = (row: Row) => row.entity_id ?? row.id;
  const bulkProps = (row: Row) => bulkMode ? { checked: !!bulk[bulkKey(row)], onToggle: () => setBulk((current) => { const next = { ...current }; if (next[bulkKey(row)]) delete next[bulkKey(row)]; else next[bulkKey(row)] = row; return next; }) } : undefined;

  /** Everything the filters return: later pages and unopened groups too, not only the cards on screen. */
  async function selectAll() {
    setSelectingAll(true);
    try {
      const all: Record<string, Row> = {};
      for (let next = 0; ; next += PAGE) {
        const page = await api.get<RowsResponse>(`/workspace?${query({ ...base, offset: next })}`);
        for (const row of page.rows) all[bulkKey(row)] = row;
        if (!page.has_more) break;
      }
      setBulk(all);
    } catch (reason) { toast.danger(errorMessage(reason, 'Belum dapat memilih semua. Coba lagi.')); } finally { setSelectingAll(false); }
  }
  const card = (row: Row, withSender = true) => (
    <SourceCard key={row.id} row={row} direction={direction} selected={active?.id === row.id} showSender={withSender}
      onSelect={() => select(row)} onStatus={(status) => changeSource(row, status)} bulk={bulkProps(row)} />
  );

  return (
    <>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(380px,42%)_1fr]">
        {/* ------------------------------------------------------------ list */}
        <section aria-label={`Daftar ${sourceLabel}`} aria-busy={useGroups ? groups.loading : flat.loading} className={cn('min-w-0 space-y-3', mobileDetail && 'hidden xl:block')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{direction === 'buyer' ? 'Buyer' : 'Listing'}{!useGroups && flat.data ? <span className="ml-2 text-base font-normal text-muted">{number(flat.data.rows.length)}{flat.data.has_more ? '+' : ''} ditampilkan</span> : null}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {direction === 'property' && (
                <Switch isSelected={grouped} onChange={onGrouped} aria-label="Kelompokkan listing per sales">
                  <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-[0.95rem] font-semibold">Per {groupBy === 'phone' ? 'nomor telepon' : 'pengirim'}</span></Switch.Content>
                </Switch>
              )}
              <Button variant={bulkMode ? 'primary' : 'secondary'} onPress={() => { setBulkMode((value) => !value); setBulk({}); }}><ListChecks className="size-4" aria-hidden="true" />{bulkMode ? 'Selesai memilih' : 'Pilih beberapa'}</Button>
              <Button variant="secondary" onPress={() => exportAll.open()}><Download className="size-4" aria-hidden="true" />Export semua PDF</Button>
            </div>
          </div>
          {direction === 'property' && grouped && canSetGrouping && <GroupBySwitch value={groupBy} />}

          {useGroups ? (
            <>
              <SearchField value={groupSearch} onChange={setGroupSearch} aria-label={groupBy === 'phone' ? 'Cari sales atau nomor' : 'Cari nama pengirim'}>
                <SearchField.Group><SearchField.SearchIcon /><SearchField.Input className="h-12 text-base" placeholder={groupBy === 'phone' ? 'Cari nama sales atau nomor' : 'Cari nama pengirim'} /><SearchField.ClearButton /></SearchField.Group>
              </SearchField>
              <ErrorNotice message={groups.error} onRetry={groups.reload} />
              {groups.loading && <LoadingRows rows={4} />}
              {!groups.loading && groups.data && groups.data.groups.length === 0 && <ListEmpty onReset={onReset} />}
              {!groups.loading && groups.data && groups.data.groups.length > 0 && (
                <Accordion allowsMultipleExpanded expandedKeys={expanded} onExpandedChange={setExpanded} className="w-full">
                  {groups.data.groups.map((item) => (
                    <Accordion.Item key={item.key || '__none'} id={item.key || '__none'}>
                      <Accordion.Heading>
                        <Accordion.Trigger className="min-h-16 py-3">
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left sm:flex-row sm:items-center sm:gap-3">
                            <span className="min-w-0 break-words text-base font-bold">{groupTitle(item, groupBy)}</span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Chip size="md" variant="soft">{number(item.count)} listing</Chip>
                              {item.hot > 0 && <Chip size="md" variant="soft" color="danger">🔥 {item.hot}</Chip>}
                              {item.warm > 0 && <Chip size="md" variant="soft" color="warning">🌡️ {item.warm}</Chip>}
                            </span>
                          </span>
                          <Accordion.Indicator />
                        </Accordion.Trigger>
                      </Accordion.Heading>
                      <Accordion.Panel>
                        <Accordion.Body>
                          {expanded.has(item.key || '__none') && <GroupRows key={tick} base={base} groupBy={groupBy} groupKey={item.key} render={(row) => card(row, false)} />}
                        </Accordion.Body>
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              )}
            </>
          ) : (
            <>
              <ErrorNotice message={flat.error} onRetry={flat.reload} />
              {flat.loading && <LoadingRows rows={5} />}
              {!flat.loading && flat.data && flat.data.rows.length === 0 && <ListEmpty onReset={onReset} />}
              {!flat.loading && <div className="space-y-3">{flat.data?.rows.map((row) => card(row))}</div>}
              {flat.data && (offset > 0 || flat.data.has_more) && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
                  <span className="text-base text-muted">Menampilkan {offset + 1}–{offset + flat.data.rows.length}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" isDisabled={!offset || flat.loading} onPress={() => setOffset(Math.max(0, offset - PAGE))}><ArrowLeft className="size-4" aria-hidden="true" />Sebelumnya</Button>
                    <Button variant="secondary" isDisabled={!flat.data.has_more || flat.loading} onPress={() => setOffset(offset + PAGE)}>Berikutnya</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* ----------------------------------------------------- recommendations */}
        <section aria-label={`Rekomendasi ${targetLabel}`} aria-busy={recs.loading} className={cn('min-w-0 xl:sticky xl:top-4', !mobileDetail && 'hidden xl:block')}>
          <div className="xm-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
              <div className="flex items-center gap-2">
                <Button isIconOnly variant="tertiary" className="xl:hidden" aria-label="Kembali ke daftar" onPress={() => { setDismissed(true); onMobileDetail(false); }}><ArrowLeft className="size-5" /></Button>
                <h2 className="text-lg font-bold capitalize">Rekomendasi {targetLabel}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Switch isSelected={includeHold} onChange={setIncludeHold} aria-label="Sertakan yang on-hold">
                  <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-[0.95rem] font-semibold">Sertakan on-hold</span></Switch.Content>
                </Switch>
                {keys.length > 0 && <button type="button" className="text-[0.95rem] font-semibold text-accent" onClick={() => setExports(picked.length === keys.length ? [] : keys.slice(0, 200))}>{picked.length === keys.length ? 'Batal pilih semua' : 'Pilih semua untuk PDF'}</button>}
              </div>
            </div>
            <div className="max-h-none space-y-3 bg-background p-3 sm:p-4 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto">
              {!active && <EmptyState animation="searching" title={`Pilih ${sourceLabel} di sebelah kiri`} description={`Hasil Hot, Warm, atau belum cocok untuk ${sourceLabel} itu akan muncul di sini.`} />}
              {active && recs.loading && <LoadingRows rows={2} />}
              <ErrorNotice message={recs.error} onRetry={recs.reload} />
              {!recs.loading && group && (
                <>
                  <div className="xm-card border-accent/30 bg-accent-soft/40 p-3.5">
                    <p className="text-sm font-semibold text-muted">Untuk {sourceLabel} ini</p>
                    <p className="mt-0.5 text-base font-bold">{cleanName(group.source.contact_name) || structuredSummary(group.source)}</p>
                    <p className="mt-1 text-[0.95rem] leading-relaxed text-foreground/80">{structuredSummary(group.source)}</p>
                  </div>
                  {unmatched && temps.includes('unmatched') && (
                    <div className="rounded-2xl border border-border bg-surface p-4 text-base">
                      <label className="flex items-center gap-3">
                        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={exports.includes(keyFor())} onChange={() => setExports((current) => toggle(current, keyFor()))} />
                        Belum ada {targetLabel} yang lolos batas pencocokan. Centang untuk memasukkan ke PDF.
                      </label>
                    </div>
                  )}
                  {unmatched && !temps.includes('unmatched') && <EmptyState compact animation="empty-box" title={`Belum ada ${targetLabel} yang cocok`} description="Aktifkan “Belum cocok” di filter untuk memasukkannya ke PDF." />}
                  {!unmatched && visible.length === 0 && <EmptyState compact animation="empty-box" title="Tidak ada hasil untuk jenis yang dipilih" description="Aktifkan Hot dan Warm di filter untuk melihat semua kecocokan." />}
                  {visible.map((target) => (
                    <RecommendationCard key={target.id} target={target} source={group.source} direction={direction}
                      checked={exports.includes(keyFor(target))} onCheck={() => setExports((current) => toggle(current, keyFor(target)))}
                      onStatus={(status) => changeTarget(target, status)} />
                  ))}
                </>
              )}
            </div>
            {active && (
              <div className="pb-safe sticky bottom-16 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-3 lg:bottom-0">
                <span className="text-base text-muted">{picked.length ? `${picked.length} dipilih untuk PDF` : 'Centang hasil untuk membuat PDF'}</span>
                <Button size="lg" isDisabled={!picked.length} isPending={exporting} onPress={exportPdf}><Download className="size-4" aria-hidden="true" />Unduh PDF ({picked.length})</Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {bulkMode && (
        <div className="pb-safe fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-3xl border border-border bg-surface p-3 shadow-2xl lg:inset-x-auto lg:bottom-6 lg:left-[calc(18rem+2.5rem)] lg:right-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 text-base font-bold">{number(bulkRows.length)} dipilih</span>
            <Button variant="secondary" isPending={selectingAll} onPress={selectAll}><ListChecks className="size-4" aria-hidden="true" />Pilih semua</Button>
            <Button variant="tertiary" isDisabled={!bulkRows.length || selectingAll} onPress={() => setBulk({})}>Batal pilih semua</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['ready', 'on_hold', 'sold'] as const).map((status) => <Button key={status} variant="secondary" isDisabled={!bulkRows.length} onPress={() => applyBulk(status)}>{STATUS_LABELS[status]}</Button>)}
            <Button variant="danger-soft" isDisabled={!bulkRows.length} onPress={() => applyBulk('deleted')}><Trash2 className="size-4" aria-hidden="true" />Hapus</Button>
            <Button isIconOnly variant="tertiary" aria-label="Batalkan pilihan" onPress={() => { setBulk({}); setBulkMode(false); }}><X className="size-5" /></Button>
          </div>
        </div>
      )}
      {statusDialog}
      <ExportAllModal state={exportAll} direction={direction} filters={base} />
    </>
  );
}

function groupTitle(item: RowGroupSummary, by: GroupBy) {
  if (by === 'phone') return item.key ? `${cleanName(item.contact_name) ? `${cleanName(item.contact_name)} · ` : ''}${formatPhone(item.key)}` : 'Tanpa nomor telepon';
  return item.key;
}

function ListEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="xm-card">
      <EmptyState animation="searching" title="Tidak ada data untuk filter ini" description="Coba pilih periode lain, aktifkan jenis hasil lain, atau hapus pencarian ID."
        action={<Button variant="secondary" size="lg" onPress={onReset}><FileText className="size-4" aria-hidden="true" />Reset filter</Button>} />
    </div>
  );
}

/** Company admins choose here what "per sales" means. Everyone else just sees the result. */
function GroupBySwitch({ value }: { value: GroupBy }) {
  const api = useApi();
  const { refresh } = useCompany();
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
      <span className="block text-[0.95rem] font-semibold">Kelompokkan listing menurut:</span>
      <Segmented label="Dasar pengelompokan" value={value} fullWidth options={[{ id: 'sender', label: 'Pengirim' }, { id: 'phone', label: 'Nomor telepon' }]}
        onChange={(next) => { void api.put('/company/settings', { listing_group_by: next }).then(() => { refresh(); toast.success('Pengelompokan diubah untuk seluruh company'); }).catch((reason) => toast.danger(errorMessage(reason))); }} />
    </div>
  );
}

/** The listings of one opened group, loaded only when it is opened. */
function GroupRows({ base, groupBy, groupKey, render }: { base: Base; groupBy: GroupBy; groupKey: string; render: (row: Row) => React.ReactNode }) {
  const api = useApi();
  const [extra, setExtra] = useState<Row[]>([]);
  const [next, setNext] = useState(PAGE);
  const [done, setDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const first = useData((signal) => api.get<RowsResponse>(`/workspace?${query({ ...base, group_by: groupBy, group_key: groupKey, offset: 0 })}`, signal), [base, groupBy, groupKey]);

  async function more() {
    setLoadingMore(true);
    try {
      const page = await api.get<RowsResponse>(`/workspace?${query({ ...base, group_by: groupBy, group_key: groupKey, offset: next })}`);
      setExtra((current) => [...current, ...page.rows]);
      setNext(next + PAGE);
      setDone(!page.has_more);
    } catch (reason) { if (!isAbort(reason)) toast.danger(errorMessage(reason)); } finally { setLoadingMore(false); }
  }

  if (first.error) return <ErrorNotice message={first.error} onRetry={first.reload} />;
  if (!first.data) return <LoadingRows rows={2} />;
  const rows = [...first.data.rows, ...extra];
  const hasMore = !done && first.data.has_more;
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="py-4 text-center text-base text-muted">Tidak ada listing dengan filter ini.</p>}
      {rows.map(render)}
      {hasMore && <Button variant="secondary" fullWidth isPending={loadingMore} onPress={more}>Muat lebih banyak</Button>}
    </div>
  );
}
