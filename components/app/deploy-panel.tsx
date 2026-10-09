'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Rocket } from 'lucide-react';
import { ConfirmDialog, Notice, Panel } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { DeployStatus } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const POLL_MS = 2000;
const STATE = {
  idle: { label: 'Belum pernah dijalankan', color: 'default' },
  running: { label: 'Sedang berjalan', color: 'accent' },
  success: { label: 'Berhasil', color: 'success' },
  failed: { label: 'Gagal', color: 'danger' },
} as const;

/** Platform administrator only: pull the latest version onto the server and watch it happen. */
export function DeployPanel() {
  const api = useApi();
  const [data, setData] = useState<DeployStatus>();
  // While a deploy runs the API restarts itself, so failed polls are expected and polling goes on.
  const [watching, setWatching] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    async function poll() {
      let again = watching;
      try {
        const value = await api.get<DeployStatus>('/admin/deploy', controller.signal);
        if (controller.signal.aborted) return;
        again = value.enabled && value.status === 'running';
        setData(value); setUnreachable(false); setWatching(again);
      } catch {
        if (controller.signal.aborted) return;
        setUnreachable(true);
      }
      if (again) timer = window.setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [api, watching]);

  const log = data?.enabled ? data.log : '';
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  if (!data?.enabled) return null;

  async function run() {
    setBusy(true); setError('');
    try {
      setData(await api.post<DeployStatus>('/admin/deploy'));
      setWatching(true);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); setConfirm(false); }
  }

  const running = data.status === 'running';
  const state = STATE[data.status];
  return (
    <Panel title={<span className="flex items-center gap-2"><Rocket className="size-5 text-accent" aria-hidden="true" />Deploy aplikasi</span>}
      description={data.commit ? <>Versi terpasang: <span className="font-mono">{data.commit.sha}</span> — {data.commit.subject} ({dateTime(data.commit.date)})</> : 'Ambil versi terbaru dari origin/main lalu pasang di server ini.'}
      action={<Button size="lg" isPending={running || busy} isDisabled={running} onPress={() => setConfirm(true)}>{running ? 'Sedang deploy…' : 'Deploy sekarang'}</Button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Chip variant="soft" size="md" color={state.color}>{state.label}</Chip>
          {data.started_at && <span>Mulai {dateTime(data.started_at)}</span>}
          {data.finished_at && <span>· Selesai {dateTime(data.finished_at)}</span>}
        </div>
        {error && <Notice status="danger">{error}</Notice>}
        {watching && unreachable && <Notice status="accent">API sedang restart. Menunggu kembali online…</Notice>}
        {data.status === 'success' && <Notice status="success">Deploy selesai. Muat ulang halaman ini untuk memakai tampilan terbaru.</Notice>}
        {data.status === 'failed' && <Notice status="danger">{data.exit_code === null ? 'Deploy terhenti sebelum selesai (server mati atau proses dihentikan).' : `Deploy gagal dengan kode ${data.exit_code}.`} Periksa log di bawah.</Notice>}
        {log && <pre ref={logRef} aria-label="Log deploy" className="max-h-96 overflow-auto rounded-xl bg-default p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground">{log}</pre>}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Deploy versi terbaru?" confirmLabel="Ya, deploy" status="warning" busy={busy} onConfirm={run}>
        Server akan mengambil versi terbaru dari origin/main. API dan worker bisa restart selama beberapa menit, dan pengguna yang sedang aktif akan terganggu sebentar.
      </ConfirmDialog>
    </Panel>
  );
}
