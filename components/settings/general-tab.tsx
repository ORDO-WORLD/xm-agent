'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Label, Switch, TextArea, TextField, toast } from '@heroui/react';
import { Building2, ChevronDown, Info, LoaderCircle, LockKeyhole, RotateCcw, Save, Search, UsersRound, Workflow, type LucideIcon } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { useSectionSearchLabel } from '@/lib/section-search';
import { useCompany, useSession } from '@/lib/session';
import type { GroupBy, MatchingMode } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

type SearchState = { terms: string[]; company_terms: string[]; personal_terms: string[] | null; locked: boolean; can_edit_company: boolean; can_edit_personal: boolean };
type Job = { status: string; error?: string };
const toLines = (terms: string[]) => terms.join('\n');
const fromText = (text: string) => [...new Set(text.split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean))];

function SearchLabel({ children }: { children: string }) {
  const label = useSectionSearchLabel(children, 'umum');
  return <span id={label.id}>{label.content}</span>;
}

function GeneralNote({ children }: { children: ReactNode }) {
  return <p className="general-note"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{children}</span></p>;
}

function GeneralSection({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon; children: ReactNode }) {
  const label = useSectionSearchLabel(title, 'umum');
  return (
    <section className="general-section" aria-labelledby={label.id}>
      <div>
        <h2 id={label.id} className="flex items-center gap-2 text-[0.9375rem] font-medium text-foreground"><Icon className="size-4 shrink-0" aria-hidden="true" /><span>{label.content}</span></h2>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      </div>
      <div className="general-section-controls">{children}</div>
    </section>
  );
}

