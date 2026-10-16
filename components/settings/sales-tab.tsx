'use client';
import { useState, useSyncExternalStore } from 'react';
import { Button, Dropdown, Label, type useOverlayState } from '@heroui/react';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Pencil, PhoneCall, Plus, Trash2 } from 'lucide-react';
import { EmptyState, ErrorNotice } from '@/components/app/primitives';
import { SalesDialog, type SalesAction } from './sales-dialogs';
import { getPaginationPages } from './settings-pagination';
import { useSectionSearchLabel, useSectionSearchQuery } from '@/lib/section-search';
import { phoneSearchQuery } from '@/lib/section-search-utils';
import { formatPhone } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { StockOverview, StockTracked } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

function subscribeMobile(callback: () => void) {
  const media = window.matchMedia('(max-width: 500px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function SalesRow({ item, index, mobile, admin, onAction }: { item: StockTracked; index: number; mobile: boolean; admin: boolean; onAction: (action: SalesAction) => void }) {
  const name = useSectionSearchLabel(item.label || item.contact_name || 'Sales', 'sales');
  const phone = useSectionSearchLabel(formatPhone(item.phone), 'sales', item.phone);
  const [expanded, setExpanded] = useState(false);
  const actions = mobile ? <><button type="button" className="sales-action-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Aksi<ChevronDown size={14} /></button>{expanded && <div className="sales-card-actions"><button onClick={() => onAction({ type: 'edit', item })}><Pencil size={14} />Edit</button><button onClick={() => onAction({ type: 'delete', item })}><Trash2 size={14} />Hapus</button></div>}</> : (
    <Dropdown><Dropdown.Trigger className="sales-action-button" aria-label={`Aksi untuk ${item.label || item.phone}`}>Aksi<ChevronDown size={14} /></Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end" className="sales-action-menu"><Dropdown.Menu aria-label="Aksi nomor sales" onAction={(key) => onAction({ type: key === 'edit' ? 'edit' : 'delete', item })}>
        <Dropdown.Item id="edit" textValue="Edit"><Pencil className="size-3.5" /><Label>Edit</Label></Dropdown.Item>
        <Dropdown.Item id="delete" textValue="Hapus" variant="danger"><Trash2 className="size-3.5 text-danger" /><Label>Hapus</Label></Dropdown.Item>
      </Dropdown.Menu></Dropdown.Popover>
    </Dropdown>
  );
  return mobile ? <article className="sales-card"><h3 id={name.id}>{name.content}</h3><dl><div><dt>Nomor</dt><dd id={phone.id}>{phone.content}</dd></div><div><dt>Stok ready</dt><dd>{item.counts.ready}</dd></div></dl>{admin && actions}</article> : <tr><td>{index}</td><td id={name.id} className="font-medium">{name.content}</td><td id={phone.id}>{phone.content}</td><td>{item.counts.ready}</td>{admin && <td className="text-center">{actions}</td>}</tr>;
}

export function SalesTab({ navigate, editor }: { navigate?: Navigate; editor: ReturnType<typeof useOverlayState> }) {
  const api = useApi();
  const { company, refresh } = useCompany();
  const admin = !!company?.permissions.manage_settings;
  const overview = useData((signal) => api.get<StockOverview>('/stock/overview', signal), []);
  const tracked = overview.data?.tracked ?? [];
  const heading = useSectionSearchLabel('Nomor sales yang dipantau', 'sales');
  const query = useSectionSearchQuery();
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 500px)').matches, () => false);
  const [pageSize, setPageSize] = useState(20);
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const [action, setAction] = useState<SalesAction | null>(null);
  const phoneQuery = phoneSearchQuery(query);
  const filtered = tracked.filter((item) => !query || (item.label || item.contact_name || 'Sales').toLocaleLowerCase('id-ID').includes(query) || (phoneQuery && item.phone.includes(phoneQuery)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(paging.query === query ? paging.page : 1, totalPages);
  const start = (page - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);
  const pages = getPaginationPages(page, totalPages, mobile ? 'mobile' : 'desktop');
  const setPage = (next: number) => setPaging({ query, page: next });
  const close = () => { setAction(null); editor.close(); };
  const currentAction = action ?? (editor.isOpen ? { type: 'add' as const } : null);
  return (
    <section className="general-settings sales-settings" aria-labelledby={heading.id}>
      <header className="sales-section-header"><div><h2 id={heading.id} className="flex items-center gap-2 text-[0.9375rem] font-medium text-foreground"><PhoneCall className="size-4 shrink-0" aria-hidden="true" /><span>{heading.content}</span></h2><p className="mt-1 text-sm text-muted">Stok dihitung dari nomor kontak yang tertulis dalam pesan listing. Jumlahnya diperbarui saat data diimpor atau status listing berubah.</p></div>
        <div className="sales-section-actions">{admin && <Button isDisabled={!overview.data} onPress={() => editor.open()}><Plus className="size-4" />Tambah nomor</Button>}<Button variant="secondary" onPress={() => navigate?.('stok')}>Buka Stok Sales<ArrowUpRight className="size-4" /></Button></div>
      </header>
      <ErrorNotice message={overview.error} onRetry={overview.reload} />
      {overview.loading && !overview.data ? <p className="py-4 text-sm text-muted">Memuat nomor sales…</p> : !tracked.length && !overview.error ? (
        <EmptyState compact animation="searching" title="Belum ada nomor yang dipantau" description={admin ? 'Klik “Tambah nomor”, lalu masukkan nomor sales yang ingin dipantau.' : 'Super admin company dapat menambahkan nomor.'} />
      ) : tracked.length > 0 ? <>
        {mobile ? <div className="sales-cards">{visible.map((item, index) => <SalesRow key={item.phone} item={item} index={start + index + 1} mobile admin={admin} onAction={setAction} />)}{!visible.length && <p className="p-4 text-sm">Nama atau nomor tidak ditemukan.</p>}</div> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>No</th><th>Nama sales</th><th>Nomor telepon</th><th>Stok ready</th>{admin && <th className="text-center">Aksi</th>}</tr></thead><tbody>{visible.map((item, index) => <SalesRow key={item.phone} item={item} index={start + index + 1} mobile={false} admin={admin} onAction={setAction} />)}{!visible.length && <tr><td colSpan={admin ? 5 : 4}>Nama atau nomor tidak ditemukan.</td></tr>}</tbody></table></div>}
        <footer className="sales-pagination"><label>Show <select aria-label="Jumlah nomor per halaman" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <nav aria-label="Pagination nomor sales"><button aria-label="Halaman sebelumnya" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>{pages.map((number) => typeof number === 'number' ? <button key={number} aria-label={`Halaman ${number}`} aria-current={number === page ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button> : <span key="gap" className="px-1">{number}</span>)}<button aria-label="Halaman berikutnya" disabled={page === totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></nav><p>Halaman {page} dari {totalPages}</p>
        </footer>
      </> : null}
      {currentAction && admin && <SalesDialog key={currentAction.type === 'add' ? 'add' : `${currentAction.type}:${currentAction.item.phone}`} action={currentAction} onClose={close} onSaved={(data) => { overview.setData(data); refresh(); }} />}
    </section>
  );
}
