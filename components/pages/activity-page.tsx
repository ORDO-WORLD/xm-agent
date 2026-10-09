'use client';

import { useState, type ReactNode } from 'react';
import { Button, Chip } from '@heroui/react';
import { ChevronDown, Cog, Eye, FileDown, KeyRound, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, PageHeader } from '@/components/app/primitives';
import { errorMessage, query } from '@/lib/api';
import { asWib, dateTime } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import type { ActivityFilters, ActivityLayer, ActivityPage as Page, ActivityRow } from '@/lib/types';
import { useData, useDebounced } from '@/lib/use-data';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

const LAYERS: { id: ActivityLayer; label: string; icon: typeof Cog }[] = [
  { id: 'change', label: 'Perubahan', icon: Cog },
  { id: 'account', label: 'Akun', icon: KeyRound },
  { id: 'export', label: 'Unduhan', icon: FileDown },
  { id: 'view', label: 'Sekadar melihat', icon: Eye },
];
const DEFAULT_LAYERS: ActivityLayer[] = ['change', 'account', 'export'];
const ROLE: Record<string, string> = { admin: 'administrator', company_admin: 'admin company', user: 'anggota', system: 'otomatis' };
const field = 'h-12 w-full min-w-0 rounded-xl border border-field-border bg-surface px-3 text-base text-foreground';

const clock = (value: string) => {
  const date = asWib(value);
  return date ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(date).replace(':', '.') : '—';
};
const dayKey = (value: string) => {
  const date = asWib(value);
  return date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date) : '';
};
function dayTitle(value: string) {
  const date = asWib(value);
  if (!date) return '—';
  const text = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date);
  const days = Math.round((Date.parse(dayKey(new Date().toISOString())) - Date.parse(dayKey(value))) / 86_400_000);
  return days === 0 ? `Hari ini, ${text}` : days === 1 ? `Kemarin, ${text}` : text;
}

