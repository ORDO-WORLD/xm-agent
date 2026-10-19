'use client';

import { useState } from 'react';
import { AlertDialog, Button, Dropdown, Input, Label, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { BookOpen, Check, ChevronDown, Copy, Eye, EyeOff, KeyRound, Link2, List, Pencil, Plus, RefreshCw, Unplug } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, Notice } from '@/components/app/primitives';
import { SettingsLabel, SettingsNote, SettingsSection } from './settings-section';
import { SettingsPagination, useTableViewport } from './settings-pagination';
import { useSectionSearchQuery } from '@/lib/section-search';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type IntegrationKey = {
  id: string; name: string; created_at: string; last_used_at: string | null;
  revoked_at: string | null; saved_at: string | null;
};
type NewKey = Pick<IntegrationKey, 'id' | 'name' | 'created_at' | 'saved_at'> & { token: string; company_id: string; scope: string };

function TokenRow({ item, number, mobile, onEdit, onRevoke }: { item: IntegrationKey; number: number; mobile: boolean; onEdit: (key: IntegrationKey) => void; onRevoke: (key: IntegrationKey) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status = <span className={`integration-status ${item.revoked_at ? 'is-revoked' : item.saved_at ? 'is-saved' : 'is-pending'}`}>{item.revoked_at ? 'Dicabut' : item.saved_at ? 'Sudah disimpan' : 'Belum disimpan'}</span>;
  const name = <SettingsLabel tab="integrasi">{item.name}</SettingsLabel>;
  const actions = mobile ? <><button className="sales-action-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Aksi<ChevronDown size={14} /></button>{expanded && <div className="sales-card-actions"><button disabled={!!item.revoked_at} onClick={() => onEdit(item)}><Pencil size={14} />Edit</button><button disabled={!!item.revoked_at} onClick={() => onRevoke(item)}><Unplug size={14} />Cabut token</button></div>}</> :
    <Dropdown><Dropdown.Trigger className="sales-action-button" aria-label={`Aksi token ${item.name}`}>Aksi<ChevronDown size={14} /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="sales-action-menu"><Dropdown.Menu aria-label="Aksi token" onAction={(key) => key === 'edit' ? onEdit(item) : onRevoke(item)}>
      <Dropdown.Item id="edit" textValue="Edit" isDisabled={!!item.revoked_at}><Pencil className="size-3.5" /><Label>Edit</Label></Dropdown.Item>
      <Dropdown.Item id="revoke" textValue="Cabut token" variant="danger" isDisabled={!!item.revoked_at}><Unplug className="size-3.5 text-danger" /><Label>Cabut token</Label></Dropdown.Item>
    </Dropdown.Menu></Dropdown.Popover></Dropdown>;
  return mobile ? <article className="sales-card"><h3>{name}</h3><dl><div><dt>Status</dt><dd>{status}</dd></div><div><dt>Dibuat</dt><dd>{dateTime(item.created_at)}</dd></div><div><dt>Dipakai</dt><dd>{item.last_used_at ? dateTime(item.last_used_at) : 'Belum pernah'}</dd></div></dl>{actions}</article> : <tr><td>{number}</td><td className="font-medium">{name}</td><td>{status}</td><td>{dateTime(item.created_at)}</td><td>{item.last_used_at ? dateTime(item.last_used_at) : 'Belum pernah dipakai'}</td><td className="text-center">{actions}</td></tr>;
}

export function IntegrationTab() {
  const { company } = useCompany();
  if (!company?.permissions.manage_settings) return <Notice>Hanya admin company yang dapat mengelola token integrasi.</Notice>;
  return <IntegrationSettings companyName={company.company_name ?? 'company ini'} />;
}

function IntegrationSettings({ companyName }: { companyName: string }) {
  const api = useApi();
  const keys = useData((signal) => api.get<{ keys: IntegrationKey[]; has_more?: boolean }>('/integration/keys', signal), []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [name, setName] = useState('Workflow Builder');
  // Secrets remain in memory only. Closing the modal must not acknowledge or discard them.
  const [pendingTokens, setPendingTokens] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [selected, setSelected] = useState<IntegrationKey | null>(null);
  const confirm = useOverlayState();
  const editor = useOverlayState();
  const guide = useOverlayState();
  const baseUrl = typeof window === 'undefined' ? '/api' : `${window.location.origin}/api`;
  const editing = keys.data?.keys.find((key) => key.id === editingId);
  const token = editingId ? pendingTokens[editingId] : undefined;
  const busy = creating || saving;
  const query = useSectionSearchQuery();
  const mobile = useTableViewport() === 'mobile';
  const [pageSize, setPageSize] = useState(20);
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const all = keys.data?.keys ?? [];
  const filtered = all.filter((key) => !query || key.name.toLocaleLowerCase('id-ID').includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(paging.query === query ? paging.page : 1, pages);
  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  const setPage = (next: number) => setPaging({ query, page: next });
  const discardSecret = (id: string) => setPendingTokens((current) => { const next = { ...current }; delete next[id]; return next; });

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await api.get<{ keys: IntegrationKey[]; has_more: boolean }>(`/integration/keys?offset=${all.length}`);
      keys.setData((current) => ({ ...next, keys: [...(current?.keys ?? []), ...next.keys.filter((item) => !current?.keys.some((old) => old.id === item.id))] }));
    } catch (reason) { toast.danger(errorMessage(reason)); } finally { setLoadingMore(false); }
  }

  function openEditor(key?: IntegrationKey) {
    setEditingId(key?.id ?? null); setName(key?.name ?? 'Workflow Builder'); setVisible(false); setError(''); editor.open();
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} disalin`); }
    catch { toast.danger('Tidak dapat menyalin. Pilih teks lalu salin secara manual.'); }
  }
  async function create() {
    if (busy || editingId || !name.trim()) return;
    setCreating(true); setError('');
    try {
      const created = await api.post<NewKey>('/integration/keys', { name: name.trim() });
      setPendingTokens((current) => ({ ...current, [created.id]: created.token }));
      keys.setData((current) => ({ ...current, keys: [{ id: created.id, name: created.name, created_at: created.created_at, saved_at: created.saved_at, last_used_at: null, revoked_at: null }, ...(current?.keys ?? [])] }));
      setEditingId(created.id); setName(created.name); setVisible(false); setPage(1);
      toast.success('Token integrasi dibuat');
    } catch (reason) { const message = errorMessage(reason); setError(message); toast.danger(message); }
    finally { setCreating(false); }
  }
  async function update(confirmSaved: boolean) {
    if (!editing || busy || !name.trim()) return;
    setSaving(true); setError('');
    try {
      const updated = await api.put<IntegrationKey>(`/integration/keys/${editing.id}`, { name: name.trim(), confirm_saved: confirmSaved });
      keys.setData((current) => current ? { keys: current.keys.map((key) => key.id === updated.id ? updated : key) } : current);
      setName(updated.name);
      if (confirmSaved) { discardSecret(updated.id); setVisible(false); }
      if (confirmSaved || editing.saved_at) editor.close();
      toast.success(confirmSaved ? 'Penyimpanan token dikonfirmasi' : 'Nama koneksi diperbarui');
    } catch (reason) { const message = errorMessage(reason); setError(message); toast.danger(message); }
    finally { setSaving(false); }
  }
  function askRevoke(key: IntegrationKey) { setSelected(key); setRevokeError(''); confirm.open(); }
  async function revoke() {
    if (!selected || revoking) return;
    setRevoking(true); setRevokeError('');
    try {
      await api.del(`/integration/keys/${selected.id}`);
      keys.setData((current) => current ? { keys: current.keys.map((key) => key.id === selected.id ? { ...key, revoked_at: new Date().toISOString() } : key) } : current);
      discardSecret(selected.id);
      keys.reload(); confirm.close(); setSelected(null);
      toast.success('Token dicabut. Workflow yang memakai token ini tidak dapat mengakses Property lagi.');
    } catch (reason) { setRevokeError(errorMessage(reason)); } finally { setRevoking(false); }
  }

  return <div className="general-settings integration-settings">
    <SettingsSection tab="integrasi" icon={Link2} title="Koneksi ke workflow" description="Jadwal dan pengiriman GOWA diatur dari Workflow Builder.">
      <div className="integration-connection-row"><TextField value={baseUrl} isReadOnly fullWidth className="integration-url-field min-w-0 flex-1"><Label><SettingsLabel tab="integrasi">URL API Property</SettingsLabel></Label><Input className="font-mono" /></TextField><Button variant="secondary" className="shrink-0" onPress={() => void copy(baseUrl, 'URL API')}><Copy className="size-4" />Salin URL</Button><Button variant="secondary" className="shrink-0" onPress={() => guide.open()}><BookOpen className="size-4" /><SettingsLabel tab="integrasi">Panduan Endpoint</SettingsLabel></Button></div>
    </SettingsSection>
    <section className="integration-token-section">
      <header className="sales-section-header">
        <div><h2 className="flex items-center gap-2 text-[0.9375rem] font-medium"><List className="size-4" aria-hidden="true" /><SettingsLabel tab="integrasi">Daftar token</SettingsLabel></h2><p className="mt-1 text-sm text-muted">Hubungkan Workflow Builder ke data {companyName}. Status penyimpanan berubah setelah Anda mengonfirmasinya di modal.</p></div>
        <div className="sales-section-actions"><Button variant="tertiary" isDisabled={keys.loading} onPress={keys.reload} aria-label="Muat ulang daftar token"><RefreshCw className="size-4" />Muat ulang</Button><Button onPress={() => openEditor()}><Plus className="size-4" />Buat token</Button></div>
      </header>
      <ErrorNotice message={keys.error} onRetry={keys.reload} />
      {keys.loading && !keys.data && <LoadingRows rows={2} />}
      {keys.data?.keys.length === 0 && <EmptyState compact title="Belum ada token integrasi" description="Buat token di atas untuk menghubungkan workflow." />}
      {all.length > 0 && <>
        {mobile ? <div className="sales-cards">{rows.map((item, index) => <TokenRow key={item.id} item={item} number={start + index + 1} mobile onEdit={openEditor} onRevoke={askRevoke} />)}{!rows.length && <p className="p-4 text-sm">Nama koneksi tidak ditemukan.</p>}</div> : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>No</th><th>Nama koneksi</th><th>Status penyimpanan</th><th>Dibuat</th><th>Terakhir dipakai</th><th className="text-center">Aksi</th></tr></thead><tbody>{rows.map((item, index) => <TokenRow key={item.id} item={item} number={start + index + 1} mobile={false} onEdit={openEditor} onRevoke={askRevoke} />)}{!rows.length && <tr><td colSpan={6}>Nama koneksi tidak ditemukan.</td></tr>}</tbody></table></div>}
        <SettingsPagination page={page} pageSize={pageSize} total={filtered.length} label="token" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      </>}
      {keys.data?.has_more && <Button variant="secondary" isPending={loadingMore} isDisabled={keys.loading || busy} onPress={() => void loadMore()}>Muat token berikutnya</Button>}
    </section>

    <Modal.Backdrop isOpen={guide.isOpen} onOpenChange={(open) => guide.setOpen(open)}>
      <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog integration-guide-dialog">
        <Modal.CloseTrigger /><Modal.Header><Modal.Heading>Panduan Endpoint</Modal.Heading></Modal.Header>
        <Modal.Body className="sales-dialog-body space-y-3 text-sm leading-relaxed">
        <p>Penghubung workflow menggunakan autentikasi <span className="font-medium">Bearer token</span>, lalu menjalankan urutan berikut:</p>
        <ol className="list-decimal space-y-2 pl-5"><li>Mulai export dengan <code className="break-all">POST /integration/exports</code>.</li><li>Cek sampai selesai dengan <code className="break-all">GET /integration/exports/&#123;job_id&#125;</code>.</li><li>Unduh tiap PDF dari <code>download_url</code> hasil export menggunakan token yang sama, lalu kirim ke <code>recipient_phone</code> file tersebut.</li></ol>
        <SettingsNote>Kelompok berdasarkan pengirim perlu mapping nomor penerima. Hasil dengan status <code>needs_review</code> perlu diperiksa sebelum dikirim.</SettingsNote>
        <SettingsNote>Pembuatan token belum mengaktifkan jadwal atau pengiriman. Penghubung Property dan penerima per file perlu dikonfigurasi di workflow.</SettingsNote>
        </Modal.Body>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>

    <Modal.Backdrop isOpen={editor.isOpen} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!busy) { editor.setOpen(open); setVisible(false); } }}>
      <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog integration-key-dialog">
        {!busy && <Modal.CloseTrigger />}<Modal.Header><Modal.Heading>{editingId ? 'Edit token integrasi' : 'Buat token integrasi'}</Modal.Heading></Modal.Header>
        <Modal.Body className="sales-dialog-body space-y-3">
          <TextField value={name} onChange={setName} isRequired isDisabled={busy} fullWidth><Label>Nama koneksi</Label><Input maxLength={100} placeholder="Mis. Workflow PDF harian" autoComplete="off" /></TextField>
          {!editingId && <SettingsNote>Token hanya dapat membuat dan mengunduh export PDF company ini.</SettingsNote>}
          {token && <div className="integration-fresh-token">
            <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />Token siap disalin</p>
            <SettingsNote>Salin token ke kredensial workflow, lalu tekan “Sudah disimpan”. Menutup modal tidak mengubah status. Token lengkap tidak tersedia lagi setelah halaman dimuat ulang atau Anda meninggalkan tab ini.</SettingsNote>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1"><label htmlFor="integration-token-value" className="mb-1.5 block text-sm">Token baru</label><div className="account-password-input">
                <input id="integration-token-value" className="input font-mono" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} />
                <button type="button" aria-label={visible ? 'Sembunyikan token' : 'Tampilkan token'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button>
              </div></div>
              <Button variant="secondary" className="shrink-0" aria-label="Salin token lengkap" onPress={() => void copy(token, 'Token')}><Copy className="size-4" />Salin token</Button>
            </div>
          </div>}
          {editing && !token && <SettingsNote>{editing.saved_at ? 'Penyimpanan token sudah dikonfirmasi. Token lengkap tidak dapat ditampilkan ulang.' : 'Penyimpanan token belum dikonfirmasi. Token lengkap tidak tersedia setelah halaman dimuat ulang. Jika belum sempat menyalinnya, cabut token ini dan buat token baru.'}</SettingsNote>}
          <ErrorNotice message={error} />
        </Modal.Body>
        <Modal.Footer className="flex-wrap"><Button variant="secondary" isDisabled={busy} onPress={() => { editor.close(); setVisible(false); }}>Tutup</Button>
          {editing && !editing.saved_at && name.trim() !== editing.name && <Button variant="secondary" isPending={saving} isDisabled={!name.trim()} onPress={() => void update(false)}>Simpan nama</Button>}
          {!editingId ? <Button isPending={creating} isDisabled={!name.trim()} onPress={create}><Plus className="size-4" />Buat token</Button> : <Button isPending={saving} isDisabled={!editing || !name.trim()} onPress={() => void update(!editing?.saved_at)}><Check className="size-4" />{editing?.saved_at ? 'Simpan' : 'Sudah disimpan'}</Button>}
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>

    <AlertDialog.Backdrop className="company-logout-backdrop" isOpen={confirm.isOpen} isDismissable={!revoking} isKeyboardDismissDisabled={revoking} onOpenChange={(open) => { if (!revoking) confirm.setOpen(open); }}><AlertDialog.Container placement="center" className="company-logout-container"><AlertDialog.Dialog className="company-logout-dialog integration-revoke-dialog">
      <AlertDialog.Header className="company-logout-heading company-logout-intro integration-revoke-header"><div className="company-logout-icon"><Unplug className="size-7" aria-hidden="true" /></div><AlertDialog.Heading>Konfirmasi Cabut Token</AlertDialog.Heading></AlertDialog.Header>
      <AlertDialog.Body className="company-logout-message integration-revoke-body"><p>Workflow yang memakai token <span className="font-medium break-words">{selected?.name}</span> tidak akan bisa membuat export atau mengunduh PDF lagi. Token ini tidak dapat diaktifkan kembali.</p><ErrorNotice message={revokeError} /></AlertDialog.Body>
      <AlertDialog.Footer className="company-logout-actions"><Button variant="secondary" className="company-logout-cancel" isDisabled={revoking} onPress={() => confirm.close()}>Batal</Button><Button variant="danger" className="company-logout-confirm" isPending={revoking} onPress={revoke}>Ya, cabut token</Button></AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
  </div>;
}
