'use client';

import { useId, useState } from 'react';
import { Avatar, Button, toast, useOverlayState } from '@heroui/react';
import { Eye, EyeOff, KeyRound, LogOut, Save } from 'lucide-react';
import { CompanyLogoutDialog } from '@/components/app/company-shell';
import { SettingsLabel, SettingsNote, SettingsSection } from './settings-section';
import { errorMessage } from '@/lib/api';
import { initials } from '@/lib/format';
import { useCompany, useSession } from '@/lib/session';
import { useApi } from '@/lib/workspace-context';

function PasswordField({ label, value, onChange, autoComplete, disabled, invalid }: {
  label: string; value: string; onChange: (value: string) => void;
  autoComplete: string; disabled: boolean; invalid?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <div className="account-password-field">
    <label htmlFor={id}><SettingsLabel tab="akun">{label}</SettingsLabel></label>
    <div className="account-password-input">
      <input id={id} className="input" type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} disabled={disabled} aria-invalid={invalid || undefined} data-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} />
      <button type="button" aria-label={`${visible ? 'Sembunyikan' : 'Tampilkan'} ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(!visible)}><Icon className="size-4" aria-hidden="true" /></button>
    </div>
    {invalid && <p id={`${id}-error`} className="text-xs text-danger">Password belum sama.</p>}
  </div>;
}

export function AccountTab() {
  const api = useApi();
  const { user, logout } = useSession();
  const { company } = useCompany();
  const confirmLogout = useOverlayState();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mismatch = !!again && next !== again;

  async function change() {
    setBusy(true); setError('');
    try {
      await api.put('/auth/password', { current_password: current, new_password: next });
      toast.success('Password diganti. Perangkat lain perlu masuk lagi.');
      setCurrent(''); setNext(''); setAgain('');
    } catch (reason) { const message = errorMessage(reason); setError(message); toast.danger(message); } finally { setBusy(false); }
  }

  return (
    <div className="general-settings account-settings">
      <div className="account-profile">
        <Avatar color="accent" className="size-20 text-2xl"><Avatar.Fallback>{initials(company?.company_name || user.display_name)}</Avatar.Fallback></Avatar>
        <p className="mt-3 break-words text-xl font-medium"><SettingsLabel tab="akun">{company?.company_name || user.display_name}</SettingsLabel></p>
        <p className="mt-1 break-all text-base text-muted"><SettingsLabel tab="akun">{user.email}</SettingsLabel></p>
      </div>
      <div className="account-controls">
      <SettingsSection tab="akun" icon={KeyRound} title="Ganti password" description="Gunakan minimal 8 karakter untuk password baru.">
        <div className="flex flex-col gap-3">
          <PasswordField label="Password saat ini" value={current} onChange={setCurrent} autoComplete="current-password" disabled={busy} />
          <PasswordField label="Password baru" value={next} onChange={setNext} autoComplete="new-password" disabled={busy} />
          <PasswordField label="Ulangi password baru" value={again} onChange={setAgain} autoComplete="new-password" disabled={busy} invalid={mismatch} />
        </div>
        <SettingsNote>Setelah password diganti, perangkat lain perlu masuk kembali.</SettingsNote>
        {error && <SettingsNote tone="danger">{error}</SettingsNote>}
        <Button className="self-end" isPending={busy} isDisabled={!current || next.length < 8 || next !== again} onPress={change}><Save className="size-4" aria-hidden="true" />Ganti password</Button>
      </SettingsSection>
      <section className="account-session">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium"><LogOut className="size-4" aria-hidden="true" /><SettingsLabel tab="akun">Sesi akun</SettingsLabel></h2>
          <Button variant="danger-soft" onPress={() => confirmLogout.open()}><LogOut className="size-4" aria-hidden="true" />Keluar dari akun ini</Button>
        </div>
        <p className="mt-1 text-sm text-muted">Akhiri sesi akun pada perangkat ini.</p>
      </section>
      </div>
      <CompanyLogoutDialog state={confirmLogout} onConfirm={() => { confirmLogout.close(); logout(); }} />
    </div>
  );
}
