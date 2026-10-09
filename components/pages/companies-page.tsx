'use client';

import { useState } from 'react';
import { Button, Chip, Description, Input, Label, Modal, TextField, toast, useOverlayState } from '@heroui/react';
import { Building2, LogIn, Pencil, Plus, UsersRound, Wand2 } from 'lucide-react';
import { DeployPanel } from '@/components/app/deploy-panel';
import { EmptyState, ErrorNotice, LoadingRows, Notice, PageHeader, Panel } from '@/components/app/primitives';
import { generatePassword } from '@/components/pages/team-page';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { useManage } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { CompanySummary } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

/** Platform administrator only: every company, its super admin, and a way to step inside. */
export default function CompaniesPage() {
  const api = useApi();
  const { enter } = useManage();
  const [tick, setTick] = useState(0);
  const create = useOverlayState();
  const rename = useOverlayState();
  const [renaming, setRenaming] = useState<CompanySummary | null>(null);
  const companies = useData((signal) => api.get<CompanySummary[]>('/admin/companies', signal), [tick]);
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
                action={<Button isIconOnly variant="tertiary" aria-label={`Ubah nama ${company.name}`} onPress={() => { setRenaming(company); rename.open(); }}><Pencil className="size-4" /></Button>}>
                <div className="flex flex-wrap gap-2">
                  <Chip variant="soft" size="md">{number(company.buyers)} buyer</Chip>
                  <Chip variant="soft" size="md">{number(company.listings)} listing</Chip>
                  <Chip variant="soft" size="md"><UsersRound className="mr-1 size-3.5" aria-hidden="true" />{company.users.length} akun</Chip>
                  {company.search_locked && <Chip variant="soft" color="warning" size="md">Kata kunci dikunci</Chip>}
                </div>
                <ul className="mt-3 space-y-1.5 text-base">
                  {company.users.slice(0, 4).map((user) => <li key={user.id} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{user.display_name}</span><span className="break-all text-muted">{user.email}</span>{user.role !== 'user' && <Chip size="sm" variant="soft" color="accent">{user.role === 'admin' ? 'Admin platform' : 'Super admin'}</Chip>}{user.is_locked && <Chip size="sm" variant="soft" color="danger">Terkunci</Chip>}</li>)}
                  {company.users.length > 4 && <li className="text-sm text-muted">+{company.users.length - 4} akun lain</li>}
                </ul>
                <Button className="mt-4" fullWidth size="lg" isDisabled={!company.owner_id} onPress={() => company.owner_id && enter({ userId: company.owner_id, name: company.name })}>
                  <LogIn className="size-4" aria-hidden="true" />Masuk &amp; kelola{admin ? ` (${admin.display_name})` : ''}
                </Button>
              </Panel>
            </li>
          );
        })}
      </ul>
      <DeployPanel />
      <CreateCompany state={create} onDone={reload} />
      <RenameCompany state={rename} company={renaming} onDone={reload} />
    </div>
  );
}

function CreateCompany({ state, onDone }: { state: ReturnType<typeof useOverlayState>; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/admin/companies', { name: name.trim(), admin_name: adminName.trim(), admin_email: email.trim(), password });
      toast.success(`Company ${name} dibuat. Catat password: ${password}`, { timeout: 15000 });
      setName(''); setAdminName(''); setEmail(''); setPassword(generatePassword());
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
          {error && <Notice status="danger">{error}</Notice>}
        </Modal.Body>
        <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" isPending={busy} isDisabled={!name.trim() || !adminName.trim() || !/.+@.+\..+/.test(email) || password.length < 8} onPress={save}>Buat company</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  );
}

function RenameCompany({ state, company, onDone }: { state: ReturnType<typeof useOverlayState>; company: CompanySummary | null; onDone: () => void }) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container size="sm">
        <Modal.Dialog>{company && <RenameForm company={company} onClose={() => state.close()} onDone={onDone} />}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function RenameForm({ company, onClose, onDone }: { company: CompanySummary; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState(company.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await api.put(`/admin/companies/${company.company_id}`, { name: name.trim() }); toast.success('Nama company diubah'); onClose(); onDone(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>Ubah nama company</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-3">
        <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-base font-bold">Nama company</Label><Input className="h-12 text-base" maxLength={120} /></TextField>
        {error && <Notice status="danger">{error}</Notice>}
      </Modal.Body>
      <Modal.Footer><Button slot="close" variant="tertiary" size="lg">Batal</Button><Button size="lg" isPending={busy} isDisabled={!name.trim()} onPress={save}>Simpan</Button></Modal.Footer>
    </>
  );
}
