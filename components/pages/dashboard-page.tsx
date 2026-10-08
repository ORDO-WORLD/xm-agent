'use client';

import { useMemo, useState } from 'react';
import { Chip, Skeleton } from '@heroui/react';
import { Boxes, CalendarRange, ChevronRight, Lightbulb, Sparkles, Target, TrendingUp, UploadCloud, Users } from 'lucide-react';
import { BarsChart, RingChart, TrendChart } from '@/components/charts/charts';
import { colors } from '@/components/charts/chart-setup';
import { EmptyState, ErrorNotice, IdChip, Panel, Segmented, StatTile, TemperatureChip } from '@/components/app/primitives';
import { PeriodPicker } from '@/components/app/period-picker';
import { AnimatedList } from '@/components/magicui/animated-list';
import { BlurFade } from '@/components/magicui/blur-fade';
import { BorderBeam } from '@/components/magicui/border-beam';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { categoryLabel, cleanName, greeting, number, prettyRange, relativeDate, shiftDay, structuredSummary, todayWib } from '@/lib/format';
import { query } from '@/lib/api';
import type { Navigate } from '@/lib/router';
import { useCompany, useSession } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { Dashboard, RecentResponse } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const PRESETS = [
  { id: 'week', label: 'Minggu ini' },
  { id: 'month', label: 'Bulan ini' },
  { id: 'last_week', label: 'Minggu lalu' },
  { id: 'last_month', label: 'Bulan lalu' },
] as const;

const short = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const labelFor = (iso: string, bucket: 'day' | 'week') => `${bucket === 'week' ? 'Mgg ' : ''}${short.format(new Date(`${iso}T12:00:00Z`))}`;

