'use client';

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Dropdown, Input, Label, Tabs, TextField } from '@heroui/react';
import { ArrowDownUp, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, FileJson, History, Info, LoaderCircle, MessageSquareText, RefreshCw, Search, Sparkles, Trash2, TriangleAlert, UploadCloud, UserRound, Workflow, X } from 'lucide-react';
import { EmptyState, ErrorNotice, Notice } from '@/components/app/primitives';
import { AutoAuditCard } from '@/components/pages/autoaudit-card';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { Confetti, type ConfettiRef } from '@/components/magicui/confetti';
import { errorMessage } from '@/lib/api';
import { dateTime, number } from '@/lib/format';
import { useRoute, type Navigate } from '@/lib/router';
import { usePageHeading } from '@/components/app/company-shell';
import { SettingsPagination, useTableViewport } from '@/components/settings/settings-pagination';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { ImportRow, MatchingMode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

const statusLabel: Record<string, string> = { queued: 'Menunggu antrean', processing: 'Sedang diproses', completed: 'Selesai', failed: 'Gagal' };
const HISTORY_SORTS = [
  { id: 'newest', label: 'Terbaru' }, { id: 'oldest', label: 'Terlama' },
  { id: 'file-asc', label: 'Nama file: A–Z' }, { id: 'file-desc', label: 'Nama file: Z–A' },
  { id: 'sales-asc', label: 'Nama sales: A–Z' }, { id: 'sales-desc', label: 'Nama sales: Z–A' },
  { id: 'matches-desc', label: 'Match terbanyak' }, { id: 'matches-asc', label: 'Match paling sedikit' },
] as const;
type HistorySort = typeof HISTORY_SORTS[number]['id'];

function UploadHistoryResult({ item }: { item: ImportRow }) {
  if (item.status === 'completed') return <>
    <span><span className="font-medium text-indigo-700">{number(item.request_count)} buyer</span> dan <span className="font-medium text-cyan-700">{number(item.listing_count)} listing</span></span>
    <span className="activity-secondary">{number(item.duplicate_count)} duplikat · {number(item.ignored_count)} diabaikan</span>
    <span className="activity-secondary">{number(item.new_matches)} match baru{item.new_matches > 0 ? ` (${item.new_hot} Hot · ${item.new_warm} Warm)` : ''}</span>
  </>;
  if (item.status === 'failed' && item.error) return <span className="flex items-start gap-2 text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{item.error}</span>;
  return <span className="text-muted">{item.status === 'failed' ? 'Pemrosesan gagal' : 'Menunggu hasil pemrosesan'}</span>;
}

function UploadHistoryCard({ item }: { item: ImportRow }) {
  return <li className="activity-mobile-card">
    <header><div><h2>{item.file_name}</h2></div><span className="activity-status" data-failed={item.status === 'failed'} data-status={item.status}>{statusLabel[item.status] ?? item.status}</span></header>
    <div className="activity-card-summary"><UploadHistoryResult item={item} /></div>
    <dl>
      <div><dt><CalendarDays size={13} aria-hidden="true" />Waktu</dt><dd>{dateTime(item.created_at)}</dd></div>
      <div><dt><UserRound size={13} aria-hidden="true" />Sales</dt><dd>{item.agent_name}</dd></div>
      <div><dt><Workflow size={13} aria-hidden="true" />Mode</dt><dd>{item.matching_mode ? item.matching_mode === 'company' ? 'Company' : 'Sales' : '—'}</dd></div>
    </dl>
  </li>;
}

function UploadHint({ children, content, onSelect, selected, disabled, label, className }: {
  children: ReactNode; content: ReactNode; onSelect?: () => void; selected?: boolean; disabled?: boolean; label?: string; className?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = () => { if (timer.current) clearTimeout(timer.current); setVisible(false); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className={cn('upload-hint', className)} onPointerEnter={(event) => { if (event.pointerType === 'mouse') setVisible(true); }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') close(); }}>
    <button type="button" disabled={disabled} aria-label={label} aria-pressed={selected} aria-describedby={visible ? id : undefined}
      onFocus={() => { if (window.matchMedia('(hover: hover)').matches) setVisible(true); }} onBlur={close}
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
      onClick={() => {
        onSelect?.(); setVisible(true);
        if (timer.current) clearTimeout(timer.current);
        if (window.matchMedia('(hover: none), (pointer: coarse)').matches) timer.current = setTimeout(() => setVisible(false), 3000);
      }}>{children}</button>
    {visible && <div id={id} role="tooltip" className="upload-hint-content">{content}</div>}
  </div>;
}

function steps(item: ImportRow) {
  const reading = item.status === 'processing' && item.processed_messages < item.total_messages;
  const matching = item.status === 'processing' && item.total_messages > 0 && item.processed_messages >= item.total_messages;
  const done = item.status === 'completed';
  return [
    { label: 'File berhasil diterima', icon: UploadCloud, state: 'done' as const },
    { label: done || matching ? 'Pesan selesai dibaca' : reading || item.status === 'processing' ? item.processed_messages > 0 ? 'Membaca dan mengenali pesan' : 'Mulai membaca pesan' : 'Menunggu pembacaan pesan', icon: MessageSquareText, state: done || matching ? ('done' as const) : reading || item.status === 'processing' ? ('active' as const) : ('todo' as const) },
    { label: done ? 'Pencocokan selesai' : matching ? 'Mencari pasangan buyer dan listing' : 'Menunggu pencocokan', icon: Sparkles, state: done ? ('done' as const) : matching ? ('active' as const) : ('todo' as const) },
    { label: done ? 'Hasil siap dilihat' : 'Menunggu hasil pemrosesan', icon: CheckCircle2, state: done ? ('done' as const) : ('todo' as const) },
  ];
}

function UploadProcessing({ item }: { item: ImportRow }) {
  const stages = steps(item);
  const activeStage = stages.findIndex((stage) => stage.state === 'active');
  const ratio = item.total_messages ? Math.min(1, Math.max(0, item.processed_messages / item.total_messages)) : 0;
  // Stage positions match the centres of the four equal-width columns.
  const completedPosition = activeStage > 0 ? 12.5 + (activeStage - 1) * 25 : 12.5;
  const position = item.status === 'completed' ? 100 : activeStage === 1 ? 37.5 + ratio * 25 : activeStage === 2 ? 62.5 : 12.5;
  return <section className="upload-processing" aria-label={`Pemrosesan ${item.file_name}`}>
    <h2 className="break-all text-sm font-semibold">{item.file_name}</h2>
    <p className="mb-4 mt-1 text-xs text-muted">{item.agent_name} · {statusLabel[item.status] ?? item.status}</p>
    <ol className="upload-stages">
      {stages.map((stage, index) => {
        const Icon = stage.state === 'done' ? CheckCircle2 : stage.state === 'active' ? LoaderCircle : stage.icon;
        return <li key={index} aria-current={stage.state === 'active' ? 'step' : undefined}>
          <span className="upload-stage-icon" data-state={stage.state}><Icon className={cn('size-5', stage.state === 'active' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /></span>
          <span className="upload-stage-label">{stage.label}</span>
        </li>;
      })}
    </ol>
    <div className="upload-progress-caption" aria-live="polite">
      <span>{item.total_messages ? `${number(item.processed_messages)} dari ${number(item.total_messages)} pesan dibaca` : item.status === 'queued' ? 'File menunggu giliran untuk diproses' : 'Menyiapkan pembacaan pesan…'}</span>
      <span>{activeStage === 2 ? 'Pencocokan sedang berjalan' : item.total_messages ? `${Math.round(ratio * 100)}% pesan dibaca` : ''}</span>
    </div>
    <progress className="sr-only" aria-label="Pembacaan pesan" max={item.total_messages || 1} value={item.total_messages ? item.processed_messages : undefined} />
    <div className="upload-stage-track" aria-hidden="true">
      <div className="upload-stage-fill" style={{ width: `${position}%` }} />
      <div className="upload-stage-completed" style={{ width: `${item.status === 'completed' ? 100 : completedPosition}%` }} />
      <div className="upload-stage-dots">{stages.map((stage, index) => <span key={index}><i data-state={stage.state} /></span>)}</div>
    </div>
    <p className="mt-3 text-sm text-muted">Anda boleh berpindah halaman. Proses berjalan di latar belakang dan hasilnya muncul di Match Terbaru.</p>
  </section>;
}

export default function UploadPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const viewport = useTableViewport();
  const { params, navigate: go } = useRoute();
  const open = navigate ?? go;
  const tab = params.get('tab') === 'autoaudit' ? 'autoaudit' : 'manual';
  const showingHistory = params.get('view') === 'riwayat';
  const back = useCallback(() => open('data', { tab }), [open, tab]);
  usePageHeading(showingHistory ? 'Riwayat unggah' : null, back);
  const { company, refresh } = useCompany();
  const [selectedMode, setSelectedMode] = useState<MatchingMode | null>(null);
  const matchingMode = selectedMode ?? company?.matching_mode ?? 'company';
  const noWatchlist = matchingMode === 'sales' && !company?.tracked_phones.length;
  const input = useRef<HTMLInputElement>(null);
  const confetti = useRef<ConfettiRef>(null);
  const [agent, setAgent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [celebrate, setCelebrate] = useState<ImportRow | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historySort, setHistorySort] = useState<HistorySort>('newest');
  const seen = useRef<Record<string, string>>({});

  const imports = useData((signal) => api.get<ImportRow[]>('/imports', signal), []);
  const reload = imports.reload;
  const active = imports.data?.some((item) => item.status === 'queued' || item.status === 'processing');

  // While something is being processed, look again every few seconds; announce the moment it finishes.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(reload, 2500);
    return () => window.clearInterval(timer);
  }, [active, reload]);
  useEffect(() => {
    for (const item of imports.data ?? []) {
      const before = seen.current[item.id];
      seen.current[item.id] = item.status;
      if (before && before !== 'completed' && item.status === 'completed') {
        refresh();
        setCelebrate(item);
        if (item.new_matches > 0) void confetti.current?.fire({ particleCount: 140, spread: 80, origin: { y: 0.35 }, colors: ['#0a3be0', '#5dd0ea', '#f59e0b', '#ef4444'] });
      }
    }
  }, [imports.data, refresh]);

  const choose = useCallback((candidate?: File | null) => {
    if (busy) return;
    setError(''); setNotice('');
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.json')) { setError('Gunakan file berformat .json (cleaned.json dari ekspor chat).'); return; }
    setFile(candidate);
    // The export is named "Sales - Kantor - ... - cleaned.json"; its first part is usually the person.
    if (!agent.trim()) setAgent(candidate.name.split(' - ')[0]?.trim().slice(0, 60) ?? '');
  }, [agent, busy]);

  useEffect(() => {
    if (showingHistory || tab !== 'manual') return;
    const paste = (event: ClipboardEvent) => {
      if (busy) return;
      const candidate = event.clipboardData?.files[0] ?? Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === 'file')?.getAsFile();
      if (!candidate) return;
      event.preventDefault(); choose(candidate);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [choose, busy, showingHistory, tab]);

  function removeFile() {
    setFile(null); setError(''); setNotice('');
    if (input.current) input.current.value = '';
  }

  function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  }

  const upload = useCallback(async () => {
    if (!file) return;
    setBusy(true); setError(''); setNotice(''); setCelebrate(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('agent_name', agent.trim());
      form.append('matching_mode', matchingMode);
      const result = await api.form<{ duplicate?: boolean; recomputing?: boolean; agent_name?: string }>('/imports', form);
      setNotice(result.recomputing ? 'File sudah pernah diproses. Mode baru diterapkan dan pencocokan dihitung ulang di latar belakang.' : result.duplicate ? 'File ini sudah pernah diunggah dan diproses, jadi tidak ditambahkan lagi.' : `Data ${result.agent_name ?? agent} masuk antrean dan mulai diproses.`);
      if (result.recomputing) refresh();
      setFile(null);
      if (input.current) input.current.value = '';
      reload();
    } catch (reason) { setError(errorMessage(reason, 'Upload belum berhasil. Periksa file lalu coba lagi.')); } finally { setBusy(false); }
  }, [api, file, agent, matchingMode, reload, refresh]);

  const running = imports.data?.filter((item) => item.status === 'queued' || item.status === 'processing') ?? [];
  const history = imports.data ?? [];
  const searchHistory = historySearch.trim().toLocaleLowerCase('id-ID');
  const filteredHistory = history.filter((item) => {
    if (historyStatus !== 'all' && item.status !== historyStatus) return false;
    const result = item.status === 'completed' ? `${number(item.request_count)} buyer dan ${number(item.listing_count)} listing ${number(item.duplicate_count)} duplikat ${number(item.ignored_count)} diabaikan ${number(item.new_matches)} match baru ${item.new_matches > 0 ? `${item.new_hot} Hot ${item.new_warm} Warm` : ''}` : item.status === 'failed' ? item.error || 'Pemrosesan gagal' : 'Menunggu hasil pemrosesan';
    return `${item.file_name} ${item.agent_name} ${result}`.toLocaleLowerCase('id-ID').includes(searchHistory);
  }).sort((a, b) => {
    switch (historySort) {
      case 'oldest': return Date.parse(a.created_at) - Date.parse(b.created_at);
      case 'file-asc': return a.file_name.localeCompare(b.file_name, 'id', { numeric: true });
      case 'file-desc': return b.file_name.localeCompare(a.file_name, 'id', { numeric: true });
      case 'sales-asc': return a.agent_name.localeCompare(b.agent_name, 'id', { numeric: true });
      case 'sales-desc': return b.agent_name.localeCompare(a.agent_name, 'id', { numeric: true });
      case 'matches-desc': return b.new_matches - a.new_matches;
      case 'matches-asc': return a.new_matches - b.new_matches;
      default: return Date.parse(b.created_at) - Date.parse(a.created_at);
    }
  });
  const currentHistoryPage = Math.min(historyPage, Math.max(1, Math.ceil(filteredHistory.length / historyPageSize)));
  const historyRows = filteredHistory.slice((currentHistoryPage - 1) * historyPageSize, currentHistoryPage * historyPageSize);

  if (showingHistory) return <div className="general-settings upload-page upload-history">
    <header className="upload-history-toolbar">
      <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari nama file, sales, atau hasil" placeholder="Cari nama file, nama sales, atau hasil…" value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} />{historySearch && <button type="button" aria-label="Hapus pencarian riwayat" onClick={() => { setHistorySearch(''); setHistoryPage(1); }}><X className="size-4" /></button>}</div>
      <div className="upload-history-status"><select aria-label="Filter status unggahan" value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value); setHistoryPage(1); }}><option value="all">Semua status</option>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown className="size-4" aria-hidden="true" /></div>
      <Dropdown><Dropdown.Trigger className="upload-history-sort" aria-label="Urutkan riwayat"><ArrowDownUp className="size-4" aria-hidden="true" /><span>{HISTORY_SORTS.find((sort) => sort.id === historySort)?.label}</span><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="upload-history-sort-menu"><Dropdown.Menu aria-label="Urutan riwayat unggah" selectionMode="single" selectedKeys={new Set([historySort])} onAction={(key) => { setHistorySort(String(key) as HistorySort); setHistoryPage(1); }}>{HISTORY_SORTS.map((sort) => <Dropdown.Item key={sort.id} id={sort.id} textValue={sort.label} className={historySort === sort.id ? 'is-current' : ''}><Label>{sort.label}</Label></Dropdown.Item>)}</Dropdown.Menu></Dropdown.Popover>
      </Dropdown>
    </header>
    {imports.loading && !imports.data && <p className="text-sm text-muted" aria-live="polite">Memuat riwayat unggah...</p>}
        <ErrorNotice message={imports.error} onRetry={imports.reload} />
        {history.length === 0 && !imports.loading && !imports.error && <EmptyState compact animation="upload" title="Belum ada upload" description="File yang Anda unggah akan tercatat di sini." />}
    {history.length > 0 && filteredHistory.length === 0 && <EmptyState compact title="Riwayat tidak ditemukan" description="Coba kata pencarian atau status lain." />}
    {filteredHistory.length > 0 && <div className="activity-data">
      {viewport === 'mobile' ? <ul className="activity-mobile-cards" aria-label="Riwayat unggah">{historyRows.map((item) => <UploadHistoryCard key={item.id} item={item} />)}</ul> : <div className="sales-table-wrap"><table className="sales-table activity-table upload-history-table" aria-label="Riwayat unggah">
        <thead><tr><th scope="col">Waktu</th><th scope="col">File</th><th scope="col">Sales</th><th scope="col">Mode</th><th scope="col">Status</th><th scope="col">Hasil</th></tr></thead>
        <tbody>{historyRows.map((item) => <tr key={item.id}>
          <td className="activity-time">{dateTime(item.created_at)}</td>
          <td className="upload-history-file"><strong className="activity-actor">{item.file_name}</strong></td>
          <td>{item.agent_name}</td>
          <td>{item.matching_mode ? item.matching_mode === 'company' ? 'Company' : 'Sales' : '—'}</td>
          <td><span className="activity-status" data-failed={item.status === 'failed'} data-status={item.status}>{statusLabel[item.status] ?? item.status}</span></td>
          <td className="activity-summary"><UploadHistoryResult item={item} /></td>
        </tr>)}</tbody>
      </table></div>}
      <SettingsPagination total={filteredHistory.length} label="riwayat unggah" page={currentHistoryPage} pageSize={historyPageSize} onPage={setHistoryPage} onPageSize={(size) => { setHistoryPageSize(size); setHistoryPage(1); }} />
    </div>}

  </div>;

  return (
    <div className="general-settings upload-page">
      <Confetti ref={confetti} manualstart className="pointer-events-none fixed inset-0 z-[100] size-full" aria-hidden="true" />
      <Tabs className="settings-tabs upload-tabs" selectedKey={tab} onSelectionChange={(key) => open('data', { tab: String(key) })} variant="secondary">
        <div className="upload-tab-bar">
          <div className="upload-tab-list xm-scroll-x min-w-0"><Tabs.List aria-label="Sumber data">
            <Tabs.Tab id="manual">Unggah Manual<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="autoaudit">Sambungan AutoAudit<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List></div>
          <Button variant="secondary" onPress={() => open('data', { tab, view: 'riwayat' })}><History className="size-4" aria-hidden="true" />Riwayat</Button>
        </div>
        <Tabs.Panel id="manual">

      {celebrate && (
        <div className="border-b border-separator pb-5" aria-live="polite">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <LottiePlayer name={celebrate.new_matches > 0 ? 'match-found' : 'success'} className="w-32 shrink-0" label="Selesai" />
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold">{celebrate.new_matches > 0 ? `${number(celebrate.new_matches)} match baru ditemukan!` : 'Data selesai diproses'}</p>
              <div className="mt-1 text-sm leading-snug text-foreground/80">
                <p>{celebrate.file_name} — <span className="font-medium text-indigo-700">{number(celebrate.request_count)} buyer</span> dan <span className="font-medium text-cyan-700">{number(celebrate.listing_count)} listing</span> dibaca.</p>
                <p className="mt-0.5">{celebrate.new_matches > 0 ? <>Dari {number(celebrate.new_matches)} pasangan baru, <span className="inline-flex items-center gap-1 whitespace-nowrap"><span aria-hidden="true">🔥</span>{number(celebrate.new_hot)} Hot</span> dan <span className="inline-flex items-center gap-1 whitespace-nowrap"><span aria-hidden="true">🌡️</span>{number(celebrate.new_warm)} Warm</span>.</> : 'Belum ada pasangan baru dari data ini.'}</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" onPress={() => navigate?.('match-baru')}>Lihat Match Terbaru<ArrowRight className="size-4" aria-hidden="true" /></Button>
              <Button size="lg" variant="secondary" onPress={() => setCelebrate(null)}>Tutup</Button>
            </div>
          </div>
        </div>
      )}

      <section aria-label="Unggah file manual" className="upload-manual">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <input ref={input} type="file" accept=".json,application/json" className="sr-only" id="upload-file" aria-label="Pilih file chat JSON" tabIndex={-1} disabled={busy} onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
            <div onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop}
              className={cn('flex min-h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors',
                dragging ? 'border-accent bg-accent-soft' : file ? 'border-success bg-success-soft/40' : 'border-field-border bg-white hover:border-accent/60 hover:bg-accent-soft/40')}>
              {file ? (
                <>
                  <FileJson className="size-12 text-success" aria-hidden="true" />
                  <p className="max-w-full break-all text-base font-semibold">{file.name}</p>
                  <p className="text-sm text-muted">{file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}><RefreshCw className="size-4" aria-hidden="true" />Ganti</Button>
                    <Button variant="danger-soft" isDisabled={busy} onPress={removeFile}><Trash2 className="size-4" aria-hidden="true" />Hapus</Button>
                  </div>
                </>
              ) : (
                <button type="button" className="upload-file-prompt" disabled={busy} onClick={() => input.current?.click()}>
                  <LottiePlayer name="upload" className="w-28" />
                  <span className="text-base font-semibold">Seret file chat ke sini</span>
                  <span className="text-sm text-muted">Pilih file .json atau paste file dengan Ctrl+V</span>
                </button>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <fieldset className="upload-mode-pills" aria-label="Cocokkan berdasarkan">
              <UploadHint selected={matchingMode === 'company'} disabled={busy || !company?.permissions.manage_settings} onSelect={() => setSelectedMode('company')}
                content={<>Sumber buyer atau listing harus memuat keyword perusahaan: <strong>{company?.search_terms.join(' · ') || 'semua pesan (keyword belum diatur)'}</strong>. Buyer → Listing memakai buyer perusahaan sebagai sumber; Listing → Buyer memakai listing perusahaan sebagai sumber. Keyword pada tanda tangan pesan juga diperiksa.</>}>Company</UploadHint>
              <UploadHint selected={matchingMode === 'sales'} disabled={busy || !company?.permissions.manage_settings} onSelect={() => setSelectedMode('sales')}
                content={<>Sumber buyer atau listing wajib memiliki nomor kontak sales dalam watchlist perusahaan, termasuk nomor alternatif di pesan. Nomor pengunggah atau pengirim chat tidak menentukan kepemilikan sumber.{company?.tracked_phones.length ? ` Nomor dipantau: ${company.tracked_phones.join(' · ')}.` : ' Watchlist company belum diisi.'}</>}>Sales (watchlist)</UploadHint>
            </fieldset>
            <p className="text-sm text-muted">Pilihan ini menjadi mode pencocokan perusahaan setelah file selesai diproses. Keyword dan nomor sales tetap mengikuti pengaturan perusahaan.</p>
            {noWatchlist && <Notice status="warning">Watchlist company kosong. Tambahkan nomor melalui <button type="button" className="font-semibold underline" onClick={() => open('stok')}>Stok Sales</button> sebelum mengunggah dalam mode Sales.</Notice>}
            <TextField value={agent} onChange={setAgent} isDisabled={busy} fullWidth>
              <Label className="text-sm font-normal">Nama sales pemilik chat</Label>
              <div className="upload-agent-input">
                <Input className="text-sm" placeholder="mis. Caesar" maxLength={60} />
                <UploadHint className="upload-agent-help" label="Informasi nama sales pemilik chat" content="Nama ini tercatat di riwayat dan di setiap match yang ditemukan, supaya Anda tahu dari upload siapa pasangan itu berasal."><Info className="size-4" aria-hidden="true" /></UploadHint>
              </div>
            </TextField>
            <Button onPress={() => void upload()} isPending={busy} isDisabled={!file || !agent.trim() || busy || !company || noWatchlist} className="w-full">
              <UploadCloud className="mr-2 size-5" aria-hidden="true" />{busy ? 'Mengunggah…' : 'Unggah & proses'}
            </Button>
            {error && <Notice status="danger" title="Belum berhasil">{error}</Notice>}
            {notice && <Notice status="success">{notice}</Notice>}
          </div>
        </div>
      </section>

      {running.map((item) => <UploadProcessing key={item.id} item={item} />)}

        </Tabs.Panel>
        <Tabs.Panel id="autoaudit"><AutoAuditCard onImported={reload} /></Tabs.Panel>
      </Tabs>
    </div>
  );
}
