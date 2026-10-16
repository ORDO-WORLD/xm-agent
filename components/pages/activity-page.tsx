'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Button, ComboBox, Input, Label, ListBox, Modal, useOverlayState } from '@heroui/react';
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Cog, Eye, FileDown, KeyRound, Mail, Search, ShieldCheck, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/app/primitives';
import { query } from '@/lib/api';
import { getPaginationPages, useTableViewport } from '@/components/settings/settings-pagination';
import { usePageHeading } from '@/components/app/company-shell';
import { dateTime } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import type { ActivityFilters, ActivityLayer, ActivityPage as Page, ActivityRow } from '@/lib/types';
import { useData, useDebounced } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

const LAYERS: { id: ActivityLayer; label: string; icon: typeof Cog }[] = [
  { id: 'change', label: 'Perubahan', icon: Cog },
  { id: 'account', label: 'Akun', icon: KeyRound },
  { id: 'export', label: 'Unduhan', icon: FileDown },
  { id: 'view', label: 'Sekadar melihat', icon: Eye },
];
const DEFAULT_LAYERS: ActivityLayer[] = ['change', 'account', 'export'];
const ROLE: Record<string, string> = { admin: 'Administrator platform', company_admin: 'Super admin company', user: 'Anggota', system: 'Sistem otomatis' };
type Filters = { actor: string; action: string; layers: ActivityLayer[]; from: string; to: string };
const detailLabel = (key: string) => key.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toLocaleUpperCase('id-ID'));
const defaults = (): Filters => ({ actor: '', action: '', layers: [...DEFAULT_LAYERS], from: '', to: '' });

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
            <dt className="font-medium text-foreground">{detailLabel(key)}</dt>
            <dd className="min-w-0 break-words"><Detail value={item} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return typeof value === 'number' ? value.toLocaleString('id-ID') : typeof value === 'string' ? value : JSON.stringify(value);
}


function ActivityDetail({ row }: { row: ActivityRow }) {
  const layer = LAYERS.find((item) => item.id === row.layer);
  return <section className="activity-detail" aria-label="Detail aktivitas">
    <article className="activity-detail-panel"><div className="activity-detail-summary"><div><p>{row.action_label}</p><h3>{row.summary}</h3></div><span className="activity-status" data-failed={row.failed}>{row.failed ? 'Gagal' : 'Tercatat'}</span></div>
      <dl className="activity-detail-facts">
        <div><dt><UserRound size={15} />Pengguna</dt><dd>{row.actor_name}</dd></div>
        <div><dt><Mail size={15} />Email</dt><dd>{row.actor_email ?? '—'}</dd></div>
        <div><dt><ShieldCheck size={15} />Peran</dt><dd>{ROLE[row.actor_role ?? 'system'] ?? row.actor_role}{row.as_admin && <span className="activity-admin-label">Sebagai administrator</span>}</dd></div>
        <div><dt><Building2 size={15} />Perusahaan</dt><dd>{row.company_name ?? '—'}</dd></div>
        <div><dt><CalendarDays size={15} />Waktu</dt><dd>{dateTime(row.at)}</dd></div>
        <div><dt><Cog size={15} />Kategori</dt><dd>{layer?.label ?? row.layer}</dd></div>
        {row.repeat_count > 1 && <><div><dt>Jumlah kejadian</dt><dd>{row.repeat_count.toLocaleString('id-ID')} kali</dd></div><div><dt>Pertama terjadi</dt><dd>{dateTime(row.first_at)}</dd></div></>}
      </dl>
      <section className="activity-detail-values"><h3>Rincian aktivitas</h3>{Object.keys(row.details ?? {}).length ? <Detail value={row.details} /> : <p>Tidak ada rincian tambahan.</p>}</section>
    </article>
  </section>;
}

