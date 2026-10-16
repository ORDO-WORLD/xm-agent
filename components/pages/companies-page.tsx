'use client';

import { useState } from 'react';
import { Button, ComboBox, Description, Dropdown, Input, Label, ListBox, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { Building2, CalendarDays, Copy, ChevronDown, Eye, EyeOff, LogIn, Mail, Pencil, Plus, ScrollText, Search, UserRound, UsersRound, Wand2, X } from 'lucide-react';
import { DeployPanel } from '@/components/app/deploy-panel';
import { EmptyState, ErrorNotice, LoadingRows, Notice } from '@/components/app/primitives';
import { generatePassword } from '@/components/pages/team-page';
import { SettingsPagination } from '@/components/settings/settings-pagination';
import { SettingsNote } from '@/components/settings/settings-section';
import { errorMessage } from '@/lib/api';
import { dateOnly, initials, number } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useManage } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { AutoAuditCompany, CompanySummary } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

/** Platform administrator only: every company, its super admin, and a way to step inside. */
export default function CompaniesPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { enter } = useManage();
  const [tick, setTick] = useState(0);
  const create = useOverlayState();
  const rename = useOverlayState();
  const [renaming, setRenaming] = useState<CompanySummary | null>(null);
  const companies = useData((signal) => api.get<CompanySummary[]>('/admin/companies', signal), [tick]);
  // Empty when AutoAudit is not configured or cannot be reached; the link field is then simply not offered.
  const autoaudit = useData((signal) => api.get<AutoAuditCompany[]>('/admin/autoaudit/companies', signal).catch(() => [] as AutoAuditCompany[]), []);
  const sources = autoaudit.data ?? [];
  const reload = () => setTick((value) => value + 1);

  const [search, setSearch] = useState('');
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<CompanySummary | null>(null);
  const query = search.trim().toLocaleLowerCase('id-ID');
  const filtered = (companies.data ?? []).filter((company) => [company.name, company.autoaudit_company_name, ...company.users.flatMap((user) => [user.display_name, user.email])].join(' ').toLocaleLowerCase('id-ID').includes(query));
  const page = Math.min(paging.query === query ? paging.page : 1, Math.max(1, Math.ceil(filtered.length / pageSize)));
  return <div className="general-settings companies-page">
    <header className="companies-toolbar">
      <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari perusahaan" placeholder="Cari perusahaan, nama admin, atau email…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Hapus pencarian" onClick={() => setSearch('')}><X className="size-4" /></button>}</div>
      <Button onPress={() => create.open()}><Plus className="size-4" aria-hidden="true" />Tambah perusahaan</Button>
    </header>
    <ErrorNotice message={companies.error} onRetry={companies.reload} />
    {companies.loading && !companies.data && <LoadingRows rows={3} />}
    {companies.data && <div className="companies-data">
      <div className="companies-list">{!companies.data.length ? <EmptyState title="Belum ada perusahaan" description="Tambahkan perusahaan untuk mulai mengelola data dan akunnya." /> : !filtered.length ? <EmptyState compact title="Perusahaan tidak ditemukan" description="Coba nama perusahaan, admin, atau email lainnya." /> : <ul>{filtered.slice((page - 1) * pageSize, page * pageSize).map((company) => {
        const admin = company.users.find((user) => user.role === 'company_admin') ?? company.users[0];
        return <li key={company.company_id} className="company-summary-card">
          <div className="company-summary-logo"><span aria-label={`Inisial ${company.name}`}>{initials(company.name)}</span><span className="company-source-badge" data-autoaudit={company.source === 'autoaudit'}>{company.source === 'autoaudit' ? 'AutoAudit' : 'Lokal'}</span></div>
          <div className="company-summary-identity"><h2 title={company.name}>{company.name}</h2><div className="company-summary-contact"><div className="company-summary-admin"><UsersRound size={14} aria-hidden="true" /><span title={admin?.display_name}>{admin?.display_name ?? 'Belum ada akun'}</span></div><div className="company-summary-admin"><Mail size={14} aria-hidden="true" /><span title={admin?.email}>{admin?.email ?? '—'}</span></div></div><div className="company-summary-setting"><span className="company-keyword-setting"><strong>Kata kunci:</strong><span>{company.search_locked ? 'Dikunci' : 'Tidak dikunci'}</span></span><span className="company-setting-separator" aria-hidden="true">·</span><div className="company-summary-integration"><strong>Integrasi AutoAudit:</strong><span title={company.autoaudit_company_name ?? undefined}>{company.autoaudit_company_name ?? 'Belum dihubungkan'}</span></div></div></div>
          <dl className="company-summary-stats"><div><dt><UsersRound className="company-stat-icon" aria-hidden="true" /><span>Buyer</span></dt><dd>{number(company.buyers)}</dd></div><div><dt><Building2 className="company-stat-icon" aria-hidden="true" /><span>Listing</span></dt><dd>{number(company.listings)}</dd></div><div><dt><UserRound className="company-stat-icon" aria-hidden="true" /><span>Akun</span></dt><dd>{number(company.users.length)}</dd></div></dl>
          <div className="company-summary-controls"><div className="company-summary-buttons"><Button isDisabled={!company.owner_id} onPress={() => company.owner_id && enter({ userId: company.owner_id, name: company.name })}><LogIn className="size-4" aria-hidden="true" />Login</Button><Button variant="secondary" onPress={() => setDetail(company)}><Eye className="size-4" aria-hidden="true" />Detail akun</Button></div><Dropdown><Dropdown.Trigger className="company-summary-action">Aksi<ChevronDown size={14} aria-hidden="true" /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="sales-action-menu company-summary-menu"><Dropdown.Menu aria-label={`Aksi ${company.name}`} onAction={(key) => { if (key === 'edit') { setRenaming(company); rename.open(); } else if (key === 'activity') navigate?.('aktivitas', { company: company.company_id }); }}><Dropdown.Item id="edit" textValue="Edit perusahaan"><Pencil size={14} /><Label>Edit perusahaan</Label></Dropdown.Item><Dropdown.Item id="activity" textValue="Lihat aktivitas"><ScrollText size={14} /><Label>Lihat aktivitas</Label></Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown></div>
        </li>;
      })}</ul>}</div>
      {!!filtered.length && <SettingsPagination total={filtered.length} label="perusahaan" page={page} pageSize={pageSize} onPage={(next) => setPaging({ query, page: next })} onPageSize={(size) => { setPageSize(size); setPaging({ query, page: 1 }); }} />}
    </div>}
    <DeployPanel />
    <CreateCompany state={create} sources={sources} onDone={reload} />
    <RenameCompany state={rename} company={renaming} sources={sources} onDone={reload} />
    <Modal.Backdrop isOpen={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>Detail {detail?.name}</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body">{detail && (detail.users.length ? <ul className="company-detail-users">{detail.users.map((account) => <li key={account.id}><div className="company-detail-account-heading"><strong>{account.display_name}</strong><span className="company-detail-status" data-locked={account.is_locked}>{account.is_locked ? 'Terkunci' : 'Aktif'}</span></div><div className="company-detail-account-info"><span><Mail size={14} aria-hidden="true" />{account.email}</span><span><UserRound size={14} aria-hidden="true" />{account.role === 'admin' ? 'Administrator platform' : account.role === 'company_admin' ? 'Super admin' : 'Anggota'}</span></div><p className="company-detail-joined"><CalendarDays size={14} aria-hidden="true" />Bergabung {dateOnly(account.created_at)}</p></li>)}</ul> : <EmptyState compact title="Belum ada akun" />)}</Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </div>;
}

