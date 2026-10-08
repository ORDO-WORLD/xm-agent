'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, Input, Label, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { BookText, FileSpreadsheet, Percent, Plus, RefreshCw, Save, Scale, Trash2 } from 'lucide-react';
import { LocationIndexPanel } from '@/components/settings/location-index-panel';
import { Notice, Panel } from '@/components/app/primitives';
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

function NumberBox({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <TextField value={String(value)} onChange={(text) => onChange(Number(text.replace(',', '.')) || 0)} isDisabled={disabled} type="number" fullWidth>
      <Label className="text-base font-bold">{label} (%)</Label>
      <Input className="h-12 text-base" min={0} max={100} inputMode="decimal" />
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
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
    toast.success(`${csv.rows.length} istilah dari ${csv.fileName} dimasukkan. Tekan “Simpan & proses ulang” untuk menerapkan.`);
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
    <div className="space-y-5">
      {!admin && <Notice status="accent">Anda dapat melihat pengaturan ini, tetapi hanya super admin yang dapat mengubahnya.</Notice>}
      {processing && <Notice status="accent" title="Pencocokan sedang dihitung ulang"><RefreshCw className="mr-1.5 inline size-4 animate-spin" aria-hidden="true" />{job?.status === 'queued' ? 'Menunggu antrean' : 'Memproses seluruh data'} — Anda boleh berpindah halaman.</Notice>}
      {job?.status === 'failed' && <Notice status="danger" title="Proses ulang gagal">{job.error}</Notice>}

      <Panel title={<span className="flex items-center gap-2"><Percent className="size-5 text-accent" aria-hidden="true" />Toleransi</span>}
        description="Berapa selisih yang masih dianggap cocok. Di luar toleransi tidak direkomendasikan; di dalam toleransi paling tinggi Warm.">
        <div className="grid gap-4 sm:grid-cols-3">{TOLERANCES.map(([key, label, hint]) => <NumberBox key={key} label={label} hint={hint} value={settings[key]} disabled={!admin || processing} onChange={(value) => set(key, value)} />)}</div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Scale className="size-5 text-accent" aria-hidden="true" />Bobot skor</span>}
        description="Seberapa besar tiap faktor menentukan skor. Totalnya harus 100%. Kebutuhan yang tidak disebut buyer tidak menambah skor."
        action={<Chip color={balanced ? 'success' : 'danger'} variant="soft" size="lg">Total {total}%</Chip>}>
        <figure className="m-0 mb-4 flex h-4 overflow-hidden rounded-full bg-default" aria-label="Pembagian bobot">
          {WEIGHTS.map(([key, label, color]) => <div key={key} title={`${label} ${settings[key]}%`} style={{ width: `${Math.max(0, Math.min(100, Number(settings[key])))}%`, background: color }} />)}
        </figure>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHTS.map(([key, label, color]) => (
            <div key={key}>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><span className="size-3 rounded-full" style={{ background: color }} aria-hidden="true" />{label}</p>
              <NumberBox label={label} value={settings[key]} disabled={!admin || processing} onChange={(value) => set(key, value)} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><BookText className="size-5 text-accent" aria-hidden="true" />Glosarium</span>}
        description="Kolom kiri adalah penulisan di chat, kolom kanan nama bakunya. Contoh: “rgcy” → “regency”."
        action={admin ? <><input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Pilih file CSV glosarium" onChange={(event) => void chooseCsv(event.target.files?.[0])} /><Button variant="secondary" isDisabled={processing} onPress={() => file.current?.click()}><FileSpreadsheet className="size-4" aria-hidden="true" />Unggah CSV</Button></> : undefined}>
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl bg-background p-2.5">
          {glossary.length === 0 && <p className="p-3 text-base text-muted">Belum ada istilah.</p>}
          {glossary.map(([alias, canonical], index) => (
            <div key={index} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <input aria-label={`Istilah ${index + 1}`} disabled={!admin || processing} className="h-11 min-w-0 rounded-xl border border-field-border bg-field px-3 text-base disabled:opacity-60" value={alias}
                onChange={(event) => { setGlossary(glossary.map((entry, at) => at === index ? [event.target.value, entry[1]] : entry)); setDirty(true); }} />
              <span aria-hidden="true" className="text-muted">→</span>
              <input aria-label={`Nama baku ${index + 1}`} disabled={!admin || processing} className="h-11 min-w-0 rounded-xl border border-field-border bg-field px-3 text-base disabled:opacity-60" value={canonical}
                onChange={(event) => { setGlossary(glossary.map((entry, at) => at === index ? [entry[0], event.target.value] : entry)); setDirty(true); }} />
              {admin && <Button isIconOnly variant="tertiary" aria-label={`Hapus istilah ${alias}`} isDisabled={processing} onPress={() => { setGlossary(glossary.filter((_, at) => at !== index)); setDirty(true); }}><Trash2 className="size-4" /></Button>}
            </div>
          ))}
        </div>
        {admin && <Button className="mt-3" variant="secondary" isDisabled={processing} onPress={() => { setGlossary([...glossary, ['', '']]); setDirty(true); }}><Plus className="size-4" aria-hidden="true" />Tambah istilah</Button>}
      </Panel>

      {error && <Notice status="danger">{error}</Notice>}
      {admin && (
        <div className={cn('pb-safe sticky bottom-20 z-10 rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur lg:bottom-4', !dirty && 'hidden')}>
          <Button size="lg" fullWidth isPending={busy} isDisabled={!dirty || processing || !balanced} onPress={save}><Save className="size-4" aria-hidden="true" />Simpan &amp; proses ulang pencocokan</Button>
          {!balanced && <p className="mt-2 text-center text-sm text-danger">Total bobot saat ini {total}%. Ubah hingga tepat 100%.</p>}
        </div>
      )}

      {admin && <LocationIndexPanel processing={processing} onImported={() => { void poll(); refresh(); }} />}

      <Modal.Backdrop isOpen={preview.isOpen} onOpenChange={(open) => preview.setOpen(open)}>
        <Modal.Container size="lg" scroll="inside"><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Pratinjau glosarium dari CSV</Modal.Heading></Modal.Header>
          <Modal.Body className="space-y-3">
            {csv && <>
              <div className="flex flex-wrap gap-2"><Chip variant="soft">{csv.fileName}</Chip><Chip color="success" variant="soft">{csv.rows.length} valid</Chip>{csv.invalid > 0 && <Chip color="danger" variant="soft">{csv.invalid} dilewati</Chip>}{csv.duplicates > 0 && <Chip color="warning" variant="soft">{csv.duplicates} duplikat</Chip>}</div>
              <div className="max-h-80 overflow-y-auto rounded-2xl border border-border">
                <table className="w-full text-left text-base"><thead className="sticky top-0 bg-background text-sm text-muted"><tr><th className="px-3 py-2">Istilah di chat</th><th className="px-3 py-2">Nama baku</th></tr></thead>
                  <tbody>{csv.rows.map(([alias, canonical], index) => <tr key={`${alias}-${index}`} className="border-t border-separator"><td className="px-3 py-2">{alias}</td><td className="px-3 py-2 font-semibold">{canonical}</td></tr>)}</tbody></table>
              </div>
            </>}
          </Modal.Body>
          <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" onPress={confirmCsv}><FileSpreadsheet className="size-4" aria-hidden="true" />Masukkan ke glosarium</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
