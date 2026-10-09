'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Modal, ProgressBar, toast, type useOverlayState } from '@heroui/react';
import { CircleCheck, Download, FileText, Sparkles } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/app/primitives';
import { BlurFade } from '@/components/magicui/blur-fade';
import { errorMessage } from '@/lib/api';
import { number, todayWib } from '@/lib/format';
import type { Direction, GroupBy } from '@/lib/types';
import { useData } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type PlanGroup = { key: string; title: string; sources: number; hot: number; warm: number; unmatched: number; pages: number };
type Plan = { token: string; group_by: GroupBy; groups: PlanGroup[]; totals: Omit<PlanGroup, 'key' | 'title'>; max_pages: number };
type Stage = 'confirm' | 'running' | 'merging' | 'done' | 'failed';

/** Rough speed before the first parts have been timed; the estimate follows the real speed after that. */
const PAGES_PER_SECOND = 25;
const PHRASE_SECONDS = 6;

/** Thirty lines at six seconds each: three minutes before the first one comes round again. */
function phrases(source: string, target: string) {
  return [
    'Melakukan analisa…', `Membaca semua ${source} sesuai filter…`, `Mendapatkan Hot ${target}…`, `Mendapatkan Warm ${target}…`,
    'Sedang menyusun halaman…', 'Mengelompokkan per sales…', 'Mencocokkan lokasi…', 'Membandingkan harga dan budget…',
    'Memeriksa luas tanah dan bangunan…', 'Mengurutkan dari yang paling cocok…', 'Menyiapkan tombol WhatsApp di tiap halaman…',
    'Menulis pesan asli ke halaman…', `Memeriksa status ${target} yang masih Ready…`, 'Menyusun halaman pembuka tiap sales…',
    'Menggabungkan pesan yang sama…', 'Memberi nomor halaman…', `Mengambil ${source} berikutnya…`, 'Menata dua kolom supaya enak dibaca…',
    'Menandai kecocokan Hot…', 'Menandai kecocokan Warm…', 'Memastikan tidak ada yang terlewat…', 'Merapikan tulisan panjang…',
    'Menempelkan ID buyer dan listing…', 'Menyimpan bagian yang sudah jadi…', 'Sedikit lagi untuk sales ini…', 'Melanjutkan ke sales berikutnya…',
    'Semakin banyak data, semakin lama, mohon tunggu…', 'Jangan tutup halaman ini ya…', 'Mengecek ulang hasil pencocokan…', 'Menyiapkan file PDF…',
  ];
}

function duration(seconds: number) {
  if (seconds < 50) return 'kurang dari 1 menit';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `± ${minutes} menit` : `± ${Math.floor(minutes / 60)} jam ${minutes % 60} menit`;
}