const NONE = 'none';

/** Which AutoAudit company a company may pull sales from. Leaving it empty means manual uploads only. */
function AutoAuditPicker({ sources, value, onChange }: { sources: AutoAuditCompany[]; value: number | null; onChange: (value: number | null) => void }) {
  if (sources.length === 0) return null;
  return (
    <ComboBox value={value === null ? NONE : String(value)} onChange={(key) => onChange(!key || key === NONE ? null : Number(key))} aria-label="Company AutoAudit" menuTrigger="focus" fullWidth>
      <Label className="text-sm font-medium">Perusahaan AutoAudit (opsional)</Label>
      <ComboBox.InputGroup><Input className="text-sm" placeholder="Ketik nama company" /><ComboBox.Trigger /></ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox renderEmptyState={() => <p className="p-3 text-base text-muted">Company tidak ditemukan.</p>}>
          <ListBox.Item id={NONE} textValue="Tidak dihubungkan">Tidak dihubungkan<ListBox.ItemIndicator /></ListBox.Item>
          {sources.map((item) => <ListBox.Item key={item.id} id={String(item.id)} textValue={item.name}>{item.name}<ListBox.ItemIndicator /></ListBox.Item>)}
        </ListBox>
      </ComboBox.Popover>
      <Description className="text-sm">Sales yang bisa disambungkan hanya dari company ini. Tanpa pilihan, company hanya bisa unggah manual.</Description>
    </ComboBox>
  );
}

