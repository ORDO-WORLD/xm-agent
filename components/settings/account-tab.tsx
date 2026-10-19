'use client';

import { Avatar, Button, useOverlayState } from '@heroui/react';
import { ExternalLink, LogOut, UserRound } from 'lucide-react';
import { CompanyLogoutDialog } from '@/components/app/company-shell';
import { SettingsLabel, SettingsSection } from './settings-section';
import { initials } from '@/lib/format';
import { useSession } from '@/lib/session';

export function AccountTab() {
  const { user, logout } = useSession();
  const confirmLogout = useOverlayState();
  const accountPath = user.role === 'admin' ? '/dashboard' : '/dashboard/profile-company';
  return (
    <div className="general-settings account-settings">
      <div className="account-profile">
        <Avatar color="accent" className="size-20 text-2xl"><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
        <p className="mt-3 break-words text-xl font-medium"><SettingsLabel tab="akun">{user.display_name}</SettingsLabel></p>
        <p className="mt-1 break-all text-base text-muted"><SettingsLabel tab="akun">{user.email}</SettingsLabel></p>
      </div>
      <div className="account-controls">
        <SettingsSection tab="akun" icon={UserRound} title="Akun AutoAudit" description="Nama, password, dan akses akun dikelola melalui AutoAudit.">
          <a className="inline-flex items-center gap-2 text-accent underline" href={`${user.autoaudit_url || ''}${accountPath}`}><ExternalLink className="size-4" aria-hidden="true" />Kelola akun di AutoAudit</a>
        </SettingsSection>
        <section className="account-session">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium"><LogOut className="size-4" aria-hidden="true" /><SettingsLabel tab="akun">Sesi akun</SettingsLabel></h2>
            <Button variant="danger-soft" onPress={() => confirmLogout.open()}><LogOut className="size-4" aria-hidden="true" />Keluar dari akun ini</Button>
          </div>
          <p className="mt-1 text-sm text-muted">Keluar dari Property dan AutoAudit.</p>
        </section>
      </div>
      <CompanyLogoutDialog state={confirmLogout} onConfirm={() => { confirmLogout.close(); logout(); }} />
    </div>
  );
}
