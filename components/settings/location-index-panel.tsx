'use client';

import { useRef, useState } from 'react';
import { Button, Label, Modal, TextArea, TextField, useOverlayState } from '@heroui/react';
import { ChevronLeft, ChevronRight, MapPin, Search, Upload, X } from 'lucide-react';
import { SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { EmptyState, ErrorNotice } from '@/components/app/primitives';
import { useTableViewport } from '@/components/settings/settings-pagination';
import { errorMessage, query } from '@/lib/api';
import { useData, useDebounced } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type Cluster = { id: string; name: string; aliases: string[]; area: string; neighbor_count?: number; distance_km?: number };
type Catalog = { clusters: Cluster[]; total: number; pairs: number; has_more: boolean; filtered_total: number; sources: string[] };
type Preview = { clusters: number; pairs: number; new_clusters: number; new_pairs: number; new_aliases: number; revision: string };

/** Which place names mean the same cluster, and which clusters sit within 4 km of each other. */
export function LocationIndexPanel({ processing, onImported }: { processing: boolean; onImported: () => void }) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const details = useOverlayState();
  const mobile = useTableViewport() === 'mobile';
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('Tempelan Excel');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const term = useDebounced(search, 250);

  const catalog = useData((signal) => api.get<Catalog>(`/location-index?${query({ search: term, offset })}`, signal), [term, offset, version]);
  const neighbors = useData((signal) => api.get<{ cluster: Cluster; neighbors: Cluster[] }>(`/location-index/neighbors?${query({ cluster: selectedId })}`, signal), [selectedId, version, details.isOpen], !!selectedId && details.isOpen);

  async function chooseFile(input?: File) {
    if (!input) return;
    if (input.size > 3_000_000) { setError('Ukuran file maksimal 3 MB.'); return; }
    setText(await input.text()); setSourceName(input.name); setPreview(null); setError('');
    if (file.current) file.current.value = '';
  }
  async function inspect() {
    setBusy(true); setError(''); setNotice('');
    try { setPreview(await api.post<Preview>('/location-index/preview', { text, source_name: sourceName })); }
    catch (reason) { setPreview(null); setError(errorMessage(reason, 'Pemeriksaan gagal')); } finally { setBusy(false); }
  }
  async function save() {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<{ unchanged: boolean }>('/location-index/import', { text, source_name: sourceName, revision: preview.revision });
      setNotice(result.unchanged ? 'Semua data ini sudah ada. Tidak ada duplikat yang ditambahkan.' : 'Indeks ditambahkan. Pencocokan masuk antrean proses ulang.');
      setPreview(null); setText(''); setImporting(false); setVersion((value) => value + 1); onImported();
    } catch (reason) { setPreview(null); setError(errorMessage(reason, 'Penyimpanan gagal')); } finally { setBusy(false); }
  }
  const data = catalog.data;
  const page = Math.floor(offset / 30) + 1;
  const pages = Math.max(1, Math.ceil((data?.filtered_total ?? 0) / 30));
  const first = Math.max(1, Math.min(page - 1, pages - 2));
  const numbers = Array.from({ length: Math.min(3, pages) }, (_, index) => first + index);
  const openDetail = (id: string) => { setSelectedId(id); details.open(); };
  const neighborData = neighbors.data?.cluster.id === selectedId ? neighbors.data : null;

  return <SettingsSection tab="pencocokan" icon={MapPin} title="Indeks kedekatan lokasi" description="Kelola alias cluster dan kedekatan lokasi hingga 4 km.">
    <div className="location-index-toolbar">
      {!!data?.total && <div className="location-catalog-search">
        <Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari cluster, alias, atau area" placeholder="Cari cluster, alias, atau area…" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
        {search && <button type="button" aria-label="Hapus pencarian cluster" onClick={() => { setSearch(''); setOffset(0); }}><X className="size-3.5" /></button>}
      </div>}
      <Button variant="secondary" className="shrink-0" isDisabled={busy || processing} onPress={() => { setError(''); setImporting(true); }}><Upload className="size-4" aria-hidden="true" />Tambah indeks</Button>
    </div>
    <ErrorNotice message={catalog.error} onRetry={catalog.reload} />
    {notice && <SettingsNote tone="success">{notice}</SettingsNote>}
    {catalog.loading && !data ? <p className="text-sm text-muted">Memuat indeks…</p> : data && data.total === 0 ? <EmptyState compact title="Belum ada indeks lokasi" description="Tambahkan data CSV atau Excel untuk mengenali alias cluster dan lokasi terdekat." /> : data && <>
      {mobile ? <div className="sales-cards">{data.clusters.map((cluster) => <article className="sales-card" key={cluster.id}>
        <h3>{cluster.name}</h3><dl><div><dt>Alias</dt><dd>{cluster.aliases.join(', ') || '—'}</dd></div><div><dt>Area</dt><dd>{cluster.area || '—'}</dd></div><div><dt>Terdekat</dt><dd>{cluster.neighbor_count ?? 0} lokasi</dd></div></dl><Button variant="secondary" className="w-full" onPress={() => openDetail(cluster.id)}>Detail</Button>
      </article>)}{!data.clusters.length && <p className="p-3 text-sm">Cluster tidak ditemukan.</p>}</div> : <div className="sales-table-wrap"><table className="sales-table location-index-table"><thead><tr><th>Cluster</th><th>Alias</th><th>Area</th><th>Lokasi terdekat</th><th>Aksi</th></tr></thead><tbody>
        {data.clusters.map((cluster) => <tr key={cluster.id}><td className="font-medium">{cluster.name}</td><td>{cluster.aliases.join(', ') || '—'}</td><td>{cluster.area || '—'}</td><td>{cluster.neighbor_count ?? 0}</td><td><Button variant="secondary" onPress={() => openDetail(cluster.id)}>Detail</Button></td></tr>)}
        {!data.clusters.length && <tr><td colSpan={5}>Cluster tidak ditemukan.</td></tr>}
      </tbody></table></div>}
      <footer className="matching-glossary-pagination"><span>{data.filtered_total} Cluster</span><nav aria-label="Pagination cluster">
        <button type="button" aria-label="Halaman cluster sebelumnya" disabled={!offset || catalog.loading} onClick={() => setOffset(Math.max(0, offset - 30))}><ChevronLeft className="size-4" /></button>
        {numbers.map((number) => <button type="button" key={number} aria-label={`Halaman cluster ${number}`} aria-current={page === number ? 'page' : undefined} disabled={catalog.loading} onClick={() => setOffset((number - 1) * 30)}>{number}</button>)}
        <button type="button" aria-label="Halaman cluster berikutnya" disabled={!data.has_more || catalog.loading} onClick={() => setOffset(offset + 30)}><ChevronRight className="size-4" /></button>
      </nav></footer>
    </>}

    <Modal.Backdrop isOpen={importing} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!busy) setImporting(open); }}>
      <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog location-import-dialog">
        {!busy && <Modal.CloseTrigger />}<Modal.Header><Modal.Heading>Tambah indeks lokasi</Modal.Heading></Modal.Header>
        <Modal.Body className="sales-dialog-body space-y-3">
          <SettingsNote>Unggah CSV/TSV atau tempel tabel dari Excel. Kolom: Cluster, Alias, Area/Development, dan Cluster Terdekat (dalam radius 4 km). Pisahkan tetangga dengan titik koma, misalnya Nama Cluster (1.1).</SettingsNote>
          <SettingsNote>Jarak mengikuti data antarcluster yang diimpor, bukan jarak perjalanan dari alamat unit. Alternatif lokasi paling tinggi Warm dan tetap mengikuti syarat properti.</SettingsNote>
          <input ref={file} aria-label="File CSV indeks lokasi" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" disabled={busy} className="block w-full text-sm file:mr-3 file:min-h-9 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:font-normal" onChange={(event) => void chooseFile(event.target.files?.[0])} />
          <p className="break-all text-xs text-muted">{sourceName}</p>
          <TextField value={text} onChange={(value) => { setText(value); setSourceName('Tempelan Excel'); setPreview(null); }} fullWidth isDisabled={busy}><Label>Tabel lokasi</Label><TextArea rows={7} aria-label="Tabel lokasi" /></TextField>
          {preview && <div className="space-y-2 border-t border-separator pt-3 text-sm"><p className="font-medium">Siap ditambahkan</p><p>{preview.new_clusters} cluster baru · {preview.new_pairs} pasangan jarak baru · {preview.new_aliases} alias baru</p><SettingsNote>Total setelah digabung: {preview.clusters} cluster dan {preview.pairs} pasangan. Data yang sama tidak digandakan. Konflik jarak ditolak.</SettingsNote></div>}
          {error && <SettingsNote tone="danger">{error}</SettingsNote>}
        </Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={busy} onPress={() => setImporting(false)}>Batal</Button>{preview ? <Button isDisabled={busy || processing} isPending={busy} onPress={() => void save()}>Tambahkan &amp; proses ulang</Button> : <Button isDisabled={!text.trim() || busy || processing} isPending={busy} onPress={() => void inspect()}>Periksa penambahan</Button>}</Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>

    <Modal.Backdrop isOpen={details.isOpen} onOpenChange={(open) => details.setOpen(open)}>
      <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog location-detail-dialog">
        <Modal.CloseTrigger /><Modal.Header><Modal.Heading>Detail kedekatan lokasi</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body space-y-3">
          <ErrorNotice message={neighbors.error} onRetry={neighbors.reload} />
          {neighbors.loading ? <p className="text-sm">Memuat kedekatan lokasi…</p> : neighborData && <>
            <h3 className="text-sm font-medium">{neighborData.cluster.name}</h3><dl className="location-cluster-meta"><dt>Alias</dt><dd>{neighborData.cluster.aliases.join(', ') || '—'}</dd><dt>Area</dt><dd>{neighborData.cluster.area || '—'}</dd></dl>
            <p className="text-xs text-muted">Lokasi diurutkan dari yang terdekat berdasarkan data impor.</p>
            {neighborData.neighbors.length ? <ul className="divide-y divide-separator">{neighborData.neighbors.map((cluster) => <li className="flex items-start justify-between gap-3 py-2 text-sm" key={cluster.id}><span>{cluster.name}</span><span className="shrink-0">{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(cluster.distance_km ?? 0)} km</span></li>)}</ul> : <p className="text-sm">Belum ada jarak tercatat untuk cluster ini.</p>}
          </>}
        </Modal.Body>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </SettingsSection>;
}
