'use client';

import { useState } from 'react';
import { Button, Chip, ComboBox, Description, Input, Label, ListBox, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { Building2, Link2, LogIn, Pencil, Plus, ScrollText, UsersRound, Wand2 } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, Notice, PageHeader, Panel } from '@/components/app/primitives';
import { generatePassword } from '@/components/pages/team-page';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
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

  return (
    <div className="space-y-6">
      <PageHeader title="Perusahaan" description="Setiap company punya data sendiri yang terpisah, dan satu atau lebih akun. Masuk ke sebuah company untuk mengelola data, tim, dan pengaturannya."
        actions={<ShimmerButton onClick={() => create.open()} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-12 px-5 font-semibold"><Plus className="mr-2 size-5" aria-hidden="true" />Tambah company</ShimmerButton>} />
      <ErrorNotice message={companies.error} onRetry={companies.reload} />
      {companies.loading && !companies.data && <LoadingRows rows={3} />}
      {companies.data && companies.data.length === 0 && <div className="xm-card"><EmptyState title="Belum ada company" /></div>}
      <ul className="grid gap-4 lg:grid-cols-2">
        {companies.data?.map((company) => {
          const admin = company.users.find((user) => user.role === 'company_admin') ?? company.users[0];
          return (
            <li key={company.company_id}>
              <Panel className="h-full" title={<span className="flex items-center gap-2"><Building2 className="size-5 text-accent" aria-hidden="true" />{company.name}</span>}
                action={<Button isIconOnly variant="tertiary" aria-label={`Ubah ${company.name}`} onPress={() => { setRenaming(company); rename.open(); }}><Pencil className="size-4" /></Button>}>
                <div className="flex flex-wrap gap-2">
                  <Chip variant="soft" size="md">{number(company.buyers)} buyer</Chip>
                  <Chip variant="soft" size="md">{number(company.listings)} listing</Chip>
                  <Chip variant="soft" size="md"><UsersRound className="mr-1 size-3.5" aria-hidden="true" />{company.users.length} akun</Chip>
                  {company.search_locked && <Chip variant="soft" color="warning" size="md">Kata kunci dikunci</Chip>}
                  {company.autoaudit_company_name && <Chip variant="soft" color="accent" size="md"><Link2 className="mr-1 size-3.5" aria-hidden="true" />AutoAudit: {company.autoaudit_company_name}</Chip>}
                </div>
                <ul className="mt-3 space-y-1.5 text-base">
                  {company.users.slice(0, 4).map((user) => <li key={user.id} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{user.display_name}</span><span className="break-all text-muted">{user.email}</span>{user.role !== 'user' && <Chip size="sm" variant="soft" color="accent">{user.role === 'admin' ? 'Admin platform' : 'Super admin'}</Chip>}{user.is_locked && <Chip size="sm" variant="soft" color="danger">Terkunci</Chip>}</li>)}
                  {company.users.length > 4 && <li className="text-sm text-muted">+{company.users.length - 4} akun lain</li>}
                </ul>
                <Button className="mt-4" fullWidth size="lg" isDisabled={!company.owner_id} onPress={() => company.owner_id && enter({ userId: company.owner_id, name: company.name })}>
                  <LogIn className="size-4" aria-hidden="true" />Masuk &amp; kelola{admin ? ` (${admin.display_name})` : ''}
                </Button>
                <Button className="mt-2" fullWidth size="lg" variant="tertiary" onPress={() => navigate?.('aktivitas', { company: company.company_id })}>
                  <ScrollText className="size-4" aria-hidden="true" />Lihat aktivitas
                </Button>
              </Panel>
            </li>
          );
        })}
      </ul>
      <CreateCompany state={create} sources={sources} onDone={reload} />
      <RenameCompany state={rename} company={renaming} sources={sources} onDone={reload} />
    </div>
  );
}

const NONE = 'none';

