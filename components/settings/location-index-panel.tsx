'use client';

import { useRef, useState } from 'react';
import { Button, Chip, Label, SearchField, TextArea, TextField } from '@heroui/react';
import { MapPin, Upload } from 'lucide-react';
import { Notice, Panel } from '@/components/app/primitives';
import { errorMessage, isAbort, query } from '@/lib/api';
import { useData, useDebounced } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type Cluster = { id: string; name: string; aliases: string[]; area: string; neighbor_count?: number; distance_km?: number };
type Catalog = { clusters: Cluster[]; total: number; pairs: number; has_more: boolean; filtered_total: number; sources: string[] };
type Preview = { clusters: number; pairs: number; new_clusters: number; new_pairs: number; new_aliases: number; revision: string };

/** Which place names mean the same cluster, and which clusters sit within 4 km of each other. */
export function LocationIndexPanel({ processing, onImported }: { processing: boolean; onImported: () => void }) {
  const api = useApi();
  const [search, setSearch] = useState('');
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
  const neighbors = useData((signal) => api.get<{ cluster: Cluster; neighbors: Cluster[] }>(`/location-index/neighbors?${query({ cluster: selectedId })}`, signal), [selectedId, version], !!selectedId);

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

  return (
    <Panel title={<span className="flex items-center gap-2"><MapPin className="size-5 text-accent" aria-hidden="true" />Indeks kedekatan lokasi</span>}
      description="Nama lain dikenali sebagai cluster yang sama. Cluster berbeda dapat ditawarkan sebagai alternatif sampai 4 km, selama syarat properti tetap sesuai.">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Chip variant="soft" size="lg">{data?.total ?? 0} cluster</Chip><Chip variant="soft" size="lg">{data?.pairs ?? 0} pasangan jarak</Chip><Chip color="accent" variant="soft" size="lg">Batas 4 km</Chip></div>
        <Notice>Jarak mengikuti angka antarcluster pada data impor, bukan jarak perjalanan dari alamat unit. Alternatif lokasi paling tinggi Warm; permintaan lokasi khusus tetap dihormati.</Notice>
        <Button variant="secondary" size="lg" isDisabled={busy || processing} onPress={() => setImporting((value) => !value)}><Upload className="size-4" aria-hidden="true" />{importing ? 'Tutup penambahan' : 'Tambah indeks dari CSV / Excel'}</Button>

        {importing && (
          <section className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/30 p-4">
            <p className="text-base leading-relaxed">Unggah CSV/TSV atau tempel tabel dari Excel. Kolom: <strong>Cluster</strong>, <strong>Alias</strong>, <strong>Area/Development</strong>, <strong>Cluster Terdekat (dalam radius 4 km)</strong>. Pisahkan tetangga dengan titik koma, misalnya <em>Nama Cluster (1.1)</em>.</p>
            <input ref={file} aria-label="File CSV indeks lokasi" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" disabled={busy} className="block w-full text-base file:mr-3 file:min-h-11 file:rounded-xl file:border file:border-border file:bg-surface file:px-4 file:font-semibold" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <p className="break-all text-sm text-muted">{sourceName}</p>
            <TextField value={text} onChange={(value) => { setText(value); setSourceName('Tempelan Excel'); setPreview(null); }} fullWidth isDisabled={busy}>
              <Label className="text-base font-bold">Tabel lokasi</Label><TextArea rows={7} className="font-mono text-sm" aria-label="Tabel lokasi" />
            </TextField>
            <Button variant="secondary" size="lg" isDisabled={!text.trim() || busy} isPending={busy && !preview} onPress={() => void inspect()}>Periksa penambahan</Button>
            {preview && (
              <div className="space-y-2 rounded-2xl bg-surface p-4 text-base">
                <p className="font-bold">Siap ditambahkan</p>
                <p>{preview.new_clusters} cluster baru · {preview.new_pairs} pasangan jarak baru · {preview.new_aliases} alias baru</p>
                <p className="text-muted">Total setelah digabung: {preview.clusters} cluster dan {preview.pairs} pasangan. Data yang sama tidak digandakan. Konflik jarak ditolak.</p>
                <Button size="lg" fullWidth isDisabled={busy || processing} isPending={busy} onPress={() => void save()}>Tambahkan &amp; proses ulang</Button>
              </div>
            )}
          </section>
        )}
        {error && <Notice status="danger">{error}</Notice>}
        {notice && <Notice status="success">{notice}</Notice>}

        <SearchField value={search} onChange={(value) => { setSearch(value); setOffset(0); }} aria-label="Cari cluster, alias, atau area">
          <Label className="text-base font-bold">Cari cluster, alias, atau area</Label>
          <SearchField.Group><SearchField.SearchIcon /><SearchField.Input className="h-12 text-base" placeholder="mis. Citraland" /><SearchField.ClearButton /></SearchField.Group>
        </SearchField>
        {catalog.loading && !data ? <p className="text-base text-muted">Memuat indeks…</p> : (
          <div className="max-h-72 overflow-y-auto rounded-2xl border border-border">
            {data?.clusters.map((cluster) => (
              <button type="button" key={cluster.id} aria-pressed={selectedId === cluster.id} onClick={() => setSelectedId(cluster.id)}
                className={`block min-h-14 w-full border-b border-separator px-4 py-2.5 text-left last:border-0 ${selectedId === cluster.id ? 'bg-accent-soft' : 'hover:bg-default'}`}>
                <span className="block text-base font-bold">{cluster.name}</span>
                <span className="text-sm text-muted">{cluster.area ? `${cluster.area} · ` : ''}{cluster.neighbor_count} lokasi terdekat{cluster.aliases.length ? ` · Alias: ${cluster.aliases.join(', ')}` : ''}</span>
              </button>
            ))}
            {!data?.clusters.length && <p className="p-5 text-base text-muted">Belum ada cluster untuk pencarian ini.</p>}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-base text-muted">
          <span>{data?.filtered_total ?? 0} hasil</span>
          <div className="flex gap-2"><Button variant="secondary" isDisabled={!offset || catalog.loading} onPress={() => setOffset((value) => Math.max(0, value - 30))}>Sebelumnya</Button><Button variant="secondary" isDisabled={!data?.has_more || catalog.loading} onPress={() => setOffset((value) => value + 30)}>Berikutnya</Button></div>
        </div>
        {selectedId && neighbors.data && (
          <section className="rounded-2xl border border-border p-4">
            <h4 className="text-base font-bold">Dekat {neighbors.data.cluster.name}</h4>
            <p className="mt-0.5 text-sm text-muted">Jarak menurut data impor, diurutkan dari terdekat.</p>
            <ul className="mt-3 max-h-64 divide-y divide-separator overflow-y-auto">
              {neighbors.data.neighbors.map((cluster) => <li key={cluster.id} className="flex items-start justify-between gap-3 py-2.5 text-base"><span>{cluster.name}</span><Chip variant="soft">{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(cluster.distance_km ?? 0)} km</Chip></li>)}
              {!neighbors.data.neighbors.length && <li className="py-2 text-base text-muted">Belum ada jarak tercatat.</li>}
            </ul>
          </section>
        )}
        {neighbors.error && !isAbort(neighbors.error) && <Notice status="danger">{neighbors.error}</Notice>}
      </div>
    </Panel>
  );
}