export default function DashboardPage({ navigate, params }: { navigate?: Navigate; params?: URLSearchParams }) {
  const api = useApi();
  const { user } = useSession();
  const { company, stats } = useCompany();
  // A link such as #/beranda?dari=2026-09-01&sampai=2026-09-30 opens that period directly.
  const [period, setPeriod] = useState<{ preset: string; from: string; to: string }>(() => {
    const from = params?.get('dari') ?? '';
    const to = params?.get('sampai') ?? from;
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { preset: 'custom', from, to } : { preset: 'week', from: '', to: '' };
  });
  const [budgetKind, setBudgetKind] = useState<'sale' | 'rent'>('sale');

  const { data, error, loading, reload } = useData((signal) => api.get<Dashboard>(
    `/dashboard/overview?${query({ period: period.preset === 'custom' ? 'custom' : period.preset, date_from: period.from, date_to: period.to })}`, signal), [period.preset, period.from, period.to]);

  const canUpload = !!company?.permissions.upload_data;
  const trendLabels = useMemo(() => (data ? data.trend.labels.map((iso) => labelFor(iso, data.period.bucket)) : []), [data]);
  const empty = !!data && data.kpi.buyers === 0 && data.kpi.listings === 0 && data.kpi.matches === 0;
  const first = user.display_name.split(' ')[0];

  function jumpToLatest() {
    if (!data?.latest_data_date) return;
    setPeriod({ preset: 'custom', from: shiftDay(data.latest_data_date, -29), to: data.latest_data_date });
  }

  return (
    <div className="space-y-6">
      <BlurFade>
        <div className="relative overflow-hidden rounded-3xl bg-brand p-5 text-brand-foreground sm:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.28),transparent_45%),radial-gradient(circle_at_10%_100%,rgba(37,99,235,.5),transparent_50%)]" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-base font-medium text-cyan-200">{greeting()},</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">{first}</h1>
              <p className="mt-2 max-w-xl text-base leading-relaxed text-blue-100/90">
                {stats ? <>Saat ini ada <strong className="text-white">{number(stats.buyers_ready)}</strong> buyer dan <strong className="text-white">{number(stats.listings_ready)}</strong> listing yang masih ready.</> : 'Memuat ringkasan…'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canUpload && (
                <ShimmerButton onClick={() => navigate?.('data')} background="oklch(0.48 0.235 265)" borderRadius="16px" shimmerColor="#a5f3fc" className="h-13 px-6 text-base font-semibold">
                  <UploadCloud className="mr-2 size-5" aria-hidden="true" />Unggah chat baru
                </ShimmerButton>
              )}
              <button type="button" onClick={() => navigate?.('cocokkan')} className="inline-flex h-13 items-center gap-2 rounded-2xl bg-white px-6 text-base font-semibold text-brand hover:bg-blue-50">
                <Target className="size-5" aria-hidden="true" />Mulai cocokkan
              </button>
            </div>
          </div>
        </div>
      </BlurFade>

      <section aria-label="Pilih periode" className="space-y-2">
        <div className="flex items-center gap-2 text-base font-bold"><CalendarRange className="size-5 text-accent" aria-hidden="true" />Periode yang dilihat</div>
        <PeriodPicker
          value={period}
          presets={PRESETS.map((item) => ({ id: item.id, label: item.label, range: () => ({ from: '', to: '' }) }))}
          onChange={setPeriod}
          max={todayWib()}
        />
        {data && <p className="text-sm text-muted">{data.period.label}: <strong className="text-foreground">{prettyRange(data.period.date_from, data.period.date_to)}</strong> · dibandingkan dengan {prettyRange(data.period.compare_from, data.period.compare_to)}</p>}
      </section>

      <ErrorNotice message={error} onRetry={reload} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4">
        <BlurFade delay={0.05}><StatTile label="Demand buyer" value={data?.kpi.buyers ?? 0} icon={<Users />} tone="indigo" change={data?.kpi.buyers_change} loading={loading && !data} hint="teks sama dihitung satu" /></BlurFade>
        <BlurFade delay={0.1}><StatTile label="Listing baru" value={data?.kpi.listings ?? 0} icon={<Boxes />} tone="cyan" change={data?.kpi.listings_change} loading={loading && !data} /></BlurFade>
        <BlurFade delay={0.15}>
          <div className="relative rounded-[var(--radius-2xl)]">
            <StatTile label="Match baru" value={data?.kpi.matches ?? 0} icon={<Sparkles />} tone="red" change={data?.kpi.matches_change} loading={loading && !data} hint={data ? `${data.matches.hot} Hot · ${data.matches.warm} Warm` : undefined} />
            {!!data?.kpi.matches_hot && <BorderBeam size={90} duration={7} colorFrom="#ef4444" colorTo="#f59e0b" />}
          </div>
        </BlurFade>
        <BlurFade delay={0.2}><StatTile label="Stok ready" value={data?.status.listing.ready ?? 0} icon={<TrendingUp />} tone="green" loading={loading && !data} hint={data ? `${data.status.listing.on_hold} on-hold · ${data.status.listing.sold} sold` : undefined} /></BlurFade>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-base">
          <span className="font-semibold">Demand buyer unik:</span>
          <Chip color="accent" variant="soft" size="lg">Minggu ini · {number(data.quick.this_week)}</Chip>
          <Chip color="accent" variant="soft" size="lg">Bulan ini · {number(data.quick.this_month)}</Chip>
        </div>
      )}

      {empty && (
        <Panel>
          <EmptyState animation="searching" title="Belum ada data pada periode ini"
            description={data?.latest_data_date ? `Data terbaru yang ada: ${prettyRange(data.latest_data_date, data.latest_data_date)}. Pilih periode lain atau lompat ke 30 hari terakhir data.` : 'Unggah chat WhatsApp terlebih dahulu agar statistik muncul.'}
            action={data?.latest_data_date ? <ShimmerButton onClick={jumpToLatest} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-12 px-5 font-semibold">Lihat data terakhir</ShimmerButton> : canUpload ? <ShimmerButton onClick={() => navigate?.('data')} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-12 px-5 font-semibold">Unggah chat</ShimmerButton> : undefined} />
        </Panel>
      )}

      {data && data.insights.length > 0 && !empty && (
        <Panel title={<span className="flex items-center gap-2"><Lightbulb className="size-5 text-warning" aria-hidden="true" />Ringkasan untuk Anda</span>} description="Dihitung otomatis dari data periode ini.">
          <ul className="space-y-2.5">
            {data.insights.map((line) => (
              <li key={line} className="flex gap-3 text-base leading-relaxed"><ChevronRight className="mt-1 size-4 shrink-0 text-accent" aria-hidden="true" />{line}</li>
            ))}
          </ul>
        </Panel>
      )}

      <RecentFeed onOpen={() => navigate?.('match-baru')} />

      {data && !empty && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Tren demand buyer" description="Berapa buyer unik yang mencari setiap hari (atau minggu, untuk periode panjang).">
            <TrendChart labels={trendLabels} height={260} ariaLabel="Grafik garis tren demand buyer" series={[{ label: 'Demand buyer', data: data.trend.buyers, color: colors.blue }]} />
          </Panel>

          <Panel title="Tren listing baru" description="Berapa listing unik yang masuk dari chat pada periode yang sama.">
            <TrendChart labels={trendLabels} height={260} ariaLabel="Grafik garis tren listing baru" series={[{ label: 'Listing baru', data: data.trend.listings, color: colors.cyan }]} />
          </Panel>

          <Panel title="Properti yang paling dicari" description="Jenis properti dalam demand buyer pada periode ini.">
            {data.categories.length ? (
              <RingChart caption="buyer" ariaLabel="Diagram cincin jenis properti yang dicari" items={data.categories.map((item) => ({ label: categoryLabel(item.key), value: item.value }))} />
            ) : <EmptyState compact title="Belum ada demand" />}
          </Panel>

          <Panel title="Lokasi paling dicari" description="Jumlah buyer yang mencari di lokasi itu dibanding stok listing yang masih ready.">
            {data.locations.length ? (
              <BarsChart horizontal height={Math.max(260, data.locations.length * 46)} ariaLabel="Diagram batang lokasi paling dicari dibanding stok"
                labels={data.locations.map((item) => item.label)}
                series={[{ label: 'Buyer mencari', data: data.locations.map((item) => item.value), color: colors.blue }, { label: 'Listing ready', data: data.locations.map((item) => item.stock), color: colors.cyan }]} />
            ) : <EmptyState compact title="Belum ada lokasi terbaca" />}
          </Panel>

          <Panel title="Anggaran buyer" description="Berapa banyak buyer menurut batas harga yang mereka sebut. Harga per m² atau per tahun tidak dihitung."
            action={<Segmented label="Jenis anggaran" value={budgetKind} onChange={setBudgetKind} options={[{ id: 'sale', label: 'Beli' }, { id: 'rent', label: 'Sewa' }]} />}>
            <BarsChart height={260} ariaLabel="Diagram batang anggaran buyer" labels={data.budget.labels}
              series={[{ label: budgetKind === 'sale' ? 'Buyer (beli)' : 'Buyer (sewa)', data: data.budget[budgetKind], color: budgetKind === 'sale' ? colors.violet : colors.teal }]} />
            {data.budget.skipped > 0 && <p className="mt-2 text-sm text-muted">{number(data.budget.skipped)} buyer tidak menyebut anggaran yang bisa dibandingkan.</p>}
          </Panel>

          <Panel title="Match baru per hari" description="Hasil pencocokan baru dari data yang Anda unggah.">
            {data.kpi.matches ? (
              <BarsChart stacked height={260} ariaLabel="Diagram batang match baru Hot dan Warm" labels={trendLabels}
                series={[{ label: 'Hot', data: data.trend.matches_hot, color: colors.red }, { label: 'Warm', data: data.trend.matches.map((total, index) => total - (data.trend.matches_hot[index] ?? 0)), color: colors.amber }]} />
            ) : <EmptyState animation="match-found" compact title="Belum ada match baru" description="Match baru muncul setelah Anda mengunggah chat." />}
          </Panel>

          <Panel title="Peluang: dicari banyak, stok sedikit" description="Jenis properti dan lokasi yang permintaannya melebihi listing ready. Bagus untuk dicari listing barunya.">
            <GapList title="Jenis properti" rows={data.gap_categories.map((row) => ({ ...row, label: categoryLabel(row.key) }))} />
            <div className="my-4 h-px bg-separator" />
            <GapList title="Lokasi" rows={data.gap_locations} />
          </Panel>

          <Panel title="Listing per sales" description={data.top_sales.group_by === 'phone' ? 'Dikelompokkan menurut nomor telepon di pesan (atur di Pengaturan).' : 'Dikelompokkan menurut pengirim pesan (atur di Pengaturan).'}>
            {data.top_sales.rows.length ? (
              <BarsChart horizontal height={Math.max(260, data.top_sales.rows.length * 44)} ariaLabel="Diagram batang listing ready per sales"
                labels={data.top_sales.rows.map((row) => (row.contact_name && data.top_sales.group_by === 'phone' ? `${row.contact_name} (${row.label.slice(-4)})` : row.label).slice(0, 26))}
                series={[{ label: 'Listing ready', data: data.top_sales.rows.map((row) => row.value), color: colors.navy }]} />
            ) : <EmptyState compact title="Belum ada listing" />}
          </Panel>

          <Panel title="Status stok" description="Berapa yang masih ready, sedang di-hold, atau sudah terjual." className="lg:col-span-2">
            <div className="grid gap-6 sm:grid-cols-2">
              <div><p className="mb-2 text-base font-bold">Listing</p><RingChart caption="listing" ariaLabel="Status listing" items={[
                { label: 'Ready', value: data.status.listing.ready, color: colors.green }, { label: 'On-hold', value: data.status.listing.on_hold, color: colors.amber }, { label: 'Sold', value: data.status.listing.sold, color: colors.blue }]} /></div>
              <div><p className="mb-2 text-base font-bold">Buyer</p><RingChart caption="buyer" ariaLabel="Status buyer" items={[
                { label: 'Ready', value: data.status.buyer.ready, color: colors.green }, { label: 'On-hold', value: data.status.buyer.on_hold, color: colors.amber }, { label: 'Sold / deal', value: data.status.buyer.sold, color: colors.blue }]} /></div>
            </div>
          </Panel>
        </div>
      )}

      {loading && !data && <div className="grid gap-5 lg:grid-cols-2">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-72 rounded-3xl" />)}</div>}
      <p className="text-center text-sm text-muted">Tanggal dan jam mengikuti WIB. Minggu dimulai hari Senin.</p>
    </div>
  );
}

