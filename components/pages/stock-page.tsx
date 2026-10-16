'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Avatar, Button, Dropdown, Label, Tabs, toast, useOverlayState } from '@heroui/react';
import { ArrowDownUp, BadgeCheck, Boxes, CheckCircle2, ChevronDown, ClipboardList, Clock3, Download, Eye, History, Pencil, PhoneCall, Plus, Search, Tag, UploadCloud, X } from 'lucide-react';
import { BarsChart, Sparkline } from '@/components/charts/charts';
import { colors } from '@/components/charts/chart-setup';
import { EmptyState, ErrorNotice, LoadingIndicator, LoadingRows } from '@/components/app/primitives';
import { SalesListingsModal } from '@/components/app/sales-listings-modal';
import { TrackedEditor } from '@/components/app/tracked-editor';
import { RangeButton, type Period } from '@/components/app/period-picker';
import { errorMessage, query } from '@/lib/api';
import { cleanName, dateTime, formatPhone, initials, number, relativeDate, shiftDay, todayWib } from '@/lib/format';
import { useRoute, type Navigate } from '@/lib/router';
import { SettingsPagination, useTableViewport } from '@/components/settings/settings-pagination';
import { useCompany } from '@/lib/session';
import { useData, useDebounced } from '@/lib/use-data';
import type { StockLogRow, StockOverview, StockTracked } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

const EVENT = {
  import: { label: 'Upload data baru', icon: UploadCloud, tone: 'blue' },
  status: { label: 'Status listing berubah', icon: Tag, tone: 'amber' },
  tracking: { label: 'Mulai dipantau', icon: Eye, tone: 'green' },
  manual: { label: 'Dicatat manual', icon: Pencil, tone: 'slate' },
} as const;

const salesName = (item: { label: string | null; contact_name: string | null; phone: string }) => item.label || cleanName(item.contact_name) || 'Sales';