function CreateCompany({ state, sources, onDone }: { state: ReturnType<typeof useOverlayState>; sources: AutoAuditCompany[]; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [autoaudit, setAutoaudit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<{name: string; email: string; password: string} | null>(null);
  async function save() {
    setBusy(true); setError('');
    try {
      const created = await api.post<CompanySummary>('/admin/companies', { name: name.trim(), admin_name: adminName.trim(), admin_email: email.trim(), password });
      setCredentials({ name: name.trim(), email: email.trim(), password });
      toast.success('Perusahaan berhasil dibuat');
      // The company exists either way; a failed link is reported without losing the new account's password.
      if (autoaudit !== null) {
        await api.put(`/admin/autoaudit/link/${created.company_id}`, { autoaudit_company_id: autoaudit })
          .catch(() => toast.danger('Company dibuat, tetapi belum terhubung ke AutoAudit. Atur lewat ikon pensil.'));
      }
      setName(''); setAdminName(''); setEmail(''); setPassword(generatePassword()); setShowPassword(false); setAutoaudit(null);
      state.close(); onDone();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return (<>
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => { if (!busy) state.setOpen(open); }}>
      <Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog">
        <Modal.CloseTrigger />
        <Modal.Header><Modal.Heading>Tambah perusahaan</Modal.Heading></Modal.Header>
        <Modal.Body className="sales-dialog-body space-y-4">
          <SettingsNote>Company baru mulai kosong dan terpisah dari yang lain. Akun pertama otomatis menjadi super admin company itu.</SettingsNote>
          <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-sm font-medium">Nama perusahaan</Label><Input className="text-sm" placeholder="mis. Property Citraland" maxLength={120} /></TextField>
          <TextField value={adminName} onChange={setAdminName} isRequired fullWidth><Label className="text-sm font-medium">Nama super admin</Label><Input className="text-sm" maxLength={100} /></TextField>
          <TextField value={email} onChange={setEmail} isRequired type="email" fullWidth><Label className="text-sm font-medium">Email super admin</Label><Input className="text-sm" autoComplete="off" /></TextField>
          <TextField value={password} onChange={setPassword} isRequired fullWidth>
            <Label className="text-sm font-medium">Password awal</Label>
            <div className="relative company-password-field"><Input type={showPassword ? 'text' : 'password'} className="pr-20 text-sm" autoComplete="new-password" /><button type="button" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShowPassword((shown) => !shown)} className="company-password-eye">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              <button type="button" aria-label="Buat password otomatis" onClick={() => setPassword(generatePassword())} className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-accent hover:bg-default"><Wand2 className="size-5" /></button></div>
            <Description className="text-sm">Minimal 8 karakter. Salin dan berikan kepada super admin.</Description>
          </TextField>
          <AutoAuditPicker sources={sources} value={autoaudit} onChange={setAutoaudit} />
          {error && <Notice status="danger">{error}</Notice>}
        </Modal.Body>
        <Modal.Footer><Button slot="close" variant="secondary" size="md" isDisabled={busy}>Batal</Button><Button size="md" isPending={busy} isDisabled={!name.trim() || !adminName.trim() || !/.+@.+\..+/.test(email) || password.length < 8} onPress={save}>Buat perusahaan</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    {credentials && <CompanyCredentials info={credentials} onClose={() => setCredentials(null)} />}
  </>);
}

function RenameCompany({ state, company, sources, onDone }: { state: ReturnType<typeof useOverlayState>; company: CompanySummary | null; sources: AutoAuditCompany[]; onDone: () => void }) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container placement="center" size="md" scroll="inside">
        <Modal.Dialog className="general-settings sales-edit-dialog">{company && <RenameForm key={company.company_id} company={company} sources={sources} onClose={() => state.close()} onDone={onDone} />}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function RenameForm({ company, sources, onClose, onDone }: { company: CompanySummary; sources: AutoAuditCompany[]; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState(company.name);
  const [autoaudit, setAutoaudit] = useState<number | null>(company.autoaudit_company_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      if (name.trim() !== company.name) await api.put(`/admin/companies/${company.company_id}`, { name: name.trim() });
      if (autoaudit !== company.autoaudit_company_id) await api.put(`/admin/autoaudit/link/${company.company_id}`, { autoaudit_company_id: autoaudit });
      toast.success('Perusahaan diperbarui'); onClose(); onDone();
    }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>Edit perusahaan</Modal.Heading></Modal.Header>
      <Modal.Body className="sales-dialog-body space-y-3">
        <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-sm font-medium">Nama perusahaan</Label><Input className="text-sm" maxLength={120} /></TextField>
        <AutoAuditPicker sources={sources} value={autoaudit} onChange={setAutoaudit} />
        {error && <Notice status="danger">{error}</Notice>}
      </Modal.Body>
      <Modal.Footer><Button slot="close" variant="secondary" size="md" isDisabled={busy}>Batal</Button><Button size="md" isPending={busy} isDisabled={!name.trim()} onPress={save}>Simpan</Button></Modal.Footer>
    </>
  );
}

function CompanyCredentials({ info, onClose }: { info: {name: string; email: string; password: string}; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(`Perusahaan: ${info.name}\nEmail: ${info.email}\nPassword: ${info.password}`); toast.success('Informasi masuk disalin'); }
    catch { toast.danger('Gagal menyalin informasi masuk'); }
  }
  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>Perusahaan berhasil dibuat</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body space-y-3"><p className="text-sm">Simpan informasi masuk untuk super admin {info.name}. Password ini hanya ditampilkan sekali setelah pembuatan akun.</p><TextField value={info.email} isReadOnly fullWidth><Label>Email</Label><Input /></TextField><TextField value={info.password} isReadOnly fullWidth><Label>Password awal</Label><div className="team-password-input"><Input type={visible ? 'text' : 'password'} /><div className="team-password-actions"><button type="button" aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setVisible((shown) => !shown)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div></TextField></Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => { void copy(); }}><Copy size={16} />Salin informasi</Button><Button onPress={onClose}>Selesai</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