function GapList({ title, rows }: { title: string; rows: { key: string; label: string; buyers: number; listings: number; pressure: number }[] }) {
  if (!rows.length) return <div><p className="text-base font-bold">{title}</p><p className="mt-1 text-base text-muted">Belum ada data permintaan.</p></div>;
  const top = Math.max(...rows.map((row) => row.buyers), 1);
  return (
    <div>
      <p className="mb-2 text-base font-bold">{title}</p>
      <ul className="space-y-3">
        {rows.slice(0, 5).map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-[0.95rem]">
              <span className="min-w-0 truncate font-semibold">{row.label}</span>
              <span className="shrink-0 text-muted"><strong className="text-foreground">{row.buyers}</strong> buyer · <strong className="text-foreground">{row.listings}</strong> listing</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-default" role="presentation">
              <div className="h-full rounded-full" style={{ width: `${Math.max(6, (row.buyers / top) * 100)}%`, background: row.pressure >= 2 ? colors.red : row.pressure >= 1.2 ? colors.amber : colors.green }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The newest matches from the last week, appearing one after another like notifications. */
function RecentFeed({ onOpen }: { onOpen: () => void }) {
  const api = useApi();
  const today = todayWib();
  const feed = useData((signal) => api.get<RecentResponse>(`/matches/recent?${query({ direction: 'buyer', date_from: shiftDay(today, -6), date_to: today, temps: 'hot,warm', limit: 5, per_source: 1 })}`, signal), [today]);
  const groups = feed.data?.groups ?? [];
  if (!groups.length) return null;
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles className="size-5 text-hot" aria-hidden="true" />Match terbaru minggu ini</span>} description="Pasangan baru dari upload data Anda."
      action={<button type="button" onClick={onOpen} className="min-h-10 text-base font-semibold text-accent">Lihat semua</button>}>
      <AnimatedList delay={650} className="items-stretch gap-3">
        {groups.map((group) => {
          const match = group.matches[0];
          if (!match) return null;
          return (
            <button key={group.source.entity_id} type="button" onClick={onOpen} className="w-full rounded-2xl border border-border bg-surface p-3.5 text-left transition hover:border-accent/50">
              <div className="flex flex-wrap items-center gap-2">
                <TemperatureChip temperature={match.temperature} />
                <IdChip id={group.source.public_id} kind="buyer" /><span aria-hidden="true" className="text-muted">⇄</span><IdChip id={match.target.public_id} kind="property" />
                <span className="ml-auto text-sm text-muted">{relativeDate(match.found_at)}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-base leading-relaxed"><strong>{cleanName(group.source.contact_name) || 'Buyer'}</strong> · {structuredSummary(match.target)}</p>
            </button>
          );
        })}
      </AnimatedList>
    </Panel>
  );
}
