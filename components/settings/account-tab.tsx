'use client';

import { useState } from 'react';
import { Avatar, Button, Input, Label, TextField, toast } from '@heroui/react';
import { Building2, KeyRound, LogOut, Mail } from 'lucide-react';
import { Notice, Panel } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { initials } from '@/lib/format';
import { useCompany, useSession } from '@/lib/session';
import { useApi } from '@/lib/workspace-context';

const ROLE = { admin: 'Administrator platform', company_admin: 'Super admin company', user: 'Anggota tim' } as const;

export function AccountTab() {
  const api = useApi();
  const { user, logout } = useSession();
  const { company } = useCompany();
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
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex items-center gap-4">
          <Avatar color="accent" size="lg" className="size-16 text-xl"><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
          <div className="min-w-0">
            <p className="break-words text-xl font-bold">{user.display_name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 break-all text-base text-muted"><Mail className="size-4 shrink-0" aria-hidden="true" />{user.email}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-base text-muted"><Building2 className="size-4 shrink-0" aria-hidden="true" />{company?.company_name ?? '—'} · {ROLE[user.role]}</p>
          </div>
        </div>
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-5 text-accent" aria-hidden="true" />Ganti password</span>} description="Gunakan minimal 8 karakter.">
        <div className="max-w-md space-y-4">
          <TextField type="password" value={current} onChange={setCurrent} fullWidth><Label className="text-base font-bold">Password saat ini</Label><Input className="h-12 text-base" autoComplete="current-password" /></TextField>
          <TextField type="password" value={next} onChange={setNext} fullWidth><Label className="text-base font-bold">Password baru</Label><Input className="h-12 text-base" autoComplete="new-password" /></TextField>
          <TextField type="password" value={again} onChange={setAgain} fullWidth isInvalid={mismatch}><Label className="text-base font-bold">Ulangi password baru</Label><Input className="h-12 text-base" autoComplete="new-password" />{mismatch && <p className="mt-1 text-sm text-danger">Password belum sama.</p>}</TextField>
          {error && <Notice status="danger">{error}</Notice>}
          <Button size="lg" isPending={busy} isDisabled={!current || next.length < 8 || next !== again} onPress={change}>Ganti password</Button>
        </div>
      </Panel>
      <Button variant="danger-soft" size="lg" onPress={logout}><LogOut className="size-4" aria-hidden="true" />Keluar dari akun ini</Button>
    </div>
  );
}
