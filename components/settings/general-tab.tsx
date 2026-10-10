'use client';

import { useEffect, useState } from 'react';
import { Button, Chip, Input, Label, Switch, TextArea, TextField, toast } from '@heroui/react';
import { Building2, LockKeyhole, RotateCcw, Save, Search, Users } from 'lucide-react';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { LoadingIndicator, Notice, Panel, Segmented } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { useCompany } from '@/lib/session';
import type { GroupBy, MatchingMode } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

type SearchState = { terms: string[]; company_terms: string[]; personal_terms: string[] | null; locked: boolean; can_edit_company: boolean; can_edit_personal: boolean };

const toLines = (terms: string[]) => terms.join('\n');
const fromText = (text: string) => [...new Set(text.split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean))];

export function GeneralTab() {
  const api = useApi();
  const { company, refresh } = useCompany();
  const admin = !!company?.permissions.manage_settings;
  const [edited, setEdited] = useState<string | null>(null);
  const name = edited ?? company?.company_name ?? '';
  const setName = (value: string) => setEdited(value);
  const [state, setState] = useState<SearchState | null>(null);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [filterOn, setFilterOn] = useState(true);
  const [busy, setBusy] = useState('');
  const [modeJob, setModeJob] = useState<{ status: string; error?: string } | null>(null);
  const modeProcessing = modeJob?.status === 'queued' || modeJob?.status === 'processing';

  useEffect(() => {
    if (!modeProcessing) return;
    const timer = window.setInterval(() => {
      void api.get<{ status: string; error?: string } | null>('/index/status').then((job) => {
        setModeJob(job);
        if (job?.status === 'completed') { refresh(); toast.success('Pencocokan selesai diperbarui.'); }
      }).catch((reason) => { setModeJob({ status: 'failed', error: errorMessage(reason) }); });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [api, modeProcessing, refresh]);

  useEffect(() => {
    void api.get<SearchState>('/search-default').then((value) => {
      setState(value);
      setText(toLines(admin ? value.company_terms : (value.personal_terms ?? value.company_terms)));
      setLocked(value.locked);
      setFilterOn(value.company_terms.length > 0 || !admin);
    }).catch((reason) => toast.danger(errorMessage(reason)));
  }, [api, admin]);

  async function run<T>(label: string, job: () => Promise<T>, done: string) {
    setBusy(label);
    try { await job(); toast.success(done); refresh(); } catch (reason) { toast.danger(errorMessage(reason)); } finally { setBusy(''); }
  }

  const terms = fromText(text);
  const tooMany = terms.length > 20;

  return (
    <div className="space-y-5">
      <Panel title={<span className="flex items-center gap-2"><Building2 className="size-5 text-accent" aria-hidden="true" />Nama company</span>}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField value={name} onChange={setName} isDisabled={!admin} fullWidth className="sm:max-w-md"><Label className="text-base font-bold">Nama yang tampil di aplikasi</Label><Input className="h-12 text-base" maxLength={120} /></TextField>
          {admin && <Button size="lg" isPending={busy === 'name'} isDisabled={!name.trim() || name.trim() === company?.company_name} onPress={() => void run('name', async () => { await api.put('/company/settings', { company_name: name.trim() }); setEdited(null); }, 'Nama company disimpan')}><Save className="size-4" aria-hidden="true" />Simpan</Button>}
        </div>
      </Panel>

      <Panel title="Mode pencocokan otomatis" description="Berlaku saat upload dan proses ulang. Salah satu sisi pasangan harus termasuk company atau sales yang dipantau; sisi lainnya dicari dari seluruh data company.">
        <Segmented<MatchingMode> label="Cocokkan berdasarkan" value={company?.matching_mode ?? 'company'} fullWidth isDisabled={!admin || !!busy || modeProcessing}
          onChange={(matching_mode) => { void run('mode', async () => { await api.put('/company/settings', { matching_mode }); setModeJob(await api.post<{ status: string }>('/index/recompute')); }, 'Mode disimpan. Pencocokan dihitung ulang di latar belakang.'); }}
          options={[{ id: 'company', label: 'Company (keyword)' }, { id: 'sales', label: 'Sales (watchlist)' }]} />
        {(busy === 'mode' || modeProcessing) && <div className="mt-3"><LoadingIndicator message={modeJob?.status === 'queued' ? 'Menunggu antrean pencocokan…' : 'Memperbarui pencocokan sesuai mode yang dipilih…'} /></div>}
        {modeJob?.status === 'failed' && <Notice status="danger">{modeJob.error || 'Pencocokan belum berhasil diperbarui.'}</Notice>}
        <p className="mt-3 text-sm text-muted">{admin ? 'Mode Sales memerlukan minimal satu nomor di watchlist Stok Sales.' : 'Hanya super admin yang dapat mengubah mode pencocokan otomatis.'}</p>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Search className="size-5 text-accent" aria-hidden="true" />Kata kunci pencarian</span>}
        description="Pencocokan hanya memakai pesan yang mengandung salah satu kata atau frasa ini (misalnya nama kantor Anda). Satu kata/frasa per baris, atau pisahkan dengan koma. Maksimal 20.">
        {!state && <p className="text-base text-muted">Memuat…</p>}
        {state && admin && (
          <div className="space-y-4">
            <Switch isSelected={filterOn} onChange={setFilterOn}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>
                <span className="text-base font-bold">Saring pesan dengan kata kunci
                  <span className="mt-0.5 block text-[0.95rem] font-normal text-muted">{filterOn ? 'Hanya pesan yang mengandung kata kunci di bawah yang dipakai.' : 'Semua pesan yang diunggah dipakai, tanpa saringan.'}</span></span>
              </Switch.Content>
            </Switch>
            {filterOn && (
              <>
                <TextField value={text} onChange={setText} fullWidth isInvalid={tooMany}>
                  <Label className="text-base font-bold">Kata kunci company</Label>
                  <TextArea rows={5} className="text-base" placeholder={'konig\nProperty Citraland'} />
                </TextField>
                <div className="flex flex-wrap gap-2">{terms.map((term) => <Chip key={term} variant="soft" color="accent" size="lg">{term}</Chip>)}</div>
                {tooMany && <Notice status="danger">Maksimal 20 kata atau frasa.</Notice>}
              </>
            )}
            <div className="rounded-2xl border border-border bg-background p-4">
              <Switch isSelected={locked} onChange={setLocked}>
                <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>
                  <span className="text-base font-bold"><LockKeyhole className="mr-1.5 inline size-4" aria-hidden="true" />Kunci kata kunci untuk semua anggota
                    <span className="mt-0.5 block text-[0.95rem] font-normal text-muted">Bila aktif, anggota tim tidak bisa mengubah kata kunci dan selalu memakai pengaturan company di atas. Bila tidak, setiap anggota boleh membuat daftar sendiri.</span></span>
                </Switch.Content>
              </Switch>
            </div>
            <Button size="lg" isPending={busy === 'terms'}
              isDisabled={(filterOn && (!terms.length || tooMany)) || (filterOn === state.company_terms.length > 0 && (!filterOn || toLines(terms) === toLines(state.company_terms)) && locked === state.locked)}
              onPress={() => void run('terms', async () => { const saved = await api.put<SearchState>('/search-default', filterOn ? { terms, locked } : { terms: [], clear: true, locked }); setState(saved); setText(toLines(saved.company_terms)); setLocked(saved.locked); setFilterOn(saved.company_terms.length > 0); }, 'Kata kunci disimpan')}>
              <Save className="size-4" aria-hidden="true" />Simpan kata kunci
            </Button>
          </div>
        )}
        {state && !admin && (
          <div className="space-y-4">
            {state.locked ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-warning-soft p-5 text-center sm:flex-row sm:text-left">
                <LottiePlayer name="padlock" className="w-24 shrink-0" />
                <div><p className="text-lg font-bold">Dikunci oleh super admin</p><p className="mt-1 text-base">Kata kunci company dipakai untuk semua anggota dan tidak dapat diubah dari akun Anda.</p>
                  <div className="mt-3 flex flex-wrap gap-2">{state.company_terms.map((term) => <Chip key={term} size="lg" variant="soft" color="warning">{term}</Chip>)}</div></div>
              </div>
            ) : (
              <>
                <div><p className="mb-2 text-base font-bold">Default company</p>{state.company_terms.length ? <div className="flex flex-wrap gap-2">{state.company_terms.map((term) => <Chip key={term} size="lg" variant="soft">{term}</Chip>)}</div> : <p className="text-base text-muted">Company belum memakai kata kunci, jadi semua pesan dipakai.</p>}</div>
                <TextField value={text} onChange={setText} fullWidth isInvalid={tooMany}>
                  <Label className="text-base font-bold">Kata kunci saya</Label>
                  <TextArea rows={4} className="text-base" />
                </TextField>
                <p className="text-sm text-muted">Hanya berlaku untuk akun Anda. Akun lain tetap memakai pengaturan masing-masing.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="lg" isPending={busy === 'personal'} isDisabled={!terms.length || tooMany}
                    onPress={() => void run('personal', async () => { const saved = await api.put<SearchState>('/search-default/personal', { terms }); setState(saved); }, 'Kata kunci Anda disimpan')}><Save className="size-4" aria-hidden="true" />Simpan kata kunci saya</Button>
                  <Button size="lg" variant="secondary" isPending={busy === 'reset'} isDisabled={!state.personal_terms}
                    onPress={() => void run('reset', async () => { const saved = await api.del<SearchState>('/search-default/personal'); setState(saved); setText(toLines(saved.company_terms)); }, 'Kembali memakai default company')}><RotateCcw className="size-4" aria-hidden="true" />Pakai default company</Button>
                </div>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Users className="size-5 text-accent" aria-hidden="true" />Pengelompokan listing property</span>}
        description="Menentukan bagaimana daftar listing dikelompokkan di halaman Cocokkan dan grafik “Listing per sales”.">
        <div className="space-y-3">
          <Segmented label="Pengelompokan listing" value={(company?.listing_group_by ?? 'sender') as GroupBy} fullWidth
            onChange={(next) => { if (!admin) return; void run('group', () => api.put('/company/settings', { listing_group_by: next }), 'Pengelompokan diubah untuk seluruh company'); }}
            options={[{ id: 'sender', label: 'Pengirim pesan (standar)' }, { id: 'phone', label: 'Nomor telepon di pesan' }]} />
          <ul className="space-y-1.5 text-base leading-relaxed text-muted">
            <li><strong className="text-foreground">Pengirim pesan:</strong> nama kontak WhatsApp yang mengirim pesan di grup.</li>
            <li><strong className="text-foreground">Nomor telepon di pesan:</strong> nomor yang tertulis di tanda tangan tiap pesan listing. Cocok bila satu orang memposting listing milik banyak sales.</li>
          </ul>
          {!admin && <p className="text-sm text-muted">Hanya super admin yang dapat mengubah pengaturan ini.</p>}
        </div>
      </Panel>
    </div>
  );
}