/** Which AutoAudit company a company may pull sales from. Leaving it empty means manual uploads only. */
function AutoAuditPicker({ sources, value, onChange }: { sources: AutoAuditCompany[]; value: number | null; onChange: (value: number | null) => void }) {
  if (sources.length === 0) return null;
  return (
    <ComboBox value={value === null ? NONE : String(value)} onChange={(key) => onChange(!key || key === NONE ? null : Number(key))} aria-label="Company AutoAudit" menuTrigger="focus" fullWidth>
      <Label className="text-base font-bold">Company AutoAudit (opsional)</Label>
      <ComboBox.InputGroup><Input className="h-12 text-base" placeholder="Ketik nama company" /><ComboBox.Trigger /></ComboBox.InputGroup>
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
  const [autoaudit, setAutoaudit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      const created = await api.post<CompanySummary>('/admin/companies', { name: name.trim(), admin_name: adminName.trim(), admin_email: email.trim(), password });
      toast.success(`Company ${name} dibuat. Catat password: ${password}`, { timeout: 15000 });
      // The company exists either way; a failed link is reported without losing the new account's password.
      if (autoaudit !== null) {
        await api.put(`/admin/autoaudit/link/${created.company_id}`, { autoaudit_company_id: autoaudit })
          .catch(() => toast.danger('Company dibuat, tetapi belum terhubung ke AutoAudit. Atur lewat ikon pensil.'));
      }
      setName(''); setAdminName(''); setEmail(''); setPassword(generatePassword()); setAutoaudit(null);
      state.close(); onDone();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container size="md" scroll="inside"><Modal.Dialog>
        <Modal.CloseTrigger />
        <Modal.Header><Modal.Heading>Tambah company baru</Modal.Heading></Modal.Header>
        <Modal.Body className="space-y-4">
          <Notice status="accent">Company baru mulai kosong dan terpisah dari yang lain. Akun pertama otomatis menjadi super admin company itu.</Notice>
          <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-base font-bold">Nama company</Label><Input className="h-12 text-base" placeholder="mis. Property Citraland" maxLength={120} /></TextField>
          <TextField value={adminName} onChange={setAdminName} isRequired fullWidth><Label className="text-base font-bold">Nama super admin</Label><Input className="h-12 text-base" maxLength={100} /></TextField>
          <TextField value={email} onChange={setEmail} isRequired type="email" fullWidth><Label className="text-base font-bold">Email super admin</Label><Input className="h-12 text-base" autoComplete="off" /></TextField>
          <TextField value={password} onChange={setPassword} isRequired fullWidth>
            <Label className="text-base font-bold">Password awal</Label>
            <div className="relative"><Input className="h-12 pr-12 font-mono text-base" autoComplete="new-password" />
              <button type="button" aria-label="Buat password otomatis" onClick={() => setPassword(generatePassword())} className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-accent hover:bg-default"><Wand2 className="size-5" /></button></div>
            <Description className="text-sm">Minimal 8 karakter. Salin dan berikan kepada super admin.</Description>
          </TextField>
          <AutoAuditPicker sources={sources} value={autoaudit} onChange={setAutoaudit} />
          {error && <Notice status="danger">{error}</Notice>}
        </Modal.Body>
        <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" isPending={busy} isDisabled={!name.trim() || !adminName.trim() || !/.+@.+\..+/.test(email) || password.length < 8} onPress={save}>Buat company</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  );
}

function RenameCompany({ state, company, sources, onDone }: { state: ReturnType<typeof useOverlayState>; company: CompanySummary | null; sources: AutoAuditCompany[]; onDone: () => void }) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container size="sm">
        <Modal.Dialog>{company && <RenameForm key={company.company_id} company={company} sources={sources} onClose={() => state.close()} onDone={onDone} />}</Modal.Dialog>
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
      toast.success('Company diperbarui'); onClose(); onDone();
    }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>Ubah company</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-3">
        <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-base font-bold">Nama company</Label><Input className="h-12 text-base" maxLength={120} /></TextField>
        <AutoAuditPicker sources={sources} value={autoaudit} onChange={setAutoaudit} />
        {error && <Notice status="danger">{error}</Notice>}
      </Modal.Body>
      <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" isPending={busy} isDisabled={!name.trim()} onPress={save}>Simpan</Button></Modal.Footer>
    </>
  );
}
