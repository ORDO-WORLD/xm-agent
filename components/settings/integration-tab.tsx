'use client';

import { useState } from 'react';
import { Button, Chip, Input, Label, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { Check, Copy, Eye, EyeOff, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, Notice, Panel } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type IntegrationKey = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
type NewKey = Pick<IntegrationKey, 'id' | 'name' | 'created_at'> & { token: string; company_id: string; scope: string };

export function IntegrationTab() {
  const { company } = useCompany();
  if (!company?.permissions.manage_settings) return <Notice>Hanya admin company yang dapat mengelola token integrasi.</Notice>;
  return <IntegrationSettings companyName={company.company_name ?? 'company ini'} />;
}

function IntegrationSettings({ companyName }: { companyName: string }) {
  const api = useApi();
  const keys = useData((signal) => api.get<{ keys: IntegrationKey[] }>('/integration/keys', signal), []);
  const [name, setName] = useState('Workflow Builder');
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [visible, setVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [selected, setSelected] = useState<IntegrationKey | null>(null);
  const confirm = useOverlayState();
  const baseUrl = typeof window === 'undefined' ? '/api' : `${window.location.origin}/api`;

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} disalin`);
    } catch {
      toast.danger('Tidak dapat menyalin. Pilih teks lalu salin secara manual.');
    }
  }

  async function create() {
    if (creating || fresh || !name.trim()) return;
    setCreating(true); setError('');
    try {
      const created = await api.post<NewKey>('/integration/keys', { name: name.trim() });
      setFresh(created); setVisible(false);
      // Update immediately without depending on a second request to preserve the new token.
      keys.setData((current) => ({ keys: [{ id: created.id, name: created.name, created_at: created.created_at, last_used_at: null, revoked_at: null }, ...(current?.keys ?? [])] }));
      keys.reload();
      toast.success('Token integrasi dibuat');
    } catch (reason) { setError(errorMessage(reason)); } finally { setCreating(false); }
  }

  function askRevoke(key: IntegrationKey) {
    setSelected(key); setRevokeError(''); confirm.open();
  }

  async function revoke() {
    if (!selected || revoking) return;
    setRevoking(true); setRevokeError('');
    try {
      await api.del(`/integration/keys/${selected.id}`);
      keys.setData((current) => current ? { keys: current.keys.map((key) => key.id === selected.id ? { ...key, revoked_at: new Date().toISOString() } : key) } : current);
      if (fresh?.id === selected.id) { setFresh(null); setVisible(false); }
      keys.reload(); confirm.close(); setSelected(null);
      toast.success('Token dicabut. Workflow yang memakai token ini tidak dapat mengakses Property lagi.');
    } catch (reason) { setRevokeError(errorMessage(reason)); } finally { setRevoking(false); }
  }

  return (
    <div className="space-y-5">
      <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-5 text-accent" aria-hidden="true" />Token integrasi</span>}
        description={<>Hubungkan Workflow Builder ke data <strong>{companyName}</strong> untuk export PDF terjadwal.</>}>
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-base text-muted"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />Token hanya dapat membuat dan mengunduh export PDF company ini.</p>
          <form onSubmit={(event) => { event.preventDefault(); void create(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField value={name} onChange={setName} isRequired isDisabled={creating || !!fresh} fullWidth className="sm:max-w-md">
              <Label className="text-base font-bold">Nama koneksi</Label>
              <Input className="h-12 text-base" maxLength={100} placeholder="Mis. Workflow PDF harian" autoComplete="off" />
            </TextField>
            <Button type="submit" size="lg" isPending={creating} isDisabled={!name.trim() || !!fresh}><Plus className="size-4" aria-hidden="true" />Buat token</Button>
          </form>
          <ErrorNotice message={error} />
          {fresh && (
            <div className="space-y-3 rounded-2xl border border-success bg-success-soft p-4" aria-live="polite">
              <p className="flex items-center gap-2 text-lg font-bold"><Check className="size-5" aria-hidden="true" />Token untuk {fresh.name} siap</p>
              <p className="text-base">Salin dan simpan ke kredensial workflow sekarang. Token lengkap hanya tersedia di sini sampai Anda menutupnya atau meninggalkan halaman.</p>
              <TextField type={visible ? 'text' : 'password'} value={fresh.token} isReadOnly fullWidth>
                <Label className="text-base font-bold">Token baru</Label>
                <Input className="h-12 font-mono text-base" autoComplete="off" spellCheck={false} />
              </TextField>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onPress={() => void copy(fresh.token, 'Token')}><Copy className="size-4" aria-hidden="true" />Salin token</Button>
                <Button variant="tertiary" onPress={() => setVisible((value) => !value)}>{visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}{visible ? 'Sembunyikan' : 'Tampilkan token'}</Button>
                <Button variant="tertiary" onPress={() => { setFresh(null); setVisible(false); }}><Check className="size-4" aria-hidden="true" />Sudah disimpan</Button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Daftar token" description="Lihat kapan token dibuat dan terakhir dipakai. Token lengkap tidak dapat ditampilkan ulang."
        action={<Button variant="tertiary" isDisabled={keys.loading} onPress={keys.reload} aria-label="Muat ulang daftar token"><RefreshCw className="size-4" aria-hidden="true" />Muat ulang</Button>}>
        <ErrorNotice message={keys.error} onRetry={keys.reload} />
        {keys.loading && !keys.data && <LoadingRows rows={2} />}
        {keys.data?.keys.length === 0 && <EmptyState compact title="Belum ada token integrasi" description="Buat token di atas untuk menghubungkan workflow." />}
        <div className="space-y-3">
          {keys.data?.keys.map((key) => (
            <div key={key.id} className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2"><p className="break-words text-base font-bold">{key.name}</p><Chip size="sm" variant="soft" color={key.revoked_at ? 'default' : 'success'}>{key.revoked_at ? 'Dicabut' : 'Belum dicabut'}</Chip></div>
                <p className="text-sm text-muted">Dibuat {dateTime(key.created_at)}</p>
                <p className="text-sm text-muted">{key.last_used_at ? `Terakhir dipakai ${dateTime(key.last_used_at)}` : 'Belum pernah dipakai'}</p>
                {key.revoked_at && <p className="text-sm text-muted">Dicabut {dateTime(key.revoked_at)}</p>}
              </div>
              {!key.revoked_at && <Button variant="danger-soft" className="shrink-0 self-start sm:self-auto" isDisabled={creating || revoking} onPress={() => askRevoke(key)} aria-label={`Cabut token ${key.name}`}><Unplug className="size-4" aria-hidden="true" />Cabut token</Button>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Link2 className="size-5 text-accent" aria-hidden="true" />Koneksi ke workflow</span>}
        description="Gunakan URL API dan token di penghubung Property pada workflow. Jadwal dan pengiriman GOWA diatur dari Workflow Builder.">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <TextField value={baseUrl} isReadOnly fullWidth><Label className="text-base font-bold">URL API Property</Label><Input className="h-12 font-mono text-sm" /></TextField>
            <Button variant="secondary" className="shrink-0 self-start" onPress={() => void copy(baseUrl, 'URL API')}><Copy className="size-4" aria-hidden="true" />Salin URL</Button>
          </div>
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-base font-semibold">Endpoint dan cara menghubungkan</summary>
            <div className="mt-3 space-y-3 text-sm leading-relaxed">
              <p>Penghubung workflow menggunakan autentikasi <strong>Bearer token</strong>, lalu menjalankan urutan berikut:</p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>Mulai export dengan <code className="break-all">POST /integration/exports</code>.</li>
                <li>Cek sampai selesai dengan <code className="break-all">GET /integration/exports/&#123;job_id&#125;</code>.</li>
                <li>Unduh tiap PDF dari <code>download_url</code> hasil export menggunakan token yang sama, lalu kirim ke <code>recipient_phone</code> file tersebut.</li>
              </ol>
              <p>Kelompok berdasarkan pengirim perlu mapping nomor penerima. Hasil dengan status <code>needs_review</code> perlu diperiksa sebelum dikirim.</p>
              <p>Pembuatan token belum mengaktifkan jadwal atau pengiriman. Penghubung Property dan penerima per file perlu dikonfigurasi di workflow.</p>
            </div>
          </details>
        </div>
      </Panel>

      <Modal.Backdrop isOpen={confirm.isOpen} isDismissable={!revoking} isKeyboardDismissDisabled={revoking} onOpenChange={(open) => { if (!revoking) confirm.setOpen(open); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            {!revoking && <Modal.CloseTrigger />}
            <Modal.Header><Modal.Heading>Cabut token?</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-3">
              <p className="text-base">Workflow yang memakai token <strong>{selected?.name}</strong> tidak akan bisa membuat export atau mengunduh PDF lagi. Token ini tidak dapat diaktifkan kembali.</p>
              <ErrorNotice message={revokeError} />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={revoking} onPress={() => confirm.close()}>Batal</Button>
              <Button variant="danger" isPending={revoking} onPress={revoke}><Unplug className="size-4" aria-hidden="true" />Ya, cabut token</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
