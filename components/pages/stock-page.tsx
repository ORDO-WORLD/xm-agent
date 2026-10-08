'use client';

import { useMemo, useState } from 'react';
import { Avatar, Button, Label, ListBox, Select, toast, useOverlayState } from '@heroui/react';
import { Boxes, ClipboardList, Download, Eye, History, Pencil, PhoneCall, Plus, Tag, UploadCloud } from 'lucide-react';
import { BarsChart, Sparkline } from '@/components/charts/charts';
import { colors } from '@/components/charts/chart-setup';
import { EmptyState, ErrorNotice, IconBadge, LoadingRows, PageHeader, Panel, StatTile } from '@/components/app/primitives';
import { SalesListingsModal } from '@/components/app/sales-listings-modal';
import { TrackedEditor } from '@/components/app/tracked-editor';
import { PeriodPicker, type Period } from '@/components/app/period-picker';
import { BlurFade } from '@/components/magicui/blur-fade';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { errorMessage, query } from '@/lib/api';
import { cleanName, dateTime, formatPhone, initials, number, relativeDate, shiftDay, todayWib } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
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

export default function StockPage(_props: { navigate?: Navigate }) {
  const api = useApi();
  const { company, refresh } = useCompany();
  const canEdit = !!company?.permissions.manage_settings;
  const [tick, setTick] = useState(0);
  const editor = useOverlayState();
  const listings = useOverlayState();
  const [viewing, setViewing] = useState<StockTracked | null>(null);
  const [phone, setPhone] = useState('');
  const [period, setPeriod] = useState<Period>({ preset: 'all', from: '', to: '' });
  const [limit, setLimit] = useState(30);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const overview = useData((signal) => api.get<StockOverview>('/stock/overview', signal), [tick]);
  const log = useData((signal) => api.get<{ rows: StockLogRow[]; has_more: boolean }>(`/stock/log?${query({ phone, date_from: period.from, date_to: period.to, limit })}`, signal), [phone, period.from, period.to, limit, tick]);

  const tracked = useMemo(() => overview.data?.tracked ?? [], [overview.data]);
  const totals = overview.data?.totals;
  const chartRows = useMemo(() => tracked.map((item) => ({ name: salesName(item).slice(0, 18), tail: item.phone.slice(-4), ...item.counts })), [tracked]);

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

  return (
    <div className="space-y-6">
      <PageHeader title="Stok Sales" description="Pantau berapa listing milik setiap sales, berdasarkan nomor telepon yang tertulis di pesan. Dicatat otomatis setiap kali data diunggah atau status listing diubah."
        actions={<>
          {tracked.length > 0 && <Button variant="secondary" isPending={downloading === 'all'} isDisabled={!!downloading} onPress={() => download()}><Download className="size-4" aria-hidden="true" />Download semua listing sales</Button>}
          {canEdit && <><Button variant="secondary" isPending={snapshotBusy} isDisabled={!tracked.length} onPress={snapshot}><ClipboardList className="size-4" aria-hidden="true" />Catat sekarang</Button>
          <ShimmerButton onClick={() => editor.open()} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-11 px-5 font-semibold"><PhoneCall className="mr-2 size-4" aria-hidden="true" />Atur nomor sales</ShimmerButton></>}
        </>} />

      <ErrorNotice message={overview.error} onRetry={overview.reload} />
      {overview.loading && !overview.data && <LoadingRows rows={3} />}

      {overview.data && tracked.length === 0 && (
        <div className="xm-card">
          <EmptyState animation="searching" title="Belum ada nomor sales yang dipantau"
            description={canEdit ? 'Masukkan nomor telepon sales, pisahkan dengan koma. Contoh: 6282233744657, 6281202310022. Pengaturan ini berlaku untuk seluruh company.' : 'Super admin company dapat menambahkan nomor sales yang ingin dipantau.'}
            action={canEdit ? <ShimmerButton onClick={() => editor.open()} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-12 px-6 font-semibold"><Plus className="mr-2 size-5" aria-hidden="true" />Tambah nomor sales</ShimmerButton> : undefined} />
        </div>
      )}

      {totals && tracked.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <BlurFade><StatTile label="Total listing dipantau" value={totals.total} icon={<Boxes />} tone="indigo" hint={`${tracked.length} nomor sales`} /></BlurFade>
            <BlurFade delay={0.05}><StatTile label="Ready" value={totals.ready} icon={<Boxes />} tone="green" /></BlurFade>
            <BlurFade delay={0.1}><StatTile label="On-hold" value={totals.on_hold} icon={<Boxes />} tone="amber" /></BlurFade>
            <BlurFade delay={0.15}><StatTile label="Sold" value={totals.sold} icon={<Boxes />} tone="blue" /></BlurFade>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {tracked.map((item, index) => (
              <BlurFade key={item.phone} delay={0.05 * index}><SalesCard item={item} onOpen={() => { setViewing(item); listings.open(); }} onDownload={() => download(item)} downloading={downloading === item.phone} busy={!!downloading} /></BlurFade>
            ))}
          </div>

          {tracked.length > 1 && (
            <Panel title="Perbandingan stok antar sales" description="Jumlah listing Ready, On-hold, dan Sold per nomor.">
              <BarsChart horizontal stacked height={Math.max(220, tracked.length * 58)} ariaLabel="Diagram batang bertumpuk stok per sales"
                labels={chartRows.map((row) => `${row.name} ···${row.tail}`)}
                series={[{ label: 'Ready', data: chartRows.map((row) => row.ready), color: colors.green }, { label: 'On-hold', data: chartRows.map((row) => row.on_hold), color: colors.amber }, { label: 'Sold', data: chartRows.map((row) => row.sold), color: colors.blue }]} />
            </Panel>
          )}
        </>
      )}

      {tracked.length > 0 && (
        <Panel title={<span className="flex items-center gap-2"><History className="size-5 text-accent" aria-hidden="true" />Riwayat pencatatan otomatis</span>} description="Setiap baris adalah satu catatan: berapa listing milik sales itu pada saat kejadian."
          bodyClassName="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(220px,300px)_1fr]">
            <Select value={phone || 'all'} onChange={(value) => { setPhone(value === 'all' ? '' : String(value)); setLimit(30); }} aria-label="Filter sales" fullWidth>
              <Label className="text-base font-bold">Sales</Label>
              <Select.Trigger className="h-12 text-base"><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all" textValue="Semua sales">Semua sales<ListBox.ItemIndicator /></ListBox.Item>
                  {tracked.map((item) => <ListBox.Item key={item.phone} id={item.phone} textValue={`${salesName(item)} ${item.phone}`}>{salesName(item)} · {formatPhone(item.phone)}<ListBox.ItemIndicator /></ListBox.Item>)}
                </ListBox>
              </Select.Popover>
            </Select>
            <div><p className="mb-2 text-base font-bold">Periode</p><PeriodPicker value={period} onChange={(next) => { setPeriod(next); setLimit(30); }} presets={presets} max={today} /></div>
          </div>
          <ErrorNotice message={log.error} onRetry={log.reload} />
          {log.loading && !log.data && <LoadingRows rows={3} />}
          {log.data && log.data.rows.length === 0 && <EmptyState compact title="Belum ada catatan pada filter ini" />}
          <ul className={cn('divide-y divide-separator rounded-2xl border border-border bg-surface transition-opacity', log.loading && log.data && 'opacity-60')}>
            {log.data?.rows.map((row) => <LogRow key={row.id} row={row} name={salesName({ label: row.label, contact_name: tracked.find((item) => item.phone === row.phone)?.contact_name ?? null, phone: row.phone })} />)}
          </ul>
          {log.data?.has_more && <Button variant="secondary" size="lg" fullWidth onPress={() => setLimit((value) => value + 30)}>Tampilkan lebih banyak</Button>}
        </Panel>
      )}

      <SalesListingsModal state={listings} phone={viewing?.phone ?? ''} name={viewing ? salesName(viewing) : ''} />
      <TrackedEditor state={editor} current={tracked} onSaved={() => { setTick((value) => value + 1); refresh(); }} />
    </div>
  );
}

function Delta({ value }: { value: number }) {
  if (!value) return null;
  return <span className={cn('rounded-full px-1.5 py-0.5 text-sm font-bold', value > 0 ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground')}>{value > 0 ? '+' : '−'}{Math.abs(value)}</span>;
}

function SalesCard({ item, onOpen, onDownload, downloading, busy }: { item: StockTracked; onOpen: () => void; onDownload: () => void; downloading: boolean; busy: boolean }) {
  const name = salesName(item);
  const history = item.history.map((point) => point.ready);
  return (
    <article className="xm-card flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar color="accent" size="lg"><Avatar.Fallback>{initials(name)}</Avatar.Fallback></Avatar>
        <div className="min-w-0 flex-1"><p className="truncate text-lg font-bold">{name}</p><p className="text-base text-muted">{formatPhone(item.phone)}</p></div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {([['Ready', item.counts.ready, 'bg-success-soft text-success-soft-foreground'], ['On-hold', item.counts.on_hold, 'bg-warning-soft text-warning-soft-foreground'], ['Sold', item.counts.sold, 'bg-accent-soft text-accent-soft-foreground']] as const).map(([label, value, tone]) => (
          <div key={label} className={cn('rounded-2xl px-2 py-3', tone)}><dd className="text-3xl font-bold leading-none tracking-tight">{number(value)}</dd><dt className="mt-1.5 text-sm font-semibold">{label}</dt></div>
        ))}
      </dl>
      <p className="mt-3 text-base text-muted">{item.new_7d > 0 ? <><strong className="text-foreground">+{item.new_7d}</strong> listing baru dalam 7 hari</> : 'Tidak ada listing baru dalam 7 hari'}{item.last_posted_at ? ` · posting terakhir ${relativeDate(item.last_posted_at)}` : ''}</p>
      <div className="mt-3 flex-1"><p className="mb-1 text-sm font-semibold text-muted">Perkembangan stok ready</p><Sparkline values={history} className="h-16" color={colors.green} /></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" fullWidth onPress={onOpen}>Lihat listing sales ini</Button>
        <Button variant="secondary" fullWidth isPending={downloading} isDisabled={busy} onPress={onDownload}><Download className="size-4" aria-hidden="true" />Download Excel</Button>
      </div>
    </article>
  );
}

function LogRow({ row, name }: { row: StockLogRow; name: string }) {
  const meta = EVENT[row.event_type];
  return (
    <li className="flex gap-3 p-3.5 sm:p-4">
      <IconBadge icon={<meta.icon />} tone={meta.tone} className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-base font-bold">{meta.label}{row.event_type === 'import' && row.agent_name ? <span className="font-medium text-muted"> · {row.agent_name}</span> : null}</p>
          <time className="text-sm text-muted" title={dateTime(row.logged_at)}>{dateTime(row.logged_at, false)}</time>
        </div>
        <p className="text-base text-muted">{name} · {formatPhone(row.phone)}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
          <span>Ready <strong>{row.ready}</strong> <Delta value={row.delta_ready} /></span>
          <span>On-hold <strong>{row.on_hold}</strong></span>
          <span>Sold <strong>{row.sold}</strong></span>
          <span className="text-muted">Total {row.total} <Delta value={row.delta_total} /></span>
        </p>
      </div>
    </li>
  );
}
