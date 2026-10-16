'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Description, Dropdown, Input, Label, Modal, Switch, TextField, toast, useOverlayState } from '@heroui/react';
import { BookOpen, CalendarDays, ChevronDown, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Search, ShieldCheck, UserRound, Wand2, X } from 'lucide-react';
import { SettingsPagination } from '@/components/settings/settings-pagination';
import { claimTeamGuideHint, dismissTeamGuideHint } from '@/lib/team-guide-hint';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/app/primitives';
import { SettingsNote } from '@/components/settings/settings-section';
import { errorMessage } from '@/lib/api';
import { dateOnly, initials } from '@/lib/format';
import { useCompany, useSession } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { Role, TeamMember } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const ROLE_NAME: Record<Role, string> = { admin: 'Administrator platform', company_admin: 'Super admin', user: 'Anggota' };
type CreatedInfo = { email: string; password: string; name: string };

/** A password people can read out and type: no look-alike characters. */
export function generatePassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function AutoAuditGuideHint({ userId }: { userId: string }) {
  const eligibility = useRef<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (eligibility.current === null) eligibility.current = claimTeamGuideHint(userId);
    if (!eligibility.current) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [userId]);
  if (!visible) return null;
  return <aside className="team-guide-hint" aria-label="Informasi pengelolaan AutoAudit"><p>Anggota company ini dikelola melalui AutoAudit. Lihat Panduan akses untuk penjelasannya.</p><button type="button" aria-label="Jangan tampilkan pesan ini lagi" onClick={() => { dismissTeamGuideHint(userId); setVisible(false); }}><X className="size-4" aria-hidden="true" /></button></aside>;
}