function ActivityCard({ row, onDetail }: { row: ActivityRow; onDetail: () => void }) {
  return <li className="activity-mobile-card">
    <header><div><h2>{row.actor_name}</h2><p className="activity-secondary">{row.actor_email ?? ROLE[row.actor_role ?? 'system'] ?? row.actor_role}</p>{row.as_admin && <span className="activity-admin-label"><ShieldCheck size={12} aria-hidden="true" />Administrator</span>}</div><span className="activity-status" data-failed={row.failed}>{row.failed ? 'Gagal' : 'Tercatat'}</span></header>
    <p className="activity-card-summary">{row.summary}</p>
    <dl><div><dt><Building2 size={13} aria-hidden="true" />Perusahaan</dt><dd>{row.company_name ?? '—'}</dd></div><div><dt><CalendarDays size={13} aria-hidden="true" />Waktu</dt><dd>{dateTime(row.at)}</dd></div></dl>
    <footer><span>{row.action_label}{row.repeat_count > 1 ? ` · ${row.repeat_count.toLocaleString('id-ID')} kali` : ''}</span><Button variant="secondary" aria-label={`Detail aktivitas ${row.id}`} onPress={onDetail}><Eye size={14} aria-hidden="true" />Detail</Button></footer>
  </li>;
}

/** Numbered pages fetch only the selected page from the server. */
export default function ActivityPage({ params, navigate }: { params?: URLSearchParams; navigate?: Navigate }) {
  const api = useApi();
  const viewport = useTableViewport();
  const company = params?.get('company') ?? '';
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState<Filters & { company: string }>(() => ({ ...defaults(), company }));
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 400);
  const [pageSize, setPageSize] = useState(20);
  const [paging, setPaging] = useState<{ key: string; index: number; total: number | null }>({ key: '', index: 0, total: null });
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const closeDetail = useCallback(() => setSelected(null), []);
  usePageHeading(selected ? 'Detail aktivitas' : null, closeDetail);
  const modal = useOverlayState();
  const filter = { company, actor: filters.actor, action: filters.action, layers: filters.layers.join(','), date_from: filters.from, date_to: filters.to, q: search, limit: pageSize };
  const key = JSON.stringify(filter);
  const current = paging.key === key ? paging : { key, index: 0, total: null };
  const requestKey = `${key}|${current.index}`;
  const options = useData((signal) => api.get<ActivityFilters>('/admin/activity/filters', signal), []);
  const result = useData(async (signal) => ({ key: requestKey, page: await api.get<Page>(`/admin/activity?${query({ ...filter, offset: current.index * pageSize, include_total: current.index === 0 })}`, signal) }), [requestKey]);
  const data = result.data?.key === requestKey ? result.data.page : undefined;
  const loading = result.loading || (!data && !result.error);
  const total = data?.total ?? current.total;
  const totalPages = total === null ? '…' : Math.max(1, Math.ceil(total / pageSize));
  const pageNumbers = getPaginationPages(current.index + 1, typeof totalPages === 'number' ? totalPages : current.index + 1, viewport);
  const activeFilters: { id: string; label: string; value: string; remove: () => void }[] = [];
  if (company) activeFilters.push({ id: 'company', label: 'Perusahaan', value: options.data?.companies.find((item) => item.id === company)?.name ?? company, remove: () => navigate?.('aktivitas') });
  if (filters.actor) activeFilters.push({ id: 'actor', label: 'Pengguna', value: filters.actor === 'system' ? 'Sistem (otomatis)' : options.data?.actors.find((item) => item.email === filters.actor)?.name ?? filters.actor, remove: () => setFilters((value) => ({...value,actor:''})) });
  if (filters.action) activeFilters.push({ id: 'action', label: 'Jenis', value: options.data?.actions.find((item) => item.id === filters.action)?.label ?? filters.action, remove: () => setFilters((value) => ({...value,action:''})) });
  if (filters.from) activeFilters.push({ id: 'from', label: 'Dari', value: filters.from, remove: () => setFilters((value) => ({...value,from:''})) });
  if (filters.to) activeFilters.push({ id: 'to', label: 'Sampai', value: filters.to, remove: () => setFilters((value) => ({...value,to:''})) });
  if (filters.layers.join(',') !== DEFAULT_LAYERS.join(',')) activeFilters.push({ id: 'layers', label: 'Kategori', value: LAYERS.filter((item) => filters.layers.includes(item.id)).map((item) => item.label).join(', '), remove: () => setFilters((value) => ({...value,layers:[...DEFAULT_LAYERS]})) });
  const count = activeFilters.length;
  const openFilters = () => { setDraft({ ...filters, layers: [...filters.layers], company }); modal.open(); };
  const toggleLayer = (id: ActivityLayer) => setDraft((value) => ({ ...value, layers: LAYERS.map((layer) => layer.id).filter((layer) => layer === id ? !value.layers.includes(id) : value.layers.includes(layer)) }));
  const applyFilters = () => {
    const { company: chosen, ...next } = draft;
    setFilters(next);
    if (chosen !== company) navigate?.('aktivitas', { company: chosen || undefined });
    modal.close();
  };
  const goToPage = (index: number) => { if (!loading && index >= 0 && (typeof totalPages !== 'number' || index < totalPages)) setPaging({ key, index, total }); };
  const nextPage = () => { if (data?.next) goToPage(current.index + 1); };
  const previousPage = () => goToPage(current.index - 1);

  if (selected) return <div className="general-settings activity-page"><ActivityDetail row={selected} /></div>;
  return <div className="general-settings activity-page">
    <header className="activity-toolbar"><div className="team-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Cari aktivitas" placeholder="Cari aktivitas, nama, atau email…" value={text} onChange={(event) => setText(event.target.value)} />{text && <button type="button" aria-label="Hapus pencarian" onClick={() => setText('')}><X size={14} /></button>}</div><Button className="activity-filter-button" variant="secondary" onPress={openFilters}><SlidersHorizontal size={16} />Filter{count > 0 && <span className="activity-filter-count">{count}</span>}</Button></header>
    {count > 0 && <div className="activity-applied-filters">{activeFilters.map((item) => <span key={item.id} className="activity-filter-badge"><span><strong>{item.label}:</strong> {item.value}</span><button type="button" aria-label={`Hapus filter ${item.label}`} onClick={item.remove}><X size={13} aria-hidden="true" /></button></span>)}</div>}
    <ErrorNotice message={result.error} onRetry={result.reload} />
    {loading && !data && <LoadingRows rows={5} />}
    {data && !data.rows.length && <EmptyState title="Belum ada aktivitas" description="Tidak ada catatan yang cocok dengan pencarian atau filter ini." />}
    {data && !!data.rows.length && <div className="activity-data">{viewport === 'mobile' ? <ul className="activity-mobile-cards" aria-label="Daftar aktivitas">{data.rows.map((row) => <ActivityCard key={row.id} row={row} onDetail={() => setSelected(row)} />)}</ul> : <div className="sales-table-wrap"><table className="sales-table activity-table" aria-label="Daftar aktivitas"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Perusahaan</th><th>Aktivitas</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td className="activity-time">{dateTime(row.at)}</td><td><strong className="activity-actor">{row.actor_name}</strong><span className="activity-secondary">{row.actor_email ?? ROLE[row.actor_role ?? 'system'] ?? row.actor_role}</span>{row.as_admin && <span className="activity-admin-label"><ShieldCheck size={12} />Administrator</span>}</td><td>{row.company_name ?? '—'}</td><td className="activity-summary"><span>{row.summary}</span><span className="activity-secondary">{row.action_label}{row.repeat_count > 1 ? ` · ${row.repeat_count.toLocaleString('id-ID')} kali` : ''}</span></td><td><span className="activity-status" data-failed={row.failed}>{row.failed ? 'Gagal' : 'Tercatat'}</span></td><td><Button variant="secondary" aria-label={`Detail aktivitas ${row.id}`} onPress={() => setSelected(row)}><Eye size={14} />Detail</Button></td></tr>)}</tbody></table></div>}
      <footer className="sales-pagination activity-pagination"><label>Show<select aria-label="Jumlah aktivitas per halaman" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[20,50,100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><nav aria-label="Pagination aktivitas"><button type="button" aria-label="Halaman sebelumnya" disabled={current.index === 0 || loading} onClick={previousPage}><ChevronLeft size={16} /></button>{pageNumbers.map((number) => typeof number === 'number' ? <button type="button" key={number} aria-label={`Halaman ${number}`} aria-current={number === current.index + 1 ? 'page' : undefined} disabled={loading} onClick={() => goToPage(number - 1)}>{number}</button> : <span key="gap" className="px-1">{number}</span>)}<button type="button" aria-label="Halaman berikutnya" disabled={!data.next || loading} onClick={nextPage}><ChevronRight size={16} /></button></nav><p>Halaman {current.index + 1} dari {totalPages}</p></footer>
    </div>}
    <Modal.Backdrop isOpen={modal.isOpen} onOpenChange={(open) => modal.setOpen(open)}><Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog activity-filter-dialog"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>Filter aktivitas</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body"><ErrorNotice message={options.error} onRetry={options.reload} /><section className="activity-filter-section"><h3>Pengguna &amp; aktivitas</h3><div className="activity-filter-grid"><FilterSelect label="Perusahaan" allLabel="Semua perusahaan" value={draft.company} onChange={(company) => setDraft((value) => ({...value,company}))} items={(options.data?.companies ?? []).map((item) => ({id:item.id,label:item.name}))} /><FilterSelect label="Pengguna" allLabel="Semua pengguna" value={draft.actor} onChange={(actor) => setDraft((value) => ({...value,actor}))} items={[{id:'system',label:'Sistem (otomatis)'},...(options.data?.actors ?? []).map((item) => ({id:item.email,label:`${item.name} — ${item.email}`}))]} /><div className="activity-filter-full"><FilterSelect label="Jenis aktivitas" allLabel="Semua jenis" value={draft.action} onChange={(action) => setDraft((value) => ({...value,action}))} items={(options.data?.actions ?? []).map((item) => ({id:item.id,label:item.label}))} /></div></div></section><section className="activity-filter-section"><h3>Periode</h3><div className="activity-filter-grid"><label>Dari tanggal<input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft((value) => ({...value, from:event.target.value}))} /></label><label>Sampai tanggal<input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft((value) => ({...value, to:event.target.value}))} /></label></div></section><fieldset className="activity-filter-section"><legend>Kategori</legend><div className="activity-layer-options">{LAYERS.map(({id,label,icon:Icon}) => <label key={id}><input type="checkbox" checked={draft.layers.includes(id)} onChange={() => toggleLayer(id)} /><Icon size={15} aria-hidden="true" />{label}</label>)}</div><p>Pilih minimal satu kategori. Aktivitas sekadar melihat tidak ditampilkan secara default.</p></fieldset></Modal.Body><Modal.Footer className="activity-filter-footer"><Button variant="tertiary" onPress={() => setDraft({...defaults(),company:''})}>Reset</Button><div><Button variant="secondary" slot="close">Batal</Button><Button isDisabled={!draft.layers.length || Boolean(draft.from && draft.to && draft.from > draft.to)} onPress={applyFilters}>Terapkan</Button></div></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </div>;
}

function FilterSelect({ label, allLabel, value, onChange, items }: { label: string; allLabel: string; value: string; onChange: (value: string) => void; items: {id: string; label: string}[] }) {
  return <ComboBox className="activity-search-select" aria-label={label} value={value || '__all__'} onChange={(key) => onChange(!key || key === '__all__' ? '' : String(key))} menuTrigger="focus" fullWidth><Label>{label}</Label><ComboBox.InputGroup><Input placeholder={`Cari ${label.toLocaleLowerCase('id-ID')}…`} /><ComboBox.Trigger /></ComboBox.InputGroup><ComboBox.Popover className="activity-select-popover"><ListBox renderEmptyState={() => <p className="p-3 text-sm">Tidak ditemukan.</p>}><ListBox.Item id="__all__" textValue={allLabel}>{allLabel}<ListBox.ItemIndicator /></ListBox.Item>{items.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={item.label}>{item.label}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></ComboBox.Popover></ComboBox>;
}
