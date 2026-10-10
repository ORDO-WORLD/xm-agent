'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, Switch, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { ArrowRight, Check, Sparkles, TrendingUp } from 'lucide-react';
import { EmptyState, ErrorNotice, IdChip, LoadingIndicator, LoadingRows, PageHeader, Panel, Segmented, StatusChip, TemperatureChip } from '@/components/app/primitives';
import { PeriodPicker, type Period, type Preset } from '@/components/app/period-picker';
import { RawChat, WhatsAppButton } from '@/components/match/cards';
import { BorderBeam } from '@/components/magicui/border-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { query } from '@/lib/api';
import { cleanName, dateOnly, dateTime, mondayOf, number, prettyRange, relativeDate, shiftDay, structuredSummary, todayWib } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { Direction, RecentGroup, RecentResponse, Temperature } from '@/lib/types';
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
  const { markSeen } = useCompany();
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

  const summary = useData((signal) => api.get<Summary>('/matches/recent/summary', signal), []);
  const data = useData((signal) => api.get<RecentResponse>(`/matches/recent?${query({
    direction, date_from: period.from, date_to: period.to, temps: temps.join(','), include_inactive: includeInactive, limit,
  })}`, signal), [filterKey, limit]);

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
  const goOpen = (group: RecentGroup) => navigate?.('cocokkan', { arah: direction, id: group.source.public_id });

  return (
    <div className="space-y-5">
      <PageHeader title="Match Terbaru" description="Pasangan buyer dan listing yang baru ditemukan setiap kali Anda mengunggah data chat. Riwayatnya tersimpan, jadi Anda bisa melihat kemarin, minggu lalu, atau tanggal tertentu." />

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
          <p className="mt-2 text-sm text-muted">{prettyRange(data.data?.date_from ?? period.from, data.data?.date_to ?? period.to)} · angka hijau di kalender = jumlah match baru pada hari itu.</p>
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

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Pasangan baru" value={totals.pairs} />
          <Mini label="🔥 Hot" value={totals.hot} tone="hot" />
          <Mini label="🌡️ Warm" value={totals.warm} tone="warm" />
        </div>
      )}

      <ErrorNotice message={data.error} onRetry={data.reload} />
      {data.loading && !data.data && <LoadingRows rows={3} />}
      {data.loading && data.data && <LoadingIndicator />}

      {!data.loading && data.data && data.data.groups.length === 0 && (
        <div className="xm-card">
          <EmptyState animation="match-found" title={`Belum ada match baru pada ${prettyRange(data.data.date_from, data.data.date_to)}`}
            description={temps.length === 0 ? 'Aktifkan Hot dan/atau Warm di atas.' : latest ? `Match terbaru terakhir ditemukan pada ${dateOnly(latest)}.` : 'Match baru muncul otomatis setelah Anda mengunggah data chat dan ada pasangan buyer–listing baru.'}
            action={latest ? <Button variant="primary" size="lg" onPress={() => setPeriod({ preset: 'custom', from: latest, to: latest })}>Lihat {dateOnly(latest)}</Button> : undefined} />
        </div>
      )}

      <div aria-busy={data.loading} inert={data.loading} className={cn('space-y-4 transition-opacity', data.loading && data.data && 'opacity-60')}>
        {data.data?.groups.map((group) => (
          <RecentGroupCard key={group.source.entity_id} group={group} direction={direction} isNew={isNew} onOpen={() => goOpen(group)} />
        ))}
      </div>
      {data.data?.has_more && <Button variant="secondary" size="lg" fullWidth onPress={() => setMore({ key: filterKey, extra: limit - 30 + 30 })}>Tampilkan lebih banyak</Button>}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'hot' | 'warm' }) {
  return (
    <div className="xm-card p-3.5 text-center sm:p-4">
      <p className="text-sm font-semibold text-muted sm:text-base">{label}</p>
      <p className={cn('mt-0.5 text-3xl font-bold tracking-tight', tone === 'hot' && 'text-hot', tone === 'warm' && 'text-amber-700')}><NumberTicker value={value} key={value} /></p>
    </div>
  );
}