export default function TeamPage() {
  const api = useApi();
  const { user } = useSession();
  const managed = Boolean(useCompany().company?.managed_by_autoaudit);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const [search, setSearch] = useState('');
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const [pageSize, setPageSize] = useState(20);
  const form = useOverlayState();
  const guide = useOverlayState();
  const members = useData((signal) => api.get<TeamMember[]>('/team/users', signal), [tick]);
  const reload = () => setTick((value) => value + 1);
  const platform = user.role === 'admin';
  const query = search.trim().toLocaleLowerCase('id-ID');
  const filtered = (members.data ?? []).filter((member) => `${member.display_name} ${member.email}`.toLocaleLowerCase('id-ID').includes(query));
  const page = Math.min(paging.query === query ? paging.page : 1, Math.max(1, Math.ceil(filtered.length / pageSize)));

  return <div className="general-settings team-page">
    <header className="team-toolbar">
      <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari anggota" placeholder="Cari nama atau email…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Hapus pencarian anggota" onClick={() => setSearch('')}><X className="size-3.5" /></button>}</div>
      <div className="team-toolbar-actions"><div className="team-guide-anchor"><Button variant="secondary" onPress={() => guide.open()}><BookOpen className="size-4" aria-hidden="true" />Panduan akses</Button>{managed && !platform && <AutoAuditGuideHint key={user.id} userId={user.id} />}</div>{!managed && <Button onPress={() => { setEditing(null); form.open(); }}><Plus className="size-4" aria-hidden="true" />Tambah anggota</Button>}</div>
    </header>
    <ErrorNotice message={members.error} onRetry={members.reload} />
    {members.loading && !members.data && <LoadingRows rows={3} />}
    {members.data?.length === 0 && <EmptyState compact title="Belum ada anggota tim" description={managed ? 'Akun anggota dikelola melalui AutoAudit.' : 'Tambahkan anggota untuk berbagi akses ke data company.'} />}
    {!!members.data?.length && <div className="team-data">
      <div className="team-cards-panel">{!filtered.length ? <p className="py-8 text-center text-sm text-muted">Nama atau email anggota tidak ditemukan.</p> : <ul className="team-member-grid">{filtered.slice((page - 1) * pageSize, page * pageSize).map((member) => <li key={member.id} className="team-member-card">
        <div className="team-card-heading"><Avatar size="sm" className="team-member-avatar" color={member.is_locked ? 'danger' : 'accent'}><Avatar.Fallback>{initials(member.display_name)}</Avatar.Fallback></Avatar><div className="min-w-0 flex-1"><div className="team-member-name"><h2 className="text-base font-semibold" title={member.display_name}>{member.display_name}</h2>{member.is_self && <span className="team-self-badge">Anda</span>}</div><p className="team-member-email" title={member.email}>{member.email}</p></div>{member.editable && <Dropdown><Dropdown.Trigger className="team-card-action" aria-label={`Aksi ${member.display_name}`}><ChevronDown className="size-4" aria-hidden="true" /></Dropdown.Trigger><Dropdown.Popover placement="bottom end" className="sales-action-menu"><Dropdown.Menu aria-label={`Aksi anggota ${member.display_name}`} onAction={() => { if (member.editable) { setEditing(member); form.open(); } }}><Dropdown.Item id="edit" textValue="Edit" isDisabled={!member.editable}><Pencil className="size-3.5" /><Label>Edit</Label>{!member.editable && <Description>{managed ? 'Dikelola melalui AutoAudit' : 'Akun ini tidak dapat diedit oleh role Anda'}</Description>}</Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown>}</div>
        <div className="team-card-status" data-locked={member.is_locked}><span className="team-status-dot" aria-hidden="true" /><span>{member.is_locked ? 'Terkunci' : 'Anggota Terhubung'}</span></div>
        <dl className="team-card-meta"><div><dt><UserRound className="team-meta-icon" aria-hidden="true" /><span>Peran</span></dt><dd>{ROLE_NAME[member.role]}</dd></div><div><dt><CalendarDays className="team-meta-icon" aria-hidden="true" /><span>Bergabung</span></dt><dd>{dateOnly(member.created_at)}</dd></div></dl>
      </li>)}</ul>}</div>
      <SettingsPagination total={filtered.length} label="anggota" page={page} pageSize={pageSize} onPage={(next) => setPaging({ query, page: next })} onPageSize={(size) => { setPageSize(size); setPaging({ query, page: 1 }); }} />
    </div>}
    <MemberDialog state={form} member={editing} platform={platform} onDone={(info) => { if (info) setCreated(info); reload(); }} />
    {created && <CreatedMemberDialog info={created} onClose={() => setCreated(null)} />}
    <Modal.Backdrop isOpen={guide.isOpen} onOpenChange={(open) => guide.setOpen(open)}><Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog team-guide-dialog">
      <Modal.CloseTrigger /><Modal.Header><Modal.Heading>Panduan akses</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body space-y-4 text-sm text-foreground">
        {managed && <SettingsNote>Akun company ini dikelola dari AutoAudit. Anggota masuk lewat akun AutoAudit company, jadi akun baru tidak dapat ditambahkan di sini.</SettingsNote>}
        <section><h2 className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" aria-hidden="true" />Super admin company</h2><ul className="mt-2 list-disc space-y-1 pl-5"><li>Menambah dan mengunci akun anggota pada company yang dikelola di sini.</li><li>Mengunggah data chat.</li><li>Mengatur kata kunci, penguncian kata kunci, pengelompokan, dan nomor sales.</li><li>Mengatur toleransi, bobot, glosarium, serta indeks lokasi.</li></ul></section>
        <section><h2 className="flex items-center gap-2 font-medium"><UserRound className="size-4" aria-hidden="true" />Anggota</h2><ul className="mt-2 list-disc space-y-1 pl-5"><li>Mencocokkan buyer dan listing, serta mengunduh PDF.</li><li>Menandai listing Ready, On-hold, Sold, atau Hapus.</li><li>Melihat Beranda, Match Terbaru, dan Stok Sales.</li><li>Mengubah kata kunci sendiri jika tidak dikunci.</li></ul></section>
        {platform && <SettingsNote>Administrator platform juga dapat mengelola super admin company dan mengubah peran akun. Administrator platform tidak dapat diedit dari daftar tim.</SettingsNote>}
        <SettingsNote>Semua anggota dalam company yang sama memakai data company yang sama. Akun terkunci tidak dapat membuka data sampai kuncinya dibuka.</SettingsNote>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </div>;
}

function MemberDialog({ state, member, platform, onDone }: { state: ReturnType<typeof useOverlayState>; member: TeamMember | null; platform: boolean; onDone: (created?: CreatedInfo) => void }) {
  const [busy, setBusy] = useState(false);
  return <Modal.Backdrop isOpen={state.isOpen} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!busy) state.setOpen(open); }}><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog team-member-dialog"><MemberForm member={member} platform={platform} busy={busy} setBusy={setBusy} onClose={() => state.close()} onDone={onDone} /></Modal.Dialog></Modal.Container></Modal.Backdrop>;
}

