'use client';

import { useState } from 'react';
import { Avatar, Button, Chip, Description, Input, Label, ListBox, Modal, Select, Switch, TextField, toast, useOverlayState } from '@heroui/react';
import { Copy, Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, ShieldCheck, UserRound, Wand2 } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows, Notice, PageHeader, Panel } from '@/components/app/primitives';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { errorMessage } from '@/lib/api';
import { dateOnly, initials } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { Role, TeamMember } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const ROLE_NAME: Record<Role, string> = { admin: 'Administrator platform', company_admin: 'Super admin', user: 'Anggota' };

/** A password people can read out and type: no look-alike characters. */
export function generatePassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export default function TeamPage() {
  const api = useApi();
  const { user } = useSession();
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);
  const form = useOverlayState();
  const members = useData((signal) => api.get<TeamMember[]>('/team/users', signal), [tick]);
  const reload = () => setTick((value) => value + 1);
  const platform = user.role === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader title="Tim & Akses" description="Tambahkan akun untuk anggota tim Anda. Semua akun di company ini memakai data yang sama."
        actions={<ShimmerButton onClick={() => { setEditing(null); form.open(); }} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-12 px-5 font-semibold"><Plus className="mr-2 size-5" aria-hidden="true" />Tambah anggota</ShimmerButton>} />

      {created && (
        <Notice status="success" title={`Akun ${created.name} sudah dibuat`}
          action={<Button size="sm" variant="secondary" onPress={() => { void navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`).then(() => toast.success('Info login disalin')); }}><Copy className="size-4" aria-hidden="true" />Salin info login</Button>}>
          Bagikan email <strong>{created.email}</strong> dan password <strong className="font-mono">{created.password}</strong> kepada yang bersangkutan. Password ini tidak ditampilkan lagi setelah Anda menutup pesan ini.
        </Notice>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-accent" aria-hidden="true" />Super admin</span>}>
          <ul className="list-disc space-y-1 pl-5 text-base leading-relaxed"><li>Menambah dan mengunci akun anggota</li><li>Mengunggah data chat</li><li>Mengatur kata kunci (dan mengunci kata kunci), pengelompokan, nomor sales</li><li>Mengatur toleransi, bobot, glosarium, lokasi</li></ul>
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><UserRound className="size-5 text-accent" aria-hidden="true" />Anggota</span>}>
          <ul className="list-disc space-y-1 pl-5 text-base leading-relaxed"><li>Mencocokkan buyer dan listing, mengunduh PDF</li><li>Menandai Ready / On-hold / Sold / Hapus</li><li>Melihat Beranda, Match Terbaru, dan Stok Sales</li><li>Mengubah kata kunci sendiri, bila tidak dikunci</li></ul>
        </Panel>
      </div>

      <ErrorNotice message={members.error} onRetry={members.reload} />
      {members.loading && !members.data && <LoadingRows rows={3} />}
      {members.data && members.data.length === 0 && <div className="xm-card"><EmptyState title="Belum ada akun" /></div>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {members.data?.map((member) => (
          <li key={member.id} className="xm-card flex items-start gap-3.5 p-4">
            <Avatar color={member.is_locked ? 'danger' : 'accent'} size="lg"><Avatar.Fallback>{member.is_locked ? <LockKeyhole className="size-5" /> : initials(member.display_name)}</Avatar.Fallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words text-lg font-bold">{member.display_name}</p>
                {member.is_self && <Chip size="sm" variant="soft" color="accent">Anda</Chip>}
              </div>
              <p className="break-all text-base text-muted">{member.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip size="md" variant="soft" color={member.role === 'user' ? 'default' : 'accent'}>{ROLE_NAME[member.role]}</Chip>
                <Chip size="md" variant="soft" color={member.is_locked ? 'danger' : 'success'}>{member.is_locked ? 'Terkunci' : 'Aktif'}</Chip>
                <span className="text-sm text-muted">sejak {dateOnly(member.created_at)}</span>
              </div>
            </div>
            {member.editable && <Button variant="secondary" onPress={() => { setEditing(member); form.open(); }}><Pencil className="size-4" aria-hidden="true" />Kelola</Button>}
          </li>
        ))}
      </ul>

      <MemberDialog state={form} member={editing} platform={platform} onDone={(info) => { if (info) setCreated(info); reload(); }} />
    </div>
  );
}

type CreatedInfo = { email: string; password: string; name: string };

function MemberDialog({ state, member, platform, onDone }: {
  state: ReturnType<typeof useOverlayState>; member: TeamMember | null; platform: boolean; onDone: (created?: CreatedInfo) => void;
}) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container size="md" scroll="inside">
        {/* Mounted per opening: the form starts from the chosen account (or empty) without any syncing effect. */}
        <Modal.Dialog><MemberForm member={member} platform={platform} onClose={() => state.close()} onDone={onDone} /></Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function MemberForm({ member, platform, onClose, onDone }: { member: TeamMember | null; platform: boolean; onClose: () => void; onDone: (created?: CreatedInfo) => void }) {
  const api = useApi();
  const [name, setName] = useState(member?.display_name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState(() => (member ? '' : generatePassword()));
  const [role, setRole] = useState<'user' | 'company_admin'>(member?.role === 'company_admin' ? 'company_admin' : 'user');
  const [locked, setLocked] = useState(member?.is_locked ?? false);
  const [show, setShow] = useState(!member);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    try {
      if (member) {
        await api.put(`/team/users/${member.id}`, { email: email.trim(), display_name: name.trim(), password: password || undefined, is_locked: locked, ...(platform ? { role } : {}) });
        toast.success(locked && !member.is_locked ? `${name} dikunci` : 'Perubahan tersimpan');
        onDone();
      } else {
        await api.post('/team/users', { email: email.trim(), display_name: name.trim(), password, ...(platform ? { role } : {}) });
        onDone({ email: email.trim(), password, name: name.trim() });
      }
      onClose();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  const valid = name.trim() && /.+@.+\..+/.test(email) && (member ? !password || password.length >= 8 : password.length >= 8);
  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>{member ? `Kelola ${member.display_name}` : 'Tambah anggota tim'}</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-4">
        <TextField value={name} onChange={setName} isRequired fullWidth><Label className="text-base font-bold">Nama</Label><Input className="h-12 text-base" placeholder="mis. Rina Marketing" maxLength={100} /></TextField>
        <TextField value={email} onChange={setEmail} isRequired type="email" fullWidth><Label className="text-base font-bold">Email (untuk masuk)</Label><Input className="h-12 text-base" placeholder="nama@perusahaan.com" autoComplete="off" /></TextField>
        <TextField value={password} onChange={setPassword} isRequired={!member} type={show ? 'text' : 'password'} fullWidth>
          <Label className="text-base font-bold">{member ? 'Password baru (kosongkan bila tidak diubah)' : 'Password'}</Label>
          <div className="relative">
            <Input className="h-12 pr-24 font-mono text-base" autoComplete="new-password" />
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5">
              <button type="button" aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShow((value) => !value)} className="flex size-10 items-center justify-center rounded-xl text-muted hover:bg-default">{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
              <button type="button" aria-label="Buat password otomatis" onClick={() => { setPassword(generatePassword()); setShow(true); }} className="flex size-10 items-center justify-center rounded-xl text-accent hover:bg-default"><Wand2 className="size-5" /></button>
            </div>
          </div>
          <Description className="text-sm">Minimal 8 karakter. Ketuk tongkat ajaib untuk membuat password yang mudah dibaca.</Description>
        </TextField>
        {platform && (
          <Select value={role} onChange={(value) => setRole(value as 'user' | 'company_admin')} fullWidth aria-label="Peran">
            <Label className="text-base font-bold">Peran</Label>
            <Select.Trigger className="h-12 text-base"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox>
              <ListBox.Item id="user" textValue="Anggota">Anggota<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="company_admin" textValue="Super admin">Super admin company<ListBox.ItemIndicator /></ListBox.Item>
            </ListBox></Select.Popover>
          </Select>
        )}
        {member && (
          <Switch isSelected={locked} onChange={setLocked}>
            <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>
              <span className="text-base font-semibold"><KeyRound className="mr-1.5 inline size-4" aria-hidden="true" />Kunci akun ini <span className="block text-sm font-normal text-muted">Akun terkunci tidak bisa membuka data sampai Anda membukanya lagi.</span></span>
            </Switch.Content>
          </Switch>
        )}
        {error && <Notice status="danger">{error}</Notice>}
      </Modal.Body>
      <Modal.Footer>
        <Button slot="close" variant="tertiary" size="lg">Batal</Button>
        <Button size="lg" isPending={busy} isDisabled={!valid} onPress={save}>{member ? 'Simpan perubahan' : 'Buat akun'}</Button>
      </Modal.Footer>
    </>
  );
}