function RecentGroupCard({ group, direction, isNew, onOpen }: { group: RecentGroup; direction: Direction; isNew: (found: string) => boolean; onOpen: () => void }) {
  const source = group.source;
  const kind = direction;
  const targetKind = direction === 'buyer' ? 'property' : 'buyer';
  const fresh = isNew(group.latest_found_at);
  return (
    <article className={cn('xm-card overflow-hidden', fresh && 'border-accent/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-separator bg-background px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IdChip id={source.public_id} kind={kind} />
            {source.entity_status && source.entity_status !== 'ready' && <StatusChip status={source.entity_status} />}
            {fresh && <Chip color="accent" variant="primary" size="sm">Baru</Chip>}
            <span className="text-sm text-muted">{direction === 'buyer' ? 'Buyer' : 'Listing'} · {number(group.pair_count)} match baru</span>
          </div>
          <p className="mt-1.5 break-words text-[1.0625rem] font-bold">{cleanName(source.contact_name) || (direction === 'buyer' ? 'Buyer tanpa nama' : 'Listing tanpa nama')}</p>
          <p className="mt-0.5 text-base leading-relaxed text-foreground/80">{structuredSummary(source)}</p>
        </div>
        <Button variant="secondary" onPress={onOpen}>Buka di Cocokkan<ArrowRight className="size-4" aria-hidden="true" /></Button>
      </div>
      <ul className="divide-y divide-separator">
        {group.matches.map((match) => {
          const target = match.target;
          return (
            <li key={match.event_id} className={cn('px-4 py-3.5 sm:px-5', match.temperature === 'hot' && 'bg-hot-soft/30')}>
              <div className="flex flex-wrap items-center gap-2">
                <TemperatureChip temperature={match.temperature} />
                <span className="rounded-full bg-default px-2.5 py-1 text-sm font-semibold text-default-foreground">Skor {Math.round(match.score)}</span>
                <IdChip id={target.public_id} kind={targetKind} />
                {target.entity_status && target.entity_status !== 'ready' && <StatusChip status={target.entity_status} />}
                {match.upgraded_to_hot && <span className="inline-flex items-center gap-1 rounded-full bg-hot-soft px-2.5 py-1 text-sm font-semibold text-hot"><TrendingUp className="size-3.5" aria-hidden="true" />Naik ke Hot</span>}
                {isNew(match.found_at) && <Check className="size-4 text-accent" aria-label="Belum dilihat" />}
              </div>
              <p className="mt-2 break-words text-base font-semibold">{cleanName(target.contact_name) || (targetKind === 'buyer' ? 'Buyer tanpa nama' : 'Listing tanpa nama')}</p>
              <p className="mt-0.5 text-base leading-relaxed text-foreground/80">{structuredSummary(target)}</p>
              <p className="mt-1.5 text-sm text-muted">Ditemukan {relativeDate(match.found_at)} · {dateTime(match.found_at)}{match.agent_name ? ` · dari upload ${match.agent_name}` : ''}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <WhatsAppButton row={target} kind={targetKind} label={`WhatsApp ${targetKind === 'buyer' ? 'buyer' : 'pemilik listing'}`} />
                <WhatsAppButton row={source} kind={kind} label={`WhatsApp ${kind === 'buyer' ? 'buyer' : 'pemilik listing'}`} />
                <RawChat text={target.raw_text || target.normalized_text} />
              </div>
            </li>
          );
        })}
      </ul>
      {group.pair_count > group.matches.length && <p className="border-t border-separator px-5 py-3 text-sm text-muted">Menampilkan {group.matches.length} dari {group.pair_count} match. Buka di Cocokkan untuk melihat semuanya.</p>}
    </article>
  );
}