function MemberForm({ member, platform, busy, setBusy, onClose, onDone }: { member: TeamMember | null; platform: boolean; busy: boolean; setBusy: (value: boolean) => void; onClose: () => void; onDone: (created?: CreatedInfo) => void }) {
  const api = useApi();
  const [name, setName] = useState(member?.display_name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [password, setPassword] = useState(() => (member ? '' : generatePassword()));
  const [role, setRole] = useState<'user' | 'company_admin'>(member?.role === 'company_admin' ? 'company_admin' : 'user');
  const [locked, setLocked] = useState(member?.is_locked ?? false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const valid = name.trim() && /.+@.+\..+/.test(email) && (member ? !password || password.length >= 8 : password.length >= 8);
  async function save() {
    if (busy || !valid) return;
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
    } catch (reason) { const message = errorMessage(reason); setError(message); toast.danger(message); } finally { setBusy(false); }
  }
  return <>
    {!busy && <Modal.CloseTrigger />}<Modal.Header><Modal.Heading>{member ? `Kelola ${member.display_name}` : 'Tambah anggota tim'}</Modal.Heading></Modal.Header>
    <Modal.Body className="sales-dialog-body space-y-3">
      <TextField value={name} onChange={setName} isRequired isDisabled={busy} fullWidth><Label>Nama</Label><Input placeholder="mis. Rina Marketing" maxLength={100} /></TextField>
      <TextField value={email} onChange={setEmail} isRequired type="email" isDisabled={busy} fullWidth><Label>Email (untuk masuk)</Label><Input placeholder="nama@perusahaan.com" autoComplete="off" /></TextField>
      <div><label htmlFor="team-member-password" className="mb-1.5 block text-sm">{member ? 'Password baru' : 'Password'}</label><div className="team-password-input"><input id="team-member-password" className="input font-mono" type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={200} disabled={busy} aria-describedby="team-password-hint" /><div className="team-password-actions"><button type="button" disabled={busy} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button><button type="button" disabled={busy} aria-label="Buat password otomatis" onClick={() => { setPassword(generatePassword()); setShow(true); }}><Wand2 className="size-4" /></button></div></div><p id="team-password-hint" className="mt-1 text-xs text-muted">{member ? 'Kosongkan jika tidak diubah. ' : ''}Minimal 8 karakter. Gunakan ikon tongkat untuk membuat password otomatis.</p></div>
      {platform && <div><label htmlFor="team-member-role" className="mb-1.5 block text-sm">Peran</label><select id="team-member-role" aria-label="Peran" value={role} onChange={(event) => setRole(event.target.value as 'user' | 'company_admin')} disabled={busy} className="team-role-select"><option value="user">Anggota</option><option value="company_admin">Super admin company</option></select></div>}
      {member && <Switch isSelected={locked} onChange={setLocked} isDisabled={busy}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="text-sm font-normal"><KeyRound className="mr-1.5 inline size-4" aria-hidden="true" />Kunci akun ini<span className="mt-1 block text-xs text-muted">Akun tidak dapat membuka data sampai kuncinya dibuka.</span></span></Switch.Content></Switch>}
      {error && <SettingsNote tone="danger">{error}</SettingsNote>}
    </Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={busy} onPress={onClose}>Batal</Button><Button isPending={busy} isDisabled={!valid} onPress={save}>{member ? 'Simpan perubahan' : 'Buat akun'}</Button></Modal.Footer>
  </>;
}

function CreatedMemberDialog({ info, onClose }: { info: CreatedInfo; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(`Email: ${info.email}\nPassword: ${info.password}`); toast.success('Info login disalin'); }
    catch { toast.danger('Info login tidak dapat disalin. Silakan salin secara manual.'); }
  }
  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog team-created-dialog">
    <Modal.CloseTrigger /><Modal.Header><Modal.Heading>Akun berhasil dibuat</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body space-y-3"><p className="text-sm">Info login untuk <span className="font-medium">{info.name}</span>.</p><TextField value={info.email} isReadOnly fullWidth><Label>Email</Label><Input /></TextField><div><label className="mb-1.5 block text-sm" htmlFor="team-created-password">Password</label><div className="account-password-input"><input id="team-created-password" className="input font-mono" type={visible ? 'text' : 'password'} value={info.password} readOnly /><button type="button" aria-label={visible ? 'Sembunyikan password baru' : 'Tampilkan password baru'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div><SettingsNote>Salin info login untuk diberikan kepada anggota. Password tidak dapat ditampilkan lagi setelah modal ini ditutup.</SettingsNote></Modal.Body><Modal.Footer><Button variant="secondary" onPress={onClose}>Tutup</Button><Button onPress={copy}><Copy className="size-4" />Salin info login</Button></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
