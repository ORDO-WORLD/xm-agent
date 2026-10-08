'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Button, Chip, Input, Label, ProgressBar, TextField } from '@heroui/react';
import { ArrowRight, CheckCircle2, FileJson, History, TriangleAlert, UploadCloud } from 'lucide-react';
import { EmptyState, ErrorNotice, Notice, PageHeader, Panel } from '@/components/app/primitives';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { BorderBeam } from '@/components/magicui/border-beam';
import { Confetti, type ConfettiRef } from '@/components/magicui/confetti';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { errorMessage } from '@/lib/api';
import { dateTime, number } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { ImportRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/workspace-context';

const statusLabel: Record<string, string> = { queued: 'Menunggu antrean', processing: 'Sedang diproses', completed: 'Selesai', failed: 'Gagal' };

function steps(item: ImportRow) {
  const reading = item.status === 'processing' && item.processed_messages < item.total_messages;
  const matching = item.status === 'processing' && item.total_messages > 0 && item.processed_messages >= item.total_messages;
  const done = item.status === 'completed';
  return [
    { label: 'Diterima', state: 'done' as const },
    { label: 'Membaca pesan', state: done || matching ? ('done' as const) : reading || item.status === 'processing' ? ('active' as const) : ('todo' as const) },
    { label: 'Mencocokkan', state: done ? ('done' as const) : matching ? ('active' as const) : ('todo' as const) },
    { label: 'Selesai', state: done ? ('done' as const) : ('todo' as const) },
  ];
}

export default function UploadPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { refresh } = useCompany();
  const input = useRef<HTMLInputElement>(null);
  const confetti = useRef<ConfettiRef>(null);
  const [agent, setAgent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [celebrate, setCelebrate] = useState<ImportRow | null>(null);
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

  function choose(candidate?: File | null) {
    setError(''); setNotice('');
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.json')) { setError('Gunakan file berformat .json (cleaned.json dari ekspor chat).'); return; }
    setFile(candidate);
    // The export is named "Sales - Kantor - ... - cleaned.json"; its first part is usually the person.
    if (!agent.trim()) setAgent(candidate.name.split(' - ')[0]?.trim().slice(0, 60) ?? '');
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
      const result = await api.form<{ duplicate?: boolean; agent_name?: string }>('/imports', form);
      setNotice(result.duplicate ? 'File ini sudah pernah diunggah dan diproses, jadi tidak ditambahkan lagi.' : `Data ${result.agent_name ?? agent} masuk antrean dan mulai diproses.`);
      setFile(null);
      if (input.current) input.current.value = '';
      reload();
    } catch (reason) { setError(errorMessage(reason, 'Upload belum berhasil. Periksa file lalu coba lagi.')); } finally { setBusy(false); }
  }, [api, file, agent, reload]);

  const running = imports.data?.filter((item) => item.status === 'queued' || item.status === 'processing') ?? [];
  const history = imports.data ?? [];

  return (
    <div className="space-y-6">
      <Confetti ref={confetti} manualstart className="pointer-events-none fixed inset-0 z-[100] size-full" aria-hidden="true" />
      <PageHeader title="Unggah Data" description="Tambahkan hasil ekspor chat WhatsApp (cleaned.json). Setelah diproses, pasangan buyer dan listing yang baru ditemukan muncul di Match Terbaru." />

      {celebrate && (
        <div className="relative overflow-hidden rounded-3xl border border-success/40 bg-success-soft p-5">
          <BorderBeam size={140} duration={8} colorFrom="#10b981" colorTo="#5dd0ea" />
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <LottiePlayer name={celebrate.new_matches > 0 ? 'match-found' : 'success'} className="w-32 shrink-0" label="Selesai" />
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold">{celebrate.new_matches > 0 ? `${number(celebrate.new_matches)} match baru ditemukan!` : 'Data selesai diproses'}</p>
              <p className="mt-1 text-base leading-relaxed text-foreground/80">
                {celebrate.file_name} — {number(celebrate.request_count)} buyer dan {number(celebrate.listing_count)} listing dibaca.
                {celebrate.new_matches > 0 ? ` Dari ${number(celebrate.new_matches)} pasangan baru, ${number(celebrate.new_hot)} Hot dan ${number(celebrate.new_warm)} Warm.` : ' Belum ada pasangan baru dari data ini.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" onPress={() => navigate?.('match-baru')}>Lihat Match Terbaru<ArrowRight className="size-4" aria-hidden="true" /></Button>
              <Button size="lg" variant="secondary" onPress={() => setCelebrate(null)}>Tutup</Button>
            </div>
          </div>
        </div>
      )}

      <Panel title="1. Siapkan file" description="Seret file ke kotak di bawah, atau ketuk untuk memilih dari perangkat.">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <input ref={input} type="file" accept=".json,application/json" className="sr-only" id="upload-file" onChange={(event) => choose(event.target.files?.[0])} />
            <div role="presentation" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <label htmlFor="upload-file"
              className={cn('flex min-h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-6 text-center transition-colors',
                dragging ? 'border-accent bg-accent-soft' : file ? 'border-success bg-success-soft/40' : 'border-field-border bg-background hover:border-accent/60 hover:bg-accent-soft/40')}>
              {file ? (
                <>
                  <FileJson className="size-12 text-success" aria-hidden="true" />
                  <p className="max-w-full break-all text-lg font-bold">{file.name}</p>
                  <p className="text-base text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB · ketuk untuk mengganti file</p>
                </>
              ) : (
                <>
                  <LottiePlayer name="upload" className="w-28" />
                  <p className="text-lg font-bold">Seret file chat ke sini</p>
                  <p className="text-base text-muted">atau ketuk untuk memilih file .json</p>
                </>
              )}
            </label>
            </div>
          </div>
          <div className="space-y-4">
            <TextField value={agent} onChange={setAgent} fullWidth>
              <Label className="text-base font-bold">Nama sales pemilik chat</Label>
              <Input className="h-12 text-base" placeholder="mis. Caesar" maxLength={60} />
            </TextField>
            <p className="text-base leading-relaxed text-muted">Nama ini tercatat di riwayat dan di setiap match yang ditemukan, supaya Anda tahu dari upload siapa pasangan itu berasal.</p>
            <ShimmerButton onClick={() => void upload()} disabled={!file || !agent.trim() || busy} background="oklch(0.48 0.235 265)" borderRadius="16px" shimmerColor="#a5f3fc"
              className="h-14 w-full text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-50">
              <UploadCloud className="mr-2 size-5" aria-hidden="true" />{busy ? 'Mengunggah…' : 'Unggah & proses'}
            </ShimmerButton>
            {error && <Notice status="danger" title="Belum berhasil">{error}</Notice>}
            {notice && <Notice status="success">{notice}</Notice>}
          </div>
        </div>
      </Panel>

      {running.map((item) => (
        <Panel key={item.id} title={`2. Sedang diproses — ${item.file_name}`} description={`${item.agent_name} · ${statusLabel[item.status] ?? item.status}`}>
          <ol className="mb-4 grid grid-cols-4 gap-2">
            {steps(item).map((step) => (
              <li key={step.label} className="text-center">
                <span className={cn('mx-auto flex size-9 items-center justify-center rounded-full text-base font-bold', step.state === 'done' ? 'bg-success text-success-foreground' : step.state === 'active' ? 'animate-pulse bg-accent text-accent-foreground' : 'bg-default text-muted')}>
                  {step.state === 'done' ? <CheckCircle2 className="size-5" aria-hidden="true" /> : ''}
                </span>
                <span className="mt-1.5 block text-sm font-semibold leading-tight">{step.label}</span>
              </li>
            ))}
          </ol>
          <ProgressBar aria-label="Kemajuan pemrosesan" value={item.total_messages ? Math.round((item.processed_messages / item.total_messages) * 100) : 0} isIndeterminate={!item.total_messages}>
            <Label>{number(item.processed_messages)} dari {number(item.total_messages)} pesan</Label>
            <ProgressBar.Output />
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <p className="mt-2 text-sm text-muted">Anda boleh berpindah halaman. Proses berjalan di latar belakang dan hasilnya muncul di Match Terbaru.</p>
        </Panel>
      ))}

      <Panel title={<span className="flex items-center gap-2"><History className="size-5 text-accent" aria-hidden="true" />Riwayat upload</span>} description="Upload terbaru ada di atas.">
        <ErrorNotice message={imports.error} onRetry={imports.reload} />
        {history.length === 0 && !imports.loading && <EmptyState compact animation="upload" title="Belum ada upload" description="File yang Anda unggah akan tercatat di sini." />}
        <ul className="space-y-3">
          {history.map((item) => (
            <li key={item.id} className="rounded-2xl border border-border p-3.5 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-base font-bold">{item.file_name}</p>
                  <p className="text-sm text-muted">{item.agent_name} · {dateTime(item.created_at)}</p>
                </div>
                <Chip color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'} variant="soft" size="md">{statusLabel[item.status] ?? item.status}</Chip>
              </div>
              {item.status === 'failed' && item.error && <p className="mt-2 flex items-start gap-2 text-sm text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{item.error}</p>}
              {item.status === 'completed' && (
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-base">
                  <span><strong>{number(item.request_count)}</strong> buyer</span>
                  <span><strong>{number(item.listing_count)}</strong> listing</span>
                  <span className="text-muted">{number(item.duplicate_count)} duplikat · {number(item.ignored_count)} diabaikan</span>
                  <span className="font-semibold text-accent">{number(item.new_matches)} match baru{item.new_matches > 0 ? ` (${item.new_hot} Hot · ${item.new_warm} Warm)` : ''}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