/** Supporting facts of one line: before/after, counts, file names. Plain words, never raw JSON. */
function Detail({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  if (typeof value === 'boolean') return value ? 'ya' : 'tidak';
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted">—</span>;
    if (value.every((item) => typeof item !== 'object' || item === null)) return value.join(', ');
    return <ul className="space-y-1">{value.map((item, index) => <li key={index}><Detail value={item} /></li>)}</ul>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null && item !== undefined && item !== '');
    if (!entries.length) return <span className="text-muted">—</span>;
    return (
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(7rem,max-content)_1fr]">
        {entries.map(([key, item]) => (
          <div key={key} className="contents">
            <dt className="font-semibold text-muted">{key.replaceAll('_', ' ')}</dt>
            <dd className="min-w-0 break-words"><Detail value={item} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return typeof value === 'number' ? value.toLocaleString('id-ID') : typeof value === 'string' ? value : JSON.stringify(value);
}

function Line({ row }: { row: ActivityRow }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Object.keys(row.details ?? {}).length > 0 || row.repeat_count > 1;
  const view = row.layer === 'view';
  return (
    <li className={cn('rounded-2xl border p-3 sm:px-4', row.failed ? 'border-danger/40 bg-danger-soft/40' : 'border-border bg-surface', view && !row.failed && 'bg-transparent')}>
      <button type="button" disabled={!hasDetails} aria-expanded={hasDetails ? open : undefined} onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 text-left sm:gap-4">
        <span className="w-12 shrink-0 pt-0.5 text-base font-bold tabular-nums text-muted">{clock(row.at)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className={cn('text-base font-bold', view && 'font-semibold')}>{row.actor_name}</span>
            {row.as_admin && <Chip size="sm" variant="soft" color="accent"><ShieldCheck className="mr-1 size-3" aria-hidden="true" />administrator</Chip>}
            {row.company_name && <span className="text-muted">di {row.company_name}</span>}
            {row.repeat_count > 1 && <Chip size="sm" variant="soft">×{row.repeat_count}</Chip>}
          </span>
          <span className={cn('mt-0.5 block break-words text-base leading-relaxed', row.failed ? 'font-semibold text-danger' : view ? 'text-muted' : 'text-foreground')}>
            {row.failed && <TriangleAlert className="mr-1.5 inline size-4 align-[-2px]" aria-hidden="true" />}{row.summary}
          </span>
        </span>
        {hasDetails && <ChevronDown className={cn('mt-1 size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />}
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm leading-relaxed sm:ml-16">
          <p className="text-muted">
            {row.action_label}{row.actor_email ? ` · ${row.actor_email}` : ''}{row.actor_role ? ` · ${ROLE[row.actor_role] ?? row.actor_role}` : ''}
            {row.repeat_count > 1 ? ` · ${row.repeat_count} kali, pertama ${dateTime(row.first_at)}, terakhir ${dateTime(row.at)}` : ` · ${dateTime(row.at)}`}
          </p>
          {Object.keys(row.details ?? {}).length > 0 && <Detail value={row.details} />}
        </div>
      )}
    </li>
  );
}

/** Platform administrator only: who did what, across every company, in plain sentences. */
export default function ActivityPage({ params, navigate }: { params?: URLSearchParams; navigate?: Navigate }) {
  const api = useApi();
  const company = params?.get('company') ?? '';
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [layers, setLayers] = useState<ActivityLayer[]>(DEFAULT_LAYERS);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 400);
  const [older, setOlder] = useState<{ key: string; rows: ActivityRow[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');

  const filter = { company, actor, action, layers: layers.join(','), date_from: from, date_to: to, q: search };
  const key = JSON.stringify(filter);
  const options = useData((signal) => api.get<ActivityFilters>('/admin/activity/filters', signal), []);
  const first = useData((signal) => api.get<Page>(`/admin/activity?${query(filter)}`, signal), [key]);

  // Older pages belong to the filters they were loaded with; a new filter starts over.
  const extra = older?.key === key ? older : null;
  const rows = [...(first.data?.rows ?? []), ...(extra?.rows ?? [])];
  const next = extra ? extra.next : first.data?.next ?? null;

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true); setMoreError('');
    try {
      const page = await api.get<Page>(`/admin/activity?${query({ ...filter, before: next })}`);
      setOlder({ key, rows: [...(extra?.rows ?? []), ...page.rows], next: page.next });
    } catch (reason) { setMoreError(errorMessage(reason)); } finally { setLoadingMore(false); }
  }

  const toggle = (id: ActivityLayer) => setLayers((current) => {
    const chosen = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    return chosen.length ? LAYERS.map((item) => item.id).filter((item) => chosen.includes(item)) : current;
  });
  const setCompany = (value: string) => navigate?.('aktivitas', { company: value || undefined });

  const groups: { day: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const day = dayKey(row.at);
    if (groups.at(-1)?.day === day) groups.at(-1)!.rows.push(row); else groups.push({ day, rows: [row] });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Aktivitas" description="Siapa melakukan apa di semua company. Hanya administrator platform yang dapat membuka halaman ini, dan catatan di sini tidak dapat diubah." />

      <div className="xm-card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <label className="block text-sm font-bold">Company
            <select className={cn(field, 'mt-1 font-normal')} value={company} onChange={(event) => setCompany(event.target.value)}>
              <option value="">Semua company</option>
              {options.data?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold">Orang
            <select className={cn(field, 'mt-1 font-normal')} value={actor} onChange={(event) => setActor(event.target.value)}>
              <option value="">Semua orang</option>
              <option value="system">Sistem (otomatis)</option>
              {options.data?.actors.map((item) => <option key={item.email} value={item.email}>{item.name} — {item.email}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold">Jenis
            <select className={cn(field, 'mt-1 font-normal')} value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">Semua jenis</option>
              {options.data?.actions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 2xl:col-span-2">
            <label className="block text-sm font-bold">Dari
              <input type="date" className={cn(field, 'mt-1 font-normal')} value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="block text-sm font-bold">Sampai
              <input type="date" className={cn(field, 'mt-1 font-normal')} value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
          <label className="block text-sm font-bold">Cari
            <span className="relative mt-1 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input type="search" className={cn(field, 'pl-9 font-normal')} placeholder="mis. L-AB908, sold, sari@" value={text} onChange={(event) => setText(event.target.value)} />
            </span>
          </label>
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Jenis aktivitas yang ditampilkan</legend>
          {LAYERS.map((item) => {
            const on = layers.includes(item.id);
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" aria-pressed={on} onClick={() => toggle(item.id)}
                className={cn('flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.95rem] font-semibold transition-colors',
                  on ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-surface text-muted hover:bg-default',
                  item.id === 'view' && 'sm:ml-3')}>
                <Icon className="size-4" aria-hidden="true" />{item.label}
              </button>
            );
          })}
          {!layers.includes('view') && <p className="text-sm text-muted">Yang hanya membuka atau mencari tidak ditampilkan.</p>}
        </fieldset>
      </div>

      <ErrorNotice message={first.error} onRetry={first.reload} />
      {first.loading && !first.data && <LoadingRows rows={6} />}
      {first.data && rows.length === 0 && <div className="xm-card"><EmptyState title="Belum ada aktivitas" description="Tidak ada catatan yang cocok dengan saringan ini." /></div>}

      <div className={cn('space-y-6', first.loading && first.data && 'opacity-60')}>
        {groups.map((group) => (
          <section key={group.day} aria-label={dayTitle(group.rows[0].at)}>
            <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wider text-muted">{dayTitle(group.rows[0].at)}</h2>
            <ul className="space-y-2">{group.rows.map((row) => <Line key={row.id} row={row} />)}</ul>
          </section>
        ))}
      </div>

      {moreError && <ErrorNotice message={moreError} onRetry={() => void loadMore()} />}
      {next && rows.length > 0 && (
        <div className="flex justify-center">
          <Button size="lg" variant="secondary" isPending={loadingMore} onPress={() => void loadMore()}>Muat yang lebih lama</Button>
        </div>
      )}
    </div>
  );
}