export function GeneralTab() {
  const api = useApi();
  const { company, refresh } = useCompany();
  const { user } = useSession();
  const admin = !!company?.permissions.manage_settings;
  const [state, setState] = useState<SearchState | null>(null);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [filterOn, setFilterOn] = useState(true);
  const [busy, setBusy] = useState('');
  const [modeJob, setModeJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState('');
  const modeProcessing = modeJob?.status === 'queued' || modeJob?.status === 'processing';

  useEffect(() => {
    if (!modeProcessing) return;
    const timer = window.setInterval(() => {
      void api.get<Job | null>('/index/status').then((job) => {
        setModeJob(job);
        if (job?.status === 'completed') { refresh(); toast.success('Pencocokan selesai diperbarui.'); }
      }).catch((reason) => setModeJob({ status: 'failed', error: errorMessage(reason) }));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [api, modeProcessing, refresh]);

  useEffect(() => {
    let alive = true;
    void api.get<SearchState>('/search-default').then((value) => {
      if (!alive) return;
      setState(value);
      setText(toLines(admin ? value.company_terms : (value.personal_terms ?? value.company_terms)));
      setLocked(value.locked);
      setFilterOn(value.company_terms.length > 0 || !admin);
      setLoadError('');
    }).catch((reason) => { if (alive) setLoadError(errorMessage(reason)); });
    return () => { alive = false; };
  }, [api, admin]);

  async function run<T>(label: string, job: () => Promise<T>, done: string) {
    setBusy(label);
    try { await job(); toast.success(done); refresh(); } catch (reason) { toast.danger(errorMessage(reason)); } finally { setBusy(''); }
  }

  const terms = fromText(text);
  const tooMany = terms.length > 20;
  const unchanged = !!state && filterOn === (state.company_terms.length > 0) && (!filterOn || toLines(terms) === toLines(state.company_terms)) && locked === state.locked;
  const noWatchlist = !company?.tracked_phones.length;

  return (
    <div className="general-settings">
      <GeneralSection icon={Building2} title="Nama company" description="Nama perusahaan mengikuti AutoAudit.">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1">{company?.company_name || '—'}</p>
          {admin && <a className="text-accent underline" href={`${user.autoaudit_url || ''}${user.role === 'admin' ? '/dashboard/companies' : '/dashboard/profile-company'}`}>Kelola di AutoAudit</a>}
        </div>
      </GeneralSection>

      <GeneralSection icon={Workflow} title="Mode pencocokan otomatis" description="Menentukan sumber buyer dan listing untuk Cocokkan, Match Terbaru, Beranda, dan ekspor.">
        <div className="general-native-field">
          <span className="relative block">
            <select aria-label="Mode pencocokan otomatis" value={company?.matching_mode ?? 'company'} disabled={!admin || !!busy || modeProcessing}
              onChange={(event) => { const matching_mode = event.target.value as MatchingMode; void run('mode', async () => { await api.put('/company/settings', { matching_mode }); setModeJob(await api.post<Job>('/index/recompute')); }, 'Mode disimpan. Hasil diperbarui di latar belakang.'); }}>
              <option value="company">Company — kata kunci</option><option value="sales" disabled={noWatchlist}>Sales — nomor dalam watchlist</option>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </span>
        </div>
        <GeneralNote>{company?.matching_mode === 'sales' ? 'Sumber wajib mencantumkan nomor sales yang dipantau.' : 'Sumber mengikuti kata kunci company, termasuk yang tertulis di tanda tangan pesan.'}{' '}{admin ? <>Langsung tersimpan saat dipilih.{noWatchlist ? ' Tambahkan nomor di Pantau Sales untuk memakai mode Sales.' : ''}</> : 'Mode dikelola oleh super admin company.'}</GeneralNote>
        {(busy === 'mode' || modeProcessing) && <output className="flex items-center gap-2 text-sm text-muted" aria-live="polite"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{modeJob?.status === 'queued' ? 'Pembaruan hasil menunggu antrean…' : 'Memperbarui hasil pencocokan…'}</output>}
        {modeJob?.status === 'failed' && <p role="alert" className="text-sm text-danger">{modeJob.error || 'Pencocokan belum berhasil diperbarui.'}</p>}
      </GeneralSection>

      <GeneralSection icon={Search} title="Kata kunci pencarian" description="Pada mode Company, sumber harus memuat salah satu kata atau frasa. Maksimal 20, dipisahkan baris atau koma.">
        {!state && <p className={loadError ? 'text-sm text-danger' : 'text-sm text-muted'} role={loadError ? 'alert' : undefined}>{loadError || 'Memuat kata kunci…'}</p>}
        {company?.matching_mode === 'sales' && <p className="text-sm text-muted">Kata kunci disimpan untuk digunakan ketika mode Company aktif.</p>}
        {state && admin && <>
          <Switch isSelected={filterOn} onChange={setFilterOn} isDisabled={!!busy}>
            <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-sm font-normal"><SearchLabel>Saring pesan dengan kata kunci</SearchLabel></span></Switch.Content>
          </Switch>
          {filterOn ? <>
            <TextField value={text} onChange={setText} fullWidth isInvalid={tooMany} isDisabled={!!busy}>
              <Label><SearchLabel>Kata kunci company</SearchLabel></Label><TextArea rows={4} placeholder={'konig\nProperty Citraland'} />
            </TextField>
            <p className={tooMany ? 'text-xs text-danger' : 'text-xs text-muted'} aria-live="polite">{terms.length}/20 kata atau frasa{tooMany ? ' — maksimal 20.' : ''}</p>
          </> : <p className="text-sm text-muted">Semua pesan perusahaan dapat menjadi sumber, tanpa saringan kata kunci.</p>}
          <div className="space-y-1">
            <Switch isSelected={locked} onChange={setLocked} isDisabled={!!busy}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-sm font-normal"><SearchLabel>Kunci kata kunci untuk semua anggota</SearchLabel></span></Switch.Content>
            </Switch>
            <p className="text-sm leading-relaxed text-muted">Anggota memakai kata kunci company. Jika tidak dikunci, anggota dapat menambahkan filter pribadi.</p>
          </div>
          <Button className="self-start" isPending={busy === 'terms'} isDisabled={!!busy || (filterOn && (!terms.length || tooMany)) || unchanged}
            onPress={() => void run('terms', async () => { const saved = await api.put<SearchState>('/search-default', filterOn ? { terms, locked } : { terms: [], clear: true, locked }); setState(saved); setText(toLines(saved.company_terms)); setLocked(saved.locked); setFilterOn(saved.company_terms.length > 0); if (company?.matching_mode === 'company') setModeJob(await api.get<Job | null>('/index/status').catch(() => null)); }, 'Kata kunci disimpan. Aturan perusahaan langsung berlaku.')}>
            <Save className="size-4" aria-hidden="true" />Simpan kata kunci
          </Button>
        </>}
        {state && !admin && (state.locked ? <>
          <p className="flex items-center gap-2 text-sm text-foreground"><LockKeyhole className="size-4 shrink-0" aria-hidden="true" />Dikunci oleh super admin</p>
          <p className="text-sm text-muted">{state.company_terms.length ? state.company_terms.join(' · ') : 'Company tidak memakai saringan kata kunci.'}</p>
        </> : <>
          <div className="space-y-1"><p className="text-sm font-medium"><SearchLabel>Default company</SearchLabel></p><p className="text-sm text-muted">{state.company_terms.length ? state.company_terms.join(' · ') : 'Semua pesan dipakai; company belum mengatur kata kunci.'}</p></div>
          <TextField value={text} onChange={setText} fullWidth isInvalid={tooMany} isDisabled={!!busy}>
            <Label><SearchLabel>Kata kunci saya</SearchLabel></Label><TextArea rows={4} />
          </TextField>
          <p className={tooMany ? 'text-xs text-danger' : 'text-xs text-muted'}>{terms.length}/20 kata atau frasa{tooMany ? ' — maksimal 20.' : ''}</p>
          <p className="text-sm text-muted">Filter pribadi mempersempit sumber yang sesuai aturan perusahaan.</p>
          <div className="flex flex-wrap gap-2">
            <Button isPending={busy === 'personal'} isDisabled={!!busy || !terms.length || tooMany} onPress={() => void run('personal', async () => { setState(await api.put<SearchState>('/search-default/personal', { terms })); }, 'Kata kunci Anda disimpan')}><Save className="size-4" aria-hidden="true" />Simpan kata kunci saya</Button>
            <Button variant="secondary" isPending={busy === 'reset'} isDisabled={!!busy || !state.personal_terms} onPress={() => void run('reset', async () => { const saved = await api.del<SearchState>('/search-default/personal'); setState(saved); setText(toLines(saved.company_terms)); }, 'Kembali memakai default company')}><RotateCcw className="size-4" aria-hidden="true" />Pakai default company</Button>
          </div>
        </>)}
      </GeneralSection>

      <GeneralSection icon={UsersRound} title="Pengelompokan listing property" description="Cara menyusun daftar listing di Cocokkan dan grafik Listing per sales.">
        <div className="general-native-field">
          <span className="relative block">
            <select aria-label="Pengelompokan listing property" value={company?.listing_group_by ?? 'sender'} disabled={!admin || !!busy}
              onChange={(event) => { const listing_group_by = event.target.value as GroupBy; void run('group', () => api.put('/company/settings', { listing_group_by }), 'Pengelompokan diubah untuk seluruh company'); }}>
              <option value="sender">Pengirim pesan</option><option value="phone">Nomor telepon di pesan</option>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </span>
        </div>
        <GeneralNote>{company?.listing_group_by === 'phone' ? 'Menggunakan nomor kontak pada pesan listing, termasuk ketika satu orang memposting listing milik sales lain.' : 'Menggunakan nama kontak WhatsApp yang mengirim pesan di grup.'}{' '}{admin ? 'Langsung tersimpan saat dipilih, berlaku untuk seluruh company.' : 'Pengelompokan dikelola oleh super admin company.'}</GeneralNote>
      </GeneralSection>
    </div>
  );
}