export default function StockPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { params, navigate: go } = useRoute();
  const open = navigate ?? go;
  const tab = params.get('tab') === 'analytic' ? 'analytic' : 'list';
  const viewport = useTableViewport();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { company, refresh } = useCompany();
  const canEdit = !!company?.permissions.manage_settings;
  const [tick, setTick] = useState(0);
  const editor = useOverlayState();
  const listings = useOverlayState();
  const [viewing, setViewing] = useState<StockTracked | null>(null);
  const [phone, setPhone] = useState('');
  const [period, setPeriod] = useState<Period>({ preset: 'all', from: '', to: '' });
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const searchTerm = useDebounced(search.trim().toLocaleLowerCase('id-ID'), 250);
  const [sort, setSort] = useState('newest');
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const overview = useData((signal) => api.get<StockOverview>('/stock/overview', signal), [tick]);
  const log = useData(async (signal) => {
    const rows: StockLogRow[] = [];
    let hasMore = true;
    while (hasMore) {
      const page = await api.get<{ rows: StockLogRow[]; has_more: boolean }>(`/stock/log?${query({ phone, date_from: period.from, date_to: period.to, limit: 200, offset: rows.length })}`, signal);
      rows.push(...page.rows);
      hasMore = page.has_more && page.rows.length > 0;
    }
    return { rows };
  }, [phone, period.from, period.to, tick], tab === 'analytic');

  const tracked = useMemo(() => overview.data?.tracked ?? [], [overview.data]);
  const totals = overview.data?.totals;
  const chartRows = useMemo(() => tracked.map((item) => ({ name: salesName(item), ...item.counts })), [tracked]);

  const nameOf = (row: StockLogRow) => salesName({ label: row.label, contact_name: tracked.find((item) => item.phone === row.phone)?.contact_name ?? null, phone: row.phone });
  const filteredLog = (log.data?.rows ?? []).filter((row) => `${nameOf(row)} ${row.phone} ${formatPhone(row.phone)} ${row.agent_name ?? ''} ${EVENT[row.event_type].label}`.toLocaleLowerCase('id-ID').includes(searchTerm)).sort((a, b) => {
    if (sort === 'oldest') return Date.parse(a.logged_at) - Date.parse(b.logged_at);
    if (sort === 'sales-asc') return nameOf(a).localeCompare(nameOf(b), 'id');
    if (sort === 'sales-desc') return nameOf(b).localeCompare(nameOf(a), 'id');
    if (sort === 'ready') return b.ready - a.ready;
    if (sort === 'on-hold') return b.on_hold - a.on_hold;
    if (sort === 'sold') return b.sold - a.sold;
    if (sort === 'total') return b.total - a.total;
    return Date.parse(b.logged_at) - Date.parse(a.logged_at);
  });
  const currentLogPage = Math.min(logPage, Math.max(1, Math.ceil(filteredLog.length / logPageSize)));
  const logRows = filteredLog.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);
  const sortOptions = [{ id: 'newest', label: 'Terbaru' }, { id: 'oldest', label: 'Terlama' }, { id: 'sales-asc', label: 'Sales: A-Z' }, { id: 'sales-desc', label: 'Sales: Z-A' }, { id: 'ready', label: 'Ready terbanyak' }, { id: 'on-hold', label: 'On-hold terbanyak' }, { id: 'sold', label: 'Sold terbanyak' }, { id: 'total', label: 'Total terbanyak' }];

  async function snapshot() {
    setSnapshotBusy(true);
    try {
      const result = await api.post<{ logged: number }>('/stock/snapshot');
      toast.success(`${result.logged} catatan stok ditambahkan`);
      setTick((value) => value + 1);
    } catch (reason) { toast.danger(errorMessage(reason)); } finally { setSnapshotBusy(false); }
  }

  const today = todayWib();

  /** Excel of the listings: every tracked sales, or only the one given. */
  async function download(item?: StockTracked) {
    setDownloading(item?.phone ?? 'all');
    try {
      const blob = await api.file(`/stock/export?${query({ phone: item?.phone })}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const who = item ? salesName(item).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || item.phone : 'semua_sales';
      link.href = url; link.download = `stok_listing_${who}_${today}.xlsx`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Excel siap diunduh');
    } catch (reason) {
      toast.danger(errorMessage(reason, 'Excel belum dapat dibuat.'));
    } finally { setDownloading(null); }
  }
  const presets = [
    { id: 'all', label: 'Semua catatan', range: () => ({ from: '', to: '' }) },
    { id: '7', label: '7 hari terakhir', range: () => ({ from: shiftDay(today, -6), to: today }) },
    { id: '30', label: '30 hari terakhir', range: () => ({ from: shiftDay(today, -29), to: today }) },
  ];

  return <div className="general-settings stock-page">
    <Tabs className="settings-tabs stock-tabs" selectedKey={tab} onSelectionChange={(key) => open('stok', { tab: String(key) })} variant="secondary">
      <div className="stock-tab-bar">
        <div className="xm-scroll-x min-w-0"><Tabs.List aria-label="Bagian stok sales">
          <Tabs.Tab id="list">List Stok<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="analytic">Analytic Stok<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List></div>
        <div className="stock-header-actions">
          {tab === 'list' ? <>
            {tracked.length > 0 && <Button variant="secondary" isPending={downloading === 'all'} isDisabled={!!downloading} onPress={() => download()}><Download className="size-4" aria-hidden="true" />Download semua</Button>}
            {canEdit && <Button onPress={() => editor.open()}><PhoneCall className="size-4" aria-hidden="true" />Atur nomor sales</Button>}
          </> : canEdit && <Button variant="secondary" isPending={snapshotBusy} isDisabled={!tracked.length} onPress={snapshot}><ClipboardList className="size-4" aria-hidden="true" />Catat sekarang</Button>}
        </div>
      </div>
      <ErrorNotice message={overview.error} onRetry={overview.reload} />
      {overview.loading && !overview.data && <LoadingRows rows={3} />}
      <Tabs.Panel id="list">
        {overview.data && <div className="stock-summary-grid">
          {([
            { label: 'Total listing', value: totals?.total ?? 0, hint: `${tracked.length} nomor sales dipantau`, icon: Boxes, color: '#3a7bf0' },
            { label: 'Ready', value: totals?.ready ?? 0, hint: 'Listing tersedia', icon: CheckCircle2, color: '#059669' },
            { label: 'On-hold', value: totals?.on_hold ?? 0, hint: 'Listing sedang ditahan', icon: Clock3, color: '#f59e0b' },
            { label: 'Sold', value: totals?.sold ?? 0, hint: 'Listing terjual', icon: BadgeCheck, color: '#3a7bf0' },
          ]).map((summary) => <article key={summary.label} className="stock-summary" style={{ '--stock-summary-color': summary.color } as CSSProperties}>
            <strong className="stock-summary-value">{number(summary.value)}</strong>
            <div className="stock-summary-label"><h2><span aria-hidden="true" />{summary.label}</h2><p>{summary.hint}</p></div>
            <summary.icon className="stock-summary-icon" aria-hidden="true" />
          </article>)}
        </div>}
        {overview.data && tracked.length === 0 && <EmptyState compact animation="searching" title="Belum ada nomor sales yang dipantau" description={canEdit ? 'Tambahkan nomor sales untuk mulai memantau stok listing perusahaan.' : 'Super admin company dapat menambahkan nomor sales yang ingin dipantau.'} action={canEdit ? <Button onPress={() => editor.open()}><Plus className="size-4" />Tambah nomor sales</Button> : undefined} />}
        {tracked.length > 0 && <ul className="team-member-grid">{tracked.map((item) => <SalesCard key={item.phone} item={item} onOpen={() => { setViewing(item); listings.open(); }} onDownload={() => download(item)} downloading={downloading === item.phone} busy={!!downloading} />)}</ul>}
      </Tabs.Panel>
      <Tabs.Panel id="analytic">
        {overview.data && <section className="stock-comparison" aria-label="Perbandingan stok antar sales">
          <h2 className="text-base font-semibold">Perbandingan stok antar sales</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Jumlah listing Ready, On-hold, dan Sold per nomor sales.</p>
          {tracked.length > 1 ? <BarsChart horizontal stacked height={Math.max(220, tracked.length * 58)} ariaLabel="Diagram batang bertumpuk stok per sales" labels={chartRows.map((row) => row.name)} series={[{ label: 'Ready', data: chartRows.map((row) => row.ready), color: colors.green }, { label: 'On-hold', data: chartRows.map((row) => row.on_hold), color: colors.amber }, { label: 'Sold', data: chartRows.map((row) => row.sold), color: colors.blue }]} /> : <EmptyState compact title="Belum cukup sales untuk dibandingkan" description="Pantau minimal dua nomor sales untuk melihat perbandingan stok." />}
        </section>}
        <section className="stock-log-section" aria-label="Riwayat pencatatan stok">
          <h2 className="flex items-center gap-2 text-base font-semibold"><History className="size-4" aria-hidden="true" />Riwayat pencatatan stok</h2>
          <div className="stock-log-filters">
            <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari sales, nomor, atau kejadian" placeholder="Cari sales, nomor, atau kejadian..." value={search} onChange={(event) => { setSearch(event.target.value); setLogPage(1); }} />{search && <button type="button" aria-label="Hapus pencarian" onClick={() => { setSearch(''); setLogPage(1); }}><X className="size-4" /></button>}</div>
            <div className="stock-log-select"><select aria-label="Filter sales" value={phone} onChange={(event) => { setPhone(event.target.value); setLogPage(1); }}><option value="">Semua sales</option>{tracked.map((item) => <option key={item.phone} value={item.phone}>{salesName(item)} - {formatPhone(item.phone)}</option>)}</select></div>
            <div className="stock-log-select"><select aria-label="Filter periode riwayat stok" value={period.preset} onChange={(event) => {
              const value = event.target.value;
              if (value === 'custom') { setPeriod((current) => ({ ...current, preset: 'custom' })); setCalendarOpen(true); return; }
              const preset = presets.find((item) => item.id === value);
              if (preset) { setPeriod({ preset: value, ...preset.range() }); setLogPage(1); setCalendarOpen(false); }
            }}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}<option value="custom">Pilih tanggal</option></select></div>
            <Dropdown><Dropdown.Trigger className="upload-history-sort" aria-label="Urutkan riwayat stok"><ArrowDownUp className="size-4" aria-hidden="true" /><span>{sortOptions.find((item) => item.id === sort)?.label}</span><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="upload-history-sort-menu"><Dropdown.Menu aria-label="Urutan riwayat stok" selectionMode="single" selectedKeys={new Set([sort])} onAction={(key) => { setSort(String(key)); setLogPage(1); }}>{sortOptions.map((item) => <Dropdown.Item key={item.id} id={item.id} textValue={item.label} className={sort === item.id ? 'is-current' : ''}><Label>{item.label}</Label></Dropdown.Item>)}</Dropdown.Menu></Dropdown.Popover></Dropdown>
            {period.preset === 'custom' && <RangeButton value={period} active={!!period.from} max={today} isOpen={calendarOpen} onOpenChange={setCalendarOpen} onChange={(range) => { setPeriod({ preset: 'custom', ...range }); setLogPage(1); }} />}
          </div>
          <ErrorNotice message={log.error} onRetry={log.reload} />
          {log.loading && !log.data && <LoadingRows rows={3} />}
          {log.loading && log.data && <LoadingIndicator />}
          {!log.loading && !log.error && filteredLog.length === 0 && <EmptyState compact title="Belum ada catatan pada filter ini" />}
          {filteredLog.length > 0 && <div className={cn('activity-data', log.loading && 'opacity-60')} aria-busy={log.loading}>
            {viewport === 'mobile' ? <ul className="activity-mobile-cards">{logRows.map((row) => <LogCard key={row.id} row={row} name={salesName({ label: row.label, contact_name: tracked.find((item) => item.phone === row.phone)?.contact_name ?? null, phone: row.phone })} />)}</ul> : <div className="sales-table-wrap"><table className="sales-table activity-table stock-log-table" aria-label="Riwayat pencatatan stok">
              <thead><tr>{['Waktu', 'Sales', 'Kejadian', 'Ready', 'On-hold', 'Sold', 'Total'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{logRows.map((row) => <tr key={row.id}>
                <td className="activity-time">{dateTime(row.logged_at)}</td><td><strong className="activity-actor">{salesName({ label: row.label, contact_name: tracked.find((item) => item.phone === row.phone)?.contact_name ?? null, phone: row.phone })}</strong><span className="activity-secondary">{formatPhone(row.phone)}</span></td>
                <td>{EVENT[row.event_type].label}{row.event_type === 'import' && row.agent_name && <span className="activity-secondary">{row.agent_name}</span>}</td>
                <td style={{ color: colors.green }}>{number(row.ready)} <Delta value={row.delta_ready} /></td><td style={{ color: colors.amber }}>{number(row.on_hold)}</td><td style={{ color: colors.blue }}>{number(row.sold)}</td><td>{number(row.total)} <Delta value={row.delta_total} /></td>
              </tr>)}</tbody>
            </table></div>}
            <SettingsPagination total={filteredLog.length} label="catatan stok" page={currentLogPage} pageSize={logPageSize} onPage={setLogPage} onPageSize={(size) => { setLogPageSize(size); setLogPage(1); }} />
          </div>}
        </section>
      </Tabs.Panel>
    </Tabs>
    <SalesListingsModal state={listings} phone={viewing?.phone ?? ''} name={viewing ? salesName(viewing) : ''} />
    <TrackedEditor state={editor} current={tracked} onSaved={() => { setTick((value) => value + 1); refresh(); }} />
  </div>;
}

function Delta({ value }: { value: number }) {
  if (!value) return null;
  return <span className={cn('rounded-full px-1.5 py-0.5 text-sm font-bold', value > 0 ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground')}>{value > 0 ? '+' : '−'}{Math.abs(value)}</span>;
}

function SalesCard({ item, onOpen, onDownload, downloading, busy }: { item: StockTracked; onOpen: () => void; onDownload: () => void; downloading: boolean; busy: boolean }) {
  const name = salesName(item);
  const history = item.history.map((point) => point.ready);
  return <li className="team-member-card stock-sales-card">
    <div className="team-card-heading">
      <Avatar color="accent" size="sm" className="team-member-avatar"><Avatar.Fallback>{initials(name)}</Avatar.Fallback></Avatar>
      <div className="min-w-0 flex-1"><div className="team-member-name"><h2 className="text-base font-semibold" title={name}>{name}</h2></div><p className="team-member-email">{formatPhone(item.phone)}</p></div>
      <Dropdown><Dropdown.Trigger className="team-card-action" aria-label={`Aksi ${name}`}><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="sales-action-menu"><Dropdown.Menu aria-label={`Aksi stok ${name}`} onAction={(key) => { if (key === 'listings') onOpen(); else if (key === 'download' && !busy) onDownload(); }}>
        <Dropdown.Item id="listings" textValue="Lihat listing"><Eye className="size-4" /><Label>Lihat listing</Label></Dropdown.Item><Dropdown.Item id="download" textValue="Download Excel" isDisabled={busy}><Download className="size-4" /><Label>{downloading ? 'Menyiapkan Excel...' : 'Download Excel'}</Label></Dropdown.Item>
      </Dropdown.Menu></Dropdown.Popover></Dropdown>
    </div>
    <dl className="stock-sales-counts">{([{ label: 'Ready', value: item.counts.ready, color: colors.green }, { label: 'On-hold', value: item.counts.on_hold, color: colors.amber }, { label: 'Sold', value: item.counts.sold, color: colors.blue }]).map((status) => <div key={status.label}><dt>{status.label}</dt><dd style={{ color: status.color }}>{number(status.value)}</dd></div>)}</dl>
    <div className="stock-sales-body">
      {item.counts.total > 0 || item.last_posted_at ? <dl className="stock-sales-activity">
        <div><dt>Listing baru (7 hari)</dt><dd>{number(item.new_7d)}</dd></div>
        {item.last_posted_at && <div><dt>Posting terakhir</dt><dd>{relativeDate(item.last_posted_at)}</dd></div>}
      </dl> : <p className="text-xs text-muted">Belum ada listing untuk nomor ini.</p>}
      {history.length >= 2 && <div className="stock-sales-chart"><p className="mb-1 text-xs text-muted">Tren jumlah listing Ready</p><Sparkline values={history} className="h-12" color={colors.green} /></div>}
    </div>
  </li>;
}

function LogCard({ row, name }: { row: StockLogRow; name: string }) {
  return <li className="activity-mobile-card stock-log-card"><header><div><h2>{name}</h2><p className="activity-secondary">{formatPhone(row.phone)}</p></div></header>
    <p className="activity-card-summary">{EVENT[row.event_type].label}{row.event_type === 'import' && row.agent_name ? ` - ${row.agent_name}` : ''}</p>
    <p className="stock-log-time"><span>Waktu</span><time>{dateTime(row.logged_at)}</time></p>
    <dl className="stock-log-card-counts"><div><dt>Ready</dt><dd style={{ color: colors.green }}>{number(row.ready)} <Delta value={row.delta_ready} /></dd></div><div><dt>On-hold</dt><dd style={{ color: colors.amber }}>{number(row.on_hold)}</dd></div><div><dt>Sold</dt><dd style={{ color: colors.blue }}>{number(row.sold)}</dd></div><div><dt>Total</dt><dd>{number(row.total)} <Delta value={row.delta_total} /></dd></div></dl>
  </li>;
}
