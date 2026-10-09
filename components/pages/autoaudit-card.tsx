'use client';

import { useEffect, useState } from 'react';
import { Button, Chip, ComboBox, Input, Label, ListBox, TextField } from '@heroui/react';
import { Link2, RefreshCw, TriangleAlert, Unlink } from 'lucide-react';
import { ConfirmDialog, ErrorNotice, Notice, Panel } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { AutoAuditOptions, AutoAuditSource, AutoAuditSources } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

// After an action, keep refreshing for this many 5-second ticks even if the status has not changed yet.
const WATCH_TICKS = 18;

function statusChip(source: AutoAuditSource) {
  if (source.status === 'failed') return { color: 'danger' as const, label: 'Gagal' };
  if (source.status === 'pulling') return { color: 'warning' as const, label: 'Menarik' };
  if (source.status === 'current') return { color: 'success' as const, label: source.dataset_updated_at ? `Terbaru sampai ${dateTime(source.dataset_updated_at)}` : 'Terbaru' };
  return { color: 'default' as const, label: 'Menunggu data' };
}

/** Which AutoAudit sales accounts feed this company, and how fresh their data is. */
export function AutoAuditCard({ onImported }: { onImported: () => void }) {
  const api = useApi();
  const { company } = useCompany();
  const platform = Boolean(company?.permissions.platform);
  const canManage = Boolean(company?.permissions.upload_data);
  const [salesId, setSalesId] = useState('');
  const [agent, setAgent] = useState('');
  const [agentTouched, setAgentTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<AutoAuditSource | null>(null);
  const [watch, setWatch] = useState(0);

  const sources = useData((signal) => api.get<AutoAuditSources>('/autoaudit/sources', signal), []);
  const configured = sources.data?.configured ?? false;
  const linked = sources.data?.linked ?? false;
  const options = useData((signal) => api.get<AutoAuditOptions>('/autoaudit/options', signal), [], canManage && configured && linked);
  const list = sources.data?.sources ?? [];
  const reload = sources.reload;
  const active = list.some((item) => item.status === 'waiting' || item.status === 'pulling');

  // While a pull is under way (or was just asked for), keep this card and the import history fresh.
  useEffect(() => {
    if (!active && watch <= 0) return;
    const timer = window.setInterval(() => {
      reload(); onImported();
      setWatch((left) => Math.max(left - 1, 0));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, watch, reload, onImported]);

  const sales = options.data?.sales ?? [];
  const suggested = options.data?.agent_names[0] ?? sales.find((item) => String(item.id) === salesId)?.name ?? '';
  const agentName = agentTouched ? agent : suggested;
  const available = sales.filter((item) => !list.some((source) => source.sales_id === item.id));

  async function run(key: string, action: () => Promise<void>, fallback: string) {
    setBusy(key); setError(''); setNotice('');
    try { await action(); setWatch(WATCH_TICKS); reload(); } catch (reason) { setError(errorMessage(reason, fallback)); } finally { setBusy(''); }
  }

  const connect = () => run('connect', async () => {
    await api.post('/autoaudit/sources', { sales_id: Number(salesId), agent_name: agentName.trim() });
    setSalesId(''); setAgent(''); setAgentTouched(false);
    setNotice('Tersambung. Data awal sedang diambil dan akan muncul di riwayat di bawah.');
  }, 'Belum berhasil menyambungkan. Coba lagi.');

  const syncNow = (source: AutoAuditSource) => run(`sync-${source.id}`, async () => {
    await api.post(`/autoaudit/sources/${source.id}/sync`);
    setNotice('Permintaan diterima. Data yang tersedia sedang diambil.');
  }, 'Sinkronisasi belum dapat diminta. Coba lagi.');

  const disconnect = () => removing && run(`remove-${removing.id}`, async () => {
    await api.del(`/autoaudit/sources/${removing.id}`);
    setRemoving(null);
    setNotice('Sambungan diputus. Data yang sudah masuk tetap ada.');
  }, 'Sambungan belum dapat diputus. Coba lagi.');

  if (!sources.data && !sources.error) return null;
  if (!configured) {
    // Only the platform administrator can act on this; nobody else needs to see an empty card.
    return platform ? <Notice status="default" title="Sambungan AutoAudit">Sambungan AutoAudit belum dikonfigurasi di server.</Notice> : null;
  }
  // Without a linked AutoAudit company there is nothing a company can connect; only the platform admin can change that.
  if (!linked && list.length === 0) {
    return platform ? <Notice status="default" title="Sambungan AutoAudit">Company ini belum dihubungkan ke company AutoAudit. Atur lewat menu Perusahaan (ikon pensil pada company ini).</Notice> : null;
  }
  if (!canManage && list.length === 0) return null;

  return (
    <Panel title={<span className="flex items-center gap-2"><Link2 className="size-5 text-accent" aria-hidden="true" />Sambungan AutoAudit</span>}
      description={`Chat dari sales yang tersambung masuk otomatis setiap kali sinkronisasi di AutoAudit selesai.${sources.data?.autoaudit_company_name ? ` Company AutoAudit: ${sources.data.autoaudit_company_name}.` : ''}`} bodyClassName="space-y-4">
      <ErrorNotice message={sources.error} onRetry={sources.reload} />
      {error && <Notice status="danger" title="Belum berhasil">{error}</Notice>}
      {notice && <Notice status="success">{notice}</Notice>}

      {list.length > 0 && (
        <ul className="space-y-3">
          {list.map((source) => {
            const chip = statusChip(source);
            return (
              <li key={source.id} className="rounded-2xl border border-border p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-base font-bold">{source.agent_name}</p>
                    <p className="text-sm text-muted">Sales AutoAudit: {source.sales_name}{source.last_checked_at ? ` · dicek ${dateTime(source.last_checked_at)}` : ''}</p>
                  </div>
                  <Chip color={chip.color} variant="soft" size="md">{chip.label}</Chip>
                </div>
                {source.status === 'failed' && source.last_error && (
                  <p className="mt-2 flex items-start gap-2 text-sm text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{source.last_error}</p>
                )}
                {canManage && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="md" variant="secondary" isPending={busy === `sync-${source.id}`} isDisabled={source.status === 'pulling' || Boolean(busy)} onPress={() => void syncNow(source)}>
                        <RefreshCw className="size-4" aria-hidden="true" />Sinkronkan sekarang
                    </Button>
                    <Button size="md" variant="danger-soft" isDisabled={Boolean(busy)} onPress={() => setRemoving(source)}>
                        <Unlink className="size-4" aria-hidden="true" />Putuskan
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!linked && <Notice status="warning">Company ini tidak lagi dihubungkan ke company AutoAudit, jadi sambungan di atas berhenti menarik data.</Notice>}
      {canManage && linked && (
        <div className="space-y-4 rounded-2xl border border-dashed border-field-border p-3.5 sm:p-4">
          <ErrorNotice message={options.error} onRetry={options.reload} />
          <div className="grid gap-4 md:grid-cols-2">
            <ComboBox value={salesId || null} onChange={(key) => setSalesId(key ? String(key) : '')} aria-label="Sales sumber" menuTrigger="focus" fullWidth>
              <Label className="text-base font-bold">Sales sumber</Label>
              <ComboBox.InputGroup>
                <Input className="h-12 text-base" placeholder="Ketik nama sales atau company" />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox renderEmptyState={() => <p className="p-3 text-base text-muted">Sales tidak ditemukan.</p>}>
                  {available.map((item) => (
                    <ListBox.Item key={item.id} id={String(item.id)} textValue={item.company ? `${item.name} — ${item.company}` : item.name}>
                      {item.name}{item.company ? ` — ${item.company}` : ''}<ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
            <TextField value={agentName} onChange={(value) => { setAgent(value); setAgentTouched(true); }} fullWidth>
              <Label className="text-base font-bold">Nama sumber</Label>
              <Input className="h-12 text-base" placeholder="mis. XM Darmo Caesar" maxLength={100} />
            </TextField>
          </div>
          <p className="text-sm leading-relaxed text-muted">Pakai nama sumber yang sama dengan unggahan sebelumnya supaya pesan lama dikenali dan stok tidak tercatat dua kali.</p>
          <Button size="lg" isPending={busy === 'connect'} isDisabled={!salesId || !agentName.trim() || Boolean(busy)} onPress={() => void connect()}>
            <Link2 className="size-4" aria-hidden="true" />Sambungkan
          </Button>
        </div>
      )}

      <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }} title="Putuskan sambungan?"
        confirmLabel="Putuskan" busy={busy.startsWith('remove-')} onConfirm={() => void disconnect()}>
        Pembaruan otomatis dari {removing?.sales_name} dihentikan. Data yang sudah masuk tetap ada.
      </ConfirmDialog>
    </Panel>
  );
}
