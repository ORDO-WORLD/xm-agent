'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Avatar, Button, ComboBox, Dropdown, Input, Label, ListBox, TextField } from '@heroui/react';
import { CalendarDays, ChevronDown, Clock3, Link2, RefreshCw, TriangleAlert, Unlink } from 'lucide-react';
import { ErrorNotice, Notice, EmptyState } from '@/components/app/primitives';
import { SettingsPagination } from '@/components/settings/settings-pagination';
import { errorMessage } from '@/lib/api';
import { dateTime, initials } from '@/lib/format';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { AutoAuditOptions, AutoAuditSource, AutoAuditSources } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

// After an action, keep refreshing for this many 5-second ticks even if the status has not changed yet.
const WATCH_TICKS = 18;

function statusChip(source: AutoAuditSource) {
  if (source.status === 'failed') return { color: 'danger' as const, label: 'Gagal' };
  if (source.status === 'pulling') return { color: 'warning' as const, label: 'Menarik' };
  if (source.status === 'current') return { color: 'success' as const, label: 'Terbaru' };
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
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const sources = useData((signal) => api.get<AutoAuditSources>('/autoaudit/sources', signal), []);
  const configured = sources.data?.configured ?? false;
  const linked = sources.data?.linked ?? false;
  const options = useData((signal) => api.get<AutoAuditOptions>('/autoaudit/options', signal), [], canManage && configured && linked);
  const list = sources.data?.sources ?? [];
  const page = Math.min(selectedPage, Math.max(1, Math.ceil(list.length / pageSize)));
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
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { await action(); setWatch(WATCH_TICKS); reload(); } catch (reason) { setError(errorMessage(reason, fallback)); } finally { setBusy(''); }
  }

  const connect = () => run('connect', async () => {
    await api.post('/autoaudit/sources', { sales_id: Number(salesId), agent_name: agentName.trim() });
    setSalesId(''); setAgent(''); setAgentTouched(false);
    setNotice('Tersambung. Data awal sedang diambil dan akan muncul di halaman Riwayat.');
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

  if (!sources.data && !sources.error) return <p className="py-4 text-sm text-muted" aria-live="polite">Memuat sambungan AutoAudit...</p>;
  if (!sources.data && sources.error) return <ErrorNotice message={sources.error} onRetry={sources.reload} />;
  if (!configured) return <EmptyState compact title="Sambungan AutoAudit belum tersedia" description={platform ? 'Sambungan AutoAudit belum dikonfigurasi di server.' : 'Hubungi administrator untuk mengaktifkan sambungan AutoAudit.'} />;
  if (!linked && list.length === 0) return <EmptyState compact title="Belum ada sambungan AutoAudit" description={platform ? 'Hubungkan company ini ke company AutoAudit melalui menu Perusahaan.' : 'Company ini belum dihubungkan ke AutoAudit. Hubungi administrator untuk menghubungkannya.'} />;

  return (
    <section className="upload-autoaudit" aria-label="Sambungan AutoAudit">
      <p className="text-sm text-muted">Chat dari sales yang tersambung masuk otomatis setelah sinkronisasi AutoAudit selesai.{sources.data?.autoaudit_company_name ? ` Company AutoAudit: ${sources.data.autoaudit_company_name}.` : ''}</p>
      <ErrorNotice message={sources.error} onRetry={sources.reload} />
      {error && <Notice status="danger" title="Belum berhasil">{error}</Notice>}
      {notice && <Notice status="success">{notice}</Notice>}

      {canManage && linked && (
        <div className="space-y-3 border-b border-separator pb-4">
          <ErrorNotice message={options.error} onRetry={options.reload} />
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <ComboBox className="autoaudit-sales-select" value={salesId || null} onChange={(key) => setSalesId(key ? String(key) : '')} aria-label="Sales sumber" menuTrigger="focus" allowsEmptyCollection
              defaultFilter={(text, search) => text.toLocaleLowerCase('id-ID').includes(search.trim().toLocaleLowerCase('id-ID'))} fullWidth>
              <Label className="text-sm font-normal">Sales sumber</Label>
              <ComboBox.InputGroup>
                <Input className="text-sm" placeholder="Ketik nama sales atau company" />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover className="autoaudit-sales-options">
                <ListBox renderEmptyState={() => <p className="p-3 text-sm text-muted">Sales tidak ditemukan.</p>}>
                  {available.map((item) => (
                    <ListBox.Item key={item.id} id={String(item.id)} textValue={item.company ? `${item.name} — ${item.company}` : item.name}>
                      {item.name}{item.company ? ` — ${item.company}` : ''}<ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
            <TextField value={agentName} onChange={(value) => { setAgent(value); setAgentTouched(true); }} fullWidth>
              <Label className="text-sm font-normal">Nama sumber</Label>
              <Input className="text-sm" placeholder="mis. XM Darmo Caesar" maxLength={100} />
            </TextField>
          <Button className="w-full md:w-auto" isPending={busy === 'connect'} isDisabled={!salesId || !agentName.trim() || Boolean(busy)} onPress={() => void connect()}>
            <Link2 className="size-4" aria-hidden="true" />Sambungkan
          </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted">Pakai nama sumber yang sama dengan unggahan sebelumnya supaya pesan lama dikenali dan stok tidak tercatat dua kali.</p>

        </div>
      )}

      {list.length === 0 && <EmptyState compact title="Belum ada sambungan AutoAudit" description={canManage ? 'Pilih sales sumber di atas untuk mulai menerima chat secara otomatis.' : 'Super admin company dapat menyambungkan sales AutoAudit.'} />}
      {list.length > 0 && <div className="team-data">
        <div className="team-cards-panel"><ul className="team-member-grid">
          {list.slice((page - 1) * pageSize, page * pageSize).map((source) => {
            const status = statusChip(source);
            return <li key={source.id} className="team-member-card autoaudit-source-card">
              <div className="team-card-heading">
                <Avatar size="sm" color="accent" className="team-member-avatar"><Avatar.Fallback>{initials(source.agent_name)}</Avatar.Fallback></Avatar>
                <div className="min-w-0 flex-1"><div className="team-member-name"><h2 className="text-base font-semibold" title={source.agent_name}>{source.agent_name}</h2></div><p className="team-member-email" title={source.sales_name}>Sales AutoAudit: {source.sales_name}</p></div>
                {canManage && <Dropdown><Dropdown.Trigger className="team-card-action" aria-label={`Aksi ${source.agent_name}`} isDisabled={Boolean(busy)}><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger>
                  <Dropdown.Popover placement="bottom end" className="sales-action-menu"><Dropdown.Menu aria-label={`Aksi sambungan ${source.agent_name}`} onAction={(key) => { if (busy) return; if (key === 'sync') void syncNow(source); else if (key === 'disconnect') { setError(''); setRemoving(source); } }}>
                    <Dropdown.Item id="sync" textValue="Sinkronkan sekarang" isDisabled={source.status === 'pulling' || Boolean(busy)}><RefreshCw className="size-4" /><Label>Sinkronkan sekarang</Label></Dropdown.Item>
                    <Dropdown.Item id="disconnect" textValue="Putuskan" variant="danger" isDisabled={Boolean(busy)}><Unlink className="size-4" /><Label>Putuskan</Label></Dropdown.Item>
                  </Dropdown.Menu></Dropdown.Popover>
                </Dropdown>}
              </div>
              <div className="team-card-status" data-state={source.status} data-locked={source.status === 'failed'}><span className="team-status-dot" aria-hidden="true" /><span>{busy === `sync-${source.id}` ? 'Meminta sinkronisasi...' : status.label}</span></div>
              <dl className="team-card-meta">
                <div><dt><Clock3 className="team-meta-icon" aria-hidden="true" /><span>Terakhir diperiksa</span></dt><dd>{source.last_checked_at ? dateTime(source.last_checked_at) : 'Belum diperiksa'}</dd></div>
                <div><dt><CalendarDays className="team-meta-icon" aria-hidden="true" /><span>Data terbaru</span></dt><dd>{source.dataset_updated_at ? dateTime(source.dataset_updated_at) : 'Belum ada data'}</dd></div>
              </dl>
              {source.status === 'failed' && source.last_error && <p className="mx-4 mb-4 flex items-start gap-2 text-xs text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{source.last_error}</p>}
            </li>;
          })}
        </ul></div>
        <SettingsPagination total={list.length} label="sambungan" page={page} pageSize={pageSize} onPage={setSelectedPage} onPageSize={(size) => { setPageSize(size); setSelectedPage(1); }} />
      </div>}


      {!linked && <Notice status="warning">Company ini tidak lagi dihubungkan ke company AutoAudit, jadi sambungan di atas berhenti menarik data.</Notice>}


      <AlertDialog.Backdrop isOpen={Boolean(removing)} isDismissable={!busy} isKeyboardDismissDisabled={Boolean(busy)} onOpenChange={(open) => { if (!open && !busy) setRemoving(null); }} className="company-logout-backdrop">
        <AlertDialog.Container placement="center" className="company-logout-container">
          <AlertDialog.Dialog className="company-logout-dialog">
            <div className="company-logout-intro">
              <AlertDialog.Header className="company-logout-heading">
                <div className="company-logout-icon"><Unlink className="size-7" aria-hidden="true" /></div>
                <AlertDialog.Heading>Putuskan sambungan?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="company-logout-message">Pembaruan otomatis dari {removing?.sales_name} akan dihentikan. Data yang sudah masuk tetap ada.</AlertDialog.Body>
              {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
            </div>
            <AlertDialog.Footer className="company-logout-actions">
              <Button variant="secondary" className="company-logout-cancel" isDisabled={Boolean(busy)} onPress={() => setRemoving(null)}>Batal</Button>
              <Button variant="danger" className="company-logout-confirm" isPending={busy.startsWith('remove-')} isDisabled={Boolean(busy) && !busy.startsWith('remove-')} onPress={() => void disconnect()}>Ya, Putuskan</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
}
