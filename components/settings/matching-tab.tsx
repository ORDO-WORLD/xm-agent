'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, Input, Label, Modal, TextField, Tooltip, toast, useOverlayState } from '@heroui/react';
import { ArrowRight, BookText, ChevronLeft, ChevronRight, FileSpreadsheet, Pencil, Percent, Plus, RefreshCw, Save, Scale, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/app/primitives';
import { LocationIndexPanel } from '@/components/settings/location-index-panel';
import { SettingsLabel, SettingsNote, SettingsSection } from '@/components/settings/settings-section';
import { useSectionSearchQuery } from '@/lib/section-search';
import { errorMessage } from '@/lib/api';
import { prepareGlossaryCsv, type CsvPreview } from '@/lib/csv';
import { useCompany } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

type Settings = {
  land_tolerance_pct: number; building_tolerance_pct: number; price_tolerance_pct: number;
  location_weight_pct: number; land_weight_pct: number; building_weight_pct: number;
  price_weight_pct: number; semantic_weight_pct: number; data_quality_weight_pct: number;
};
type Job = { status: string; error?: string; result?: { documents: number; matches: number } } | null;

const TOLERANCES: [keyof Settings, string, string][] = [
  ['land_tolerance_pct', 'Luas tanah', 'Selisih luas tanah yang masih diterima'],
  ['building_tolerance_pct', 'Luas bangunan', 'Selisih luas bangunan yang masih diterima'],
  ['price_tolerance_pct', 'Harga', 'Selisih harga yang masih diterima (bila nego)'],
];
const WEIGHTS: [keyof Settings, string, string][] = [
  ['location_weight_pct', 'Lokasi', '#0a3be0'], ['land_weight_pct', 'Luas tanah', '#14b8d4'], ['building_weight_pct', 'Luas bangunan', '#7c3aed'],
  ['price_weight_pct', 'Harga', '#f59e0b'], ['semantic_weight_pct', 'Kemiripan teks', '#10b981'], ['data_quality_weight_pct', 'Kualitas data', '#64748b'],
];

function NumberBox({ label, hint, color, value, onChange, disabled }: { label: string; hint?: string; color?: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <TextField value={String(value)} onChange={(text) => onChange(Number(text.replace(',', '.')) || 0)} isDisabled={disabled} type="number" fullWidth>
      <Label className="flex items-center gap-2">{color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />}<SettingsLabel tab="pencocokan">{`${label} (%)`}</SettingsLabel></Label>
      <Input min={0} max={100} inputMode="decimal" />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </TextField>
  );
}

export function MatchingTab() {
  const api = useApi();
  const { company, refresh } = useCompany();
  const admin = !!company?.permissions.manage_settings;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [glossary, setGlossary] = useState<[string, string][]>([]);
  const [csv, setCsv] = useState<CsvPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job>(null);
  const preview = useOverlayState();
  const glossaryEditor = useOverlayState();
  const [editingTerm, setEditingTerm] = useState<number | null>(null);
  const [termDrafts, setTermDrafts] = useState<{ id: number; alias: string; canonical: string }[]>([]);
  const draftId = useRef(0);
  const glossaryPageSize = 10;
  const [glossaryPaging, setGlossaryPaging] = useState({ query: '', page: 1 });
  const glossaryQuery = useSectionSearchQuery();
  const file = useRef<HTMLInputElement>(null);
  const processing = job?.status === 'queued' || job?.status === 'processing';

  useEffect(() => {
    void Promise.all([api.get<Settings>('/settings'), api.get<Record<string, string>>('/glossary')]).then(([values, entries]) => {
      setSettings(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) as Settings);
      setGlossary(Object.entries(entries));
    }).catch((reason) => setError(errorMessage(reason)));
  }, [api]);

  const poll = useCallback(() => api.get<Job>('/index/status').then((next) => {
    setJob((previous) => {
      if (previous && (previous.status === 'processing' || previous.status === 'queued') && next?.status === 'completed') {
        toast.success(`Selesai: ${next.result?.documents ?? 0} pesan dan ${next.result?.matches ?? 0} kecocokan diperbarui.`);
        refresh();
      }
      return next;
    });
  }).catch(() => {}), [api, refresh]);
  useEffect(() => {
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, [poll]);

  const total = settings ? WEIGHTS.reduce((sum, [key]) => sum + Number(settings[key]), 0) : 0;
  const balanced = Math.abs(total - 100) < 0.001;
  const set = (key: keyof Settings, value: number) => { setSettings((current) => (current ? { ...current, [key]: value } : current)); setDirty(true); };
  const filteredGlossary = glossary.map(([alias, canonical], index) => ({ alias, canonical, index })).filter((entry) => !glossaryQuery || `${entry.alias} ${entry.canonical}`.toLocaleLowerCase('id-ID').includes(glossaryQuery));
  const glossaryPages = Math.max(1, Math.ceil(filteredGlossary.length / glossaryPageSize));
  const glossaryPage = Math.min(glossaryPaging.query === glossaryQuery ? glossaryPaging.page : 1, glossaryPages);
  const glossaryStart = (glossaryPage - 1) * glossaryPageSize;
  const setGlossaryPage = (page: number) => setGlossaryPaging({ query: glossaryQuery, page });
  const draftAliases = termDrafts.map((entry) => entry.alias.trim().toLocaleLowerCase('id-ID'));
  const termDuplicate = draftAliases.some((alias, index) => !!alias && (draftAliases.indexOf(alias) !== index || glossary.some(([existing], at) => at !== editingTerm && existing.trim().toLocaleLowerCase('id-ID') === alias)));
  const invalidTerms = !termDrafts.length || termDrafts.some((entry) => !entry.alias.trim() || !entry.canonical.trim() || entry.alias.trim().length > 100 || entry.canonical.trim().length > 100);
  const glossaryLimit = editingTerm === null && glossary.length + termDrafts.length > 500;
  const firstGlossaryPage = Math.max(1, Math.min(glossaryPage - 1, glossaryPages - 2));
  const glossaryPageNumbers = Array.from({ length: Math.min(3, glossaryPages) }, (_, index) => firstGlossaryPage + index);

  function openGlossary(index: number | null = null) {
    setEditingTerm(index); setTermDrafts([{ id: ++draftId.current, alias: index === null ? '' : glossary[index][0], canonical: index === null ? '' : glossary[index][1] }]); glossaryEditor.open();
  }
  function confirmTerm() {
    if (!admin || processing || busy || invalidTerms || termDuplicate || glossaryLimit) return;
    const entries: [string, string][] = termDrafts.map((entry) => [entry.alias.trim(), entry.canonical.trim()]);
    setGlossary((current) => editingTerm === null ? [...current, ...entries] : current.map((item, index) => index === editingTerm ? entries[0] : item));
    if (editingTerm === null) setGlossaryPage(Math.floor(glossary.length / glossaryPageSize) + 1);
    setDirty(true); glossaryEditor.close();
  }

  async function chooseCsv(chosen?: File) {
    if (!chosen) return;
    setError('');
    try {
      const prepared = prepareGlossaryCsv(chosen.name, await chosen.text());
      if (!prepared.rows.length) throw new Error('CSV tidak memiliki pasangan valid pada kolom A dan B.');
      setCsv(prepared); preview.open();
    } catch (reason) { setError(errorMessage(reason, 'CSV tidak dapat dibaca')); } finally { if (file.current) file.current.value = ''; }
  }
  function confirmCsv() {
    if (!csv) return;
    const merged = new Map(glossary.map(([alias, canonical]) => [alias.toLowerCase(), [alias, canonical] as [string, string]]));
    csv.rows.forEach(([alias, canonical]) => merged.set(alias.toLowerCase(), [alias, canonical]));
    setGlossary([...merged.values()]); setDirty(true); preview.close();
    toast.success(`${csv.rows.length} istilah dari ${csv.fileName} dimasukkan. Tekan “Simpan & proses” untuk menerapkan.`);
  }

  async function save() {
    if (!settings) return;
    setError('');
    if (!balanced) { setError('Total bobot harus tepat 100%.'); return; }
    const entries: Record<string, string> = {};
    for (const [alias, canonical] of glossary) {
      const key = alias.trim().toLowerCase();
      if (!key || !canonical.trim()) { setError('Lengkapi setiap pasangan glosarium sebelum menyimpan.'); return; }
      if (entries[key]) { setError(`Istilah duplikat: ${alias}`); return; }
      entries[key] = canonical.trim();
    }
    setBusy(true);
    try {
      await api.put('/settings', settings);
      await api.put('/glossary', { entries });
      setJob(await api.post<Job>('/index/recompute'));
      setDirty(false);
      toast.success('Tersimpan. Pencocokan dihitung ulang di latar belakang.');
    } catch (reason) { setError(errorMessage(reason, 'Pengaturan belum dapat disimpan')); } finally { setBusy(false); }
  }

  if (!settings) return <p className="text-base text-muted">{error || 'Memuat pengaturan…'}</p>;
  return (
    <div className="general-settings matching-settings">
      {!admin && <SettingsNote>Anda dapat melihat pengaturan ini, tetapi hanya super admin yang dapat mengubahnya.</SettingsNote>}
      {processing && <SettingsNote><RefreshCw className="mr-1.5 inline size-3.5 animate-spin" aria-hidden="true" />{job?.status === 'queued' ? 'Menunggu antrean' : 'Memproses seluruh data'} — Anda boleh berpindah halaman.</SettingsNote>}
      {job?.status === 'failed' && <SettingsNote tone="danger">Proses ulang gagal. {job.error}</SettingsNote>}

      <SettingsSection tab="pencocokan" icon={Percent} title="Toleransi" description="Batas selisih luas dan harga yang masih diterima dalam pencocokan.">
        <div className="matching-tolerance-inputs grid gap-3 sm:grid-cols-3">{TOLERANCES.map(([key, label, hint]) => <NumberBox key={key} label={label} hint={hint} value={settings[key]} disabled={!admin || processing} onChange={(value) => set(key, value)} />)}</div>
        <SettingsNote>Di luar toleransi tidak direkomendasikan. Hasil dalam toleransi paling tinggi Warm.</SettingsNote>
      </SettingsSection>

      <SettingsSection tab="pencocokan" icon={Scale} title="Bobot skor" description="Kontribusi tiap faktor terhadap skor pencocokan."
        action={<span className={cn('text-xs', balanced ? 'text-success' : 'text-danger')} aria-live="polite">Total {total}% / 100%</span>}>
        <figure className="m-0 flex h-1.5 overflow-hidden rounded-sm bg-default" aria-label="Pembagian bobot">
          {WEIGHTS.map(([key, label, color]) => <Tooltip key={key} delay={150}>
            <Tooltip.Trigger tabIndex={0} aria-label={`${label}: ${settings[key]}%`} className="matching-weight-segment" style={{ width: `${Math.max(0, Math.min(100, Number(settings[key])))}%`, backgroundColor: color }} />
            <Tooltip.Content className="matching-weight-tooltip"><span>{label}: <span className="font-medium">{settings[key]}%</span></span></Tooltip.Content>
          </Tooltip>)}
        </figure>
        <div className="matching-weight-inputs grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHTS.map(([key, label, color]) => (
            <div key={key}>
              <NumberBox label={label} color={color} value={settings[key]} disabled={!admin || processing} onChange={(value) => set(key, value)} />
            </div>
          ))}
        </div>
        <SettingsNote>Total bobot harus tepat 100%. Kebutuhan yang tidak disebut buyer tidak menambah skor.</SettingsNote>
      </SettingsSection>

      <section className="general-section matching-glossary-section">
          <div><h2 className="flex items-center gap-2 text-[0.9375rem] font-medium"><BookText className="size-4" aria-hidden="true" /><SettingsLabel tab="pencocokan">Glosarium</SettingsLabel></h2><p className="mt-1 text-sm text-muted">Pasangkan penulisan di chat dengan nama bakunya.</p></div>
          <div className="general-section-controls">
          {admin && <div className="matching-glossary-toolbar">{dirty && <Button className="matching-glossary-save" isPending={busy} isDisabled={processing || !balanced} onPress={save}><Save className="size-4" aria-hidden="true" />Simpan &amp; proses</Button>}<Button isDisabled={processing || busy || glossary.length >= 500} onPress={() => openGlossary()}><Plus className="size-4" aria-hidden="true" />Tambah istilah</Button><input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Pilih file CSV glosarium" onChange={(event) => void chooseCsv(event.target.files?.[0])} /><Button variant="secondary" isDisabled={processing || busy} onPress={() => file.current?.click()}><FileSpreadsheet className="size-4" aria-hidden="true" />Unggah CSV</Button></div>}
          {dirty && !balanced && <p role="alert" className="text-xs text-danger">Total bobot saat ini {total}%. Ubah hingga tepat 100% sebelum menyimpan.</p>}
        {!glossary.length ? <EmptyState compact title="Belum ada istilah glosarium" description={admin ? 'Tambah istilah atau unggah CSV untuk memasangkan penulisan di chat dengan nama bakunya.' : 'Super admin company dapat menambahkan istilah glosarium.'} /> : <>
          <ul className="matching-glossary-list">
            {filteredGlossary.slice(glossaryStart, glossaryStart + glossaryPageSize).map(({ alias, canonical, index }) => <li key={index} className="matching-glossary-card">
              <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm"><span className="break-words"><SettingsLabel tab="pencocokan">{alias}</SettingsLabel></span><ArrowRight className="size-3.5 shrink-0 text-muted" aria-label="menjadi" /><span className="break-words"><SettingsLabel tab="pencocokan">{canonical}</SettingsLabel></span></p>
              {admin && <div className="matching-glossary-actions"><Button isIconOnly variant="tertiary" aria-label={`Edit istilah ${alias}`} isDisabled={processing || busy} onPress={() => openGlossary(index)}><Pencil className="size-3.5" /></Button><Button isIconOnly variant="tertiary" className="text-danger" aria-label={`Hapus istilah ${alias}`} isDisabled={processing || busy} onPress={() => { setGlossary((current) => current.filter((_, at) => at !== index)); setDirty(true); }}><Trash2 className="size-3.5" /></Button></div>}
            </li>)}
          </ul>
          {!filteredGlossary.length && <p className="py-3 text-sm text-muted">Istilah tidak ditemukan.</p>}
          <footer className="matching-glossary-pagination"><span>{filteredGlossary.length} Istilah</span><nav aria-label="Pagination istilah">
            <button type="button" aria-label="Halaman istilah sebelumnya" disabled={glossaryPage === 1} onClick={() => setGlossaryPage(glossaryPage - 1)}><ChevronLeft className="size-4" /></button>
            {glossaryPageNumbers.map((page) => <button type="button" key={page} aria-label={`Halaman istilah ${page}`} aria-current={page === glossaryPage ? 'page' : undefined} onClick={() => setGlossaryPage(page)}>{page}</button>)}
            <button type="button" aria-label="Halaman istilah berikutnya" disabled={glossaryPage === glossaryPages} onClick={() => setGlossaryPage(glossaryPage + 1)}><ChevronRight className="size-4" /></button>
          </nav></footer>
        </>}
        </div>
      </section>

      {error && <SettingsNote tone="danger">{error}</SettingsNote>}

      {admin && <LocationIndexPanel processing={processing} onImported={() => { void poll(); refresh(); }} />}

      {admin && <Modal.Backdrop isOpen={glossaryEditor.isOpen} onOpenChange={(open) => glossaryEditor.setOpen(open)}>
        <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog matching-glossary-dialog">
          <Modal.CloseTrigger /><Modal.Header><Modal.Heading>{editingTerm === null ? 'Tambah istilah' : 'Edit istilah'}</Modal.Heading></Modal.Header>
          <Modal.Body className="sales-dialog-body space-y-3">
            <div className="glossary-draft-labels" aria-hidden="true"><span>Istilah di chat</span><span /><span>Nama baku</span><span /></div>
            <div className="glossary-draft-list">{termDrafts.map((entry, index) => <div className="glossary-draft-row" key={entry.id}>
              <input className="input" aria-label={`Istilah di chat ${index + 1}`} maxLength={100} placeholder="Mis. rgcy" value={entry.alias} onChange={(event) => setTermDrafts((current) => current.map((row) => row.id === entry.id ? { ...row, alias: event.target.value } : row))} />
              <ArrowRight className="size-4 text-muted" aria-hidden="true" />
              <input className="input" aria-label={`Nama baku ${index + 1}`} maxLength={100} placeholder="Mis. regency" value={entry.canonical} onChange={(event) => setTermDrafts((current) => current.map((row) => row.id === entry.id ? { ...row, canonical: event.target.value } : row))} />
              <Button isIconOnly variant="tertiary" className="text-danger" aria-label={`Hapus baris ${index + 1}`} isDisabled={editingTerm !== null} onPress={() => setTermDrafts((current) => current.filter((row) => row.id !== entry.id))}><Trash2 className="size-4" /></Button>
            </div>)}</div>
            {editingTerm === null && <Button variant="secondary" className="glossary-add-row" isDisabled={glossary.length + termDrafts.length >= 500} onPress={() => { const entry = { id: ++draftId.current, alias: '', canonical: '' }; setTermDrafts((current) => [...current, entry]); }}><Plus className="size-4" />Tambah istilah</Button>}
            {termDuplicate && <p role="alert" className="text-xs text-danger">Istilah sudah ada atau berulang di baris lain.</p>}
            {glossaryLimit && <p role="alert" className="text-xs text-danger">Maksimal 500 istilah dalam glosarium.</p>}
            <SettingsNote>Contoh: “rgcy” → “regency”. Perubahan glosarium diterapkan setelah menekan Simpan &amp; proses.</SettingsNote>
          </Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => glossaryEditor.close()}>Batal</Button><Button isDisabled={processing || busy || invalidTerms || termDuplicate || glossaryLimit} onPress={confirmTerm}>{editingTerm === null ? 'Tambahkan' : 'Simpan perubahan'}</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container>
      </Modal.Backdrop>}

      <Modal.Backdrop isOpen={preview.isOpen} onOpenChange={(open) => preview.setOpen(open)}>
        <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings matching-preview">
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Pratinjau glosarium dari CSV</Modal.Heading></Modal.Header>
          <Modal.Body className="space-y-3">
            {csv && <>
              <div className="flex flex-wrap gap-2"><Chip variant="soft">{csv.fileName}</Chip><Chip color="success" variant="soft">{csv.rows.length} valid</Chip>{csv.invalid > 0 && <Chip color="danger" variant="soft">{csv.invalid} dilewati</Chip>}{csv.duplicates > 0 && <Chip color="warning" variant="soft">{csv.duplicates} duplikat</Chip>}</div>
              <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-background text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Istilah di chat</th><th className="px-3 py-2 font-medium">Nama baku</th></tr></thead>
                  <tbody>{csv.rows.map(([alias, canonical], index) => <tr key={`${alias}-${index}`} className="border-t border-separator"><td className="px-3 py-2">{alias}</td><td className="px-3 py-2">{canonical}</td></tr>)}</tbody></table>
              </div>
            </>}
          </Modal.Body>
          <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" onPress={confirmCsv}><FileSpreadsheet className="size-4" aria-hidden="true" />Masukkan ke glosarium</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