/** Export every match of the current filters into one PDF: confirm first, then real progress per sales. */
export function ExportAllModal({ state, direction, filters }: { state: ReturnType<typeof useOverlayState>; direction: Direction; filters: Record<string, string> }) {
  const [locked, setLocked] = useState(false);
  return (
    <Modal.Backdrop isOpen={state.isOpen} isDismissable={!locked} isKeyboardDismissDisabled={locked} onOpenChange={(open) => { if (open || !locked) state.setOpen(open); }}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>{state.isOpen ? <Body direction={direction} filters={filters} onLock={setLocked} onClose={() => { setLocked(false); state.close(); }} /> : null}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function Body({ direction, filters, onLock, onClose }: { direction: Direction; filters: Record<string, string>; onLock: (locked: boolean) => void; onClose: () => void }) {
  const api = useApi();
  const plan = useData((signal) => api.post<Plan>('/export/all/plan', filters, signal), []);
  const [stage, setStage] = useState<Stage>('confirm');
  const [current, setCurrent] = useState(0);
  const [pages, setPages] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState('');
  const [file, setFile] = useState('');
  const cancelled = useRef(false);
  const startedAt = useRef(0);
  const working = stage === 'running' || stage === 'merging';

  // Leaving the page or closing the window stops the loop; unfinished parts are thrown away by the server later.
  useEffect(() => () => { cancelled.current = true; }, []);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file); }, [file]);
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [working]);

  const source = direction === 'buyer' ? 'buyer' : 'listing';
  const target = direction === 'buyer' ? 'listing' : 'buyer';
  const data = plan.data;
  const byPhone = data?.group_by === 'phone';
  const unit = byPhone ? 'nomor' : 'pengirim';
  const fileName = `Semua-Pencocokan-${todayWib()}.pdf`;
  const totalPages = data ? data.totals.pages + data.groups.length : 0;
  const tooBig = !!data && totalPages > data.max_pages;
  const fraction = stage === 'done' || stage === 'merging' ? 1 : totalPages ? Math.min(pages / totalPages, 1) : 0;
  const estimate = data ? totalPages / PAGES_PER_SECOND + data.groups.length * 0.3 + 5 : 0;
  // After a few seconds of real work, the remaining time follows the measured speed.
  const remaining = elapsed > 4 && fraction > 0.02 ? (elapsed / fraction) * (1 - fraction) : Math.max(estimate - elapsed, 0);
  const lines = phrases(source, target);
  const phrase = stage === 'merging' ? 'Menggabungkan semua bagian menjadi satu PDF…' : lines[Math.floor(elapsed / PHRASE_SECONDS) % lines.length];

  function save(url: string) {
    const link = document.createElement('a');
    link.href = url; link.download = fileName; link.click();
  }

  async function start() {
    if (!data) return;
    cancelled.current = false;
    startedAt.current = Date.now();
    setStage('running'); setProblem(''); setPages(0); setElapsed(0); setCurrent(0);
    onLock(true);
    try {
      let page = 1;
      for (let index = 0; index < data.groups.length; index += 1) {
        setCurrent(index);
        let offset: number | null = 0;
        while (offset !== null) {
          if (cancelled.current) return;
          const done: { pages: number; next_offset: number | null } = await api.post('/export/all/part', { ...filters, token: data.token, index, group_key: data.groups[index].key, offset, first_page: page });
          page += done.pages; offset = done.next_offset;
          setPages(page - 1);
        }
      }
      if (cancelled.current) return;
      setStage('merging');
      const blob = await api.file(`/export/all/${data.token}/download`);
      if (cancelled.current) return;
      const url = URL.createObjectURL(blob);
      setFile(url); save(url);
      setStage('done');
      toast.success('PDF semua pencocokan siap diunduh');
    } catch (reason) {
      if (cancelled.current) return;
      setProblem(errorMessage(reason, 'Export belum dapat diselesaikan.'));
      setStage('failed');
      void api.post('/export/all/cancel', { token: data.token }).catch(() => {});
    } finally { onLock(false); }
  }

  function stop() {
    cancelled.current = true;
    if (data) void api.post('/export/all/cancel', { token: data.token }).catch(() => {});
    toast('Export dibatalkan');
    onClose();
  }

  const stats = data ? [
    [byPhone ? 'Nomor telepon' : 'Pengirim', data.groups.length, 'bg-accent-soft text-accent-soft-foreground'],
    [direction === 'buyer' ? 'Buyer' : 'Listing', data.totals.sources, 'bg-default text-foreground'],
    ['🔥 Hot', data.totals.hot, 'bg-danger-soft text-danger-soft-foreground'],
    ['🌡️ Warm', data.totals.warm, 'bg-warning-soft text-warning-soft-foreground'],
    ...(data.totals.unmatched ? [['Belum cocok', data.totals.unmatched, 'bg-default text-foreground'] as const] : []),
  ] as const : [];

  return (
    <>
      {!working && <Modal.CloseTrigger />}
      <Modal.Header><Modal.Heading>{stage === 'done' ? 'Export selesai' : working ? 'Sedang membuat PDF…' : 'Export semua pencocokan ke PDF'}</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-4">
        <ErrorNotice message={plan.error} onRetry={plan.reload} />
        {plan.loading && !data && <LoadingRows rows={3} />}
        {data && data.groups.length === 0 && <EmptyState compact animation="empty-box" title="Tidak ada pencocokan untuk filter ini" description="Ubah tanggal atau aktifkan Hot, Warm, atau Belum cocok, lalu coba lagi." />}

        {data && data.groups.length > 0 && (stage === 'confirm' || stage === 'failed') && (
          <>
            <p className="text-base leading-relaxed">Mulai export semua pencocokan sesuai filter yang sedang aktif. Hasilnya satu file PDF, dikelompokkan per <strong>{byPhone ? 'nomor telepon' : 'pengirim'}</strong>.</p>
            <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
              {stats.map(([label, value, tone]) => (
                <div key={label} className={`rounded-2xl px-2 py-3 ${tone}`}><dd className="text-2xl font-bold leading-none tracking-tight">{number(value)}</dd><dt className="mt-1.5 text-sm font-semibold">{label}</dt></div>
              ))}
            </dl>
            <p className="rounded-2xl border border-border bg-background p-3 text-base">Total <strong>{number(totalPages)} halaman</strong> · perkiraan waktu <strong>{duration(estimate)}</strong>.{!tooBig && totalPages > 3000 ? ' File ini besar. Persempit tanggal atau filter kalau ingin lebih cepat.' : ''}</p>
            {tooBig && <ErrorNotice message={`Terlalu besar untuk satu PDF (batas ${number(data.max_pages)} halaman). Persempit tanggal posting, pilih Hot saja, atau isi nomor sales, lalu coba lagi.`} />}
            {stage === 'failed' && <ErrorNotice message={problem} />}
          </>
        )}

        {data && working && (
          <div className="space-y-4 py-2" aria-live="polite">
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 animate-float items-center justify-center rounded-2xl bg-accent text-accent-foreground"><Sparkles className="size-6" aria-hidden="true" /></span>
              <BlurFade key={phrase} duration={0.5} className="min-w-0 flex-1"><p className="text-lg font-bold leading-snug">{phrase}</p></BlurFade>
            </div>
            <ProgressBar aria-label="Kemajuan export" value={Math.round(fraction * 100)} color="accent" size="lg">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-base">
                <span className="font-semibold">Memproses {Math.min(current + 1, data.groups.length)} dari {data.groups.length} {unit}</span>
                <ProgressBar.Output className="font-bold" />
              </div>
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
            <p className="truncate text-base text-muted">{stage === 'merging' ? 'Semua sales selesai diproses.' : data.groups[current]?.title}</p>
            <p className="text-base text-muted">{number(Math.min(pages, totalPages))} dari {number(totalPages)} halaman · sisa waktu <strong className="text-foreground">{stage === 'merging' ? 'sebentar lagi' : duration(remaining)}</strong></p>
          </div>
        )}

        {data && stage === 'done' && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CircleCheck className="size-14 text-success" aria-hidden="true" />
            <p className="text-lg font-bold">{number(totalPages)} halaman untuk {data.groups.length} {unit}</p>
            <p className="text-base text-muted">File <strong>{fileName}</strong> sudah diunduh. Kalau belum muncul, tekan Unduh lagi.</p>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {working && <Button variant="tertiary" size="lg" onPress={stop}>Batalkan</Button>}
        {!working && <Button variant="tertiary" size="lg" onPress={onClose}>{stage === 'done' ? 'Tutup' : 'Batal'}</Button>}
        {stage === 'done' && <Button size="lg" onPress={() => save(file)}><Download className="size-4" aria-hidden="true" />Unduh lagi</Button>}
        {(stage === 'confirm' || stage === 'failed') && <Button size="lg" isDisabled={!data?.groups.length || tooBig} onPress={start}><FileText className="size-4" aria-hidden="true" />{stage === 'failed' ? 'Coba lagi' : 'Mulai export'}</Button>}
      </Modal.Footer>
    </>
  );
}
