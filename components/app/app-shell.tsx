'use client';

import { type ReactNode } from 'react';
import { Avatar, Button, Drawer, useOverlayState } from '@heroui/react';
import { Boxes, Building2, ChevronRight, LayoutDashboard, LogOut, Menu, Settings, Sparkles, UploadCloud, Users, Workflow } from 'lucide-react';
import { initials } from '@/lib/format';
import { useCompany, useManage, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type NavItem = { id: string; label: string; short?: string; icon: typeof LayoutDashboard; badge?: number };

const ROLE_LABEL = { admin: 'Administrator platform', company_admin: 'Super admin company', user: 'Anggota tim' } as const;

function useNav() {
  const { company, unseen } = useCompany();
  const { user } = useSession();
  const { target } = useManage();
  const perms = company?.permissions;
  const main: NavItem[] = [
    { id: 'beranda', label: 'Beranda', icon: LayoutDashboard },
    { id: 'cocokkan', label: 'Cocokkan', icon: Workflow },
    { id: 'match-baru', label: 'Match Terbaru', short: 'Match Baru', icon: Sparkles, badge: unseen },
    { id: 'stok', label: 'Stok Sales', short: 'Stok', icon: Boxes },
  ];
  const manage: NavItem[] = [
    ...(perms?.upload_data ? [{ id: 'data', label: 'Unggah Data', icon: UploadCloud }] : []),
    ...(perms?.manage_team ? [{ id: 'tim', label: 'Tim & Akses', icon: Users }] : []),
    { id: 'pengaturan', label: 'Pengaturan', icon: Settings },
  ];
  const platform: NavItem[] = user.role === 'admin' && !target ? [{ id: 'perusahaan', label: 'Perusahaan', icon: Building2 }] : user.role === 'admin' ? [{ id: 'perusahaan', label: 'Semua perusahaan', icon: Building2 }] : [];
  return { main, manage, platform };
}

function Logo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-auto-audit.png" alt="Property Auto Audit" width={1024} height={418} className={cn('h-10 w-auto object-contain', className)} />;
}

function NavLink({ item, active, onNavigate, compact }: { item: NavItem; active: boolean; onNavigate: (id: string) => void; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-2xl text-left font-semibold transition-colors',
        compact ? 'min-h-12 px-3.5 text-base' : 'min-h-12 px-4 text-[1.0625rem]',
        active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-foreground hover:bg-default')}
    >
      <Icon className={cn('size-[1.35rem] shrink-0', active ? '' : 'text-muted group-hover:text-foreground')} aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {!!item.badge && (
        <span className={cn('min-w-6 rounded-full px-2 py-0.5 text-center text-sm font-bold', active ? 'bg-white text-accent' : 'bg-hot text-white')}>
          {item.badge > 99 ? '99+' : item.badge}<span className="sr-only"> match baru belum dilihat</span>
        </span>
      )}
    </button>
  );
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { user } = useSession();
  const { company } = useCompany();
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center gap-3">
        <Avatar color="accent" size="md"><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-bold">{user.display_name}</p>
          <p className="truncate text-sm text-muted">{ROLE_LABEL[user.role]}</p>
        </div>
        <Button isIconOnly variant="tertiary" aria-label="Keluar dari akun" onPress={onLogout}><LogOut className="size-5 text-danger" aria-hidden="true" /></Button>
      </div>
      {company?.company_name && <p className="mt-2 truncate text-sm font-medium text-muted"><Building2 className="mr-1.5 inline size-3.5" aria-hidden="true" />{company.company_name}</p>}
    </div>
  );
}

function ManagingBanner() {
  const { target, leave } = useManage();
  const { user } = useSession();
  if (!target || user.role !== 'admin') return null;
  return (
    <div className="sticky top-16 z-20 mb-4 flex items-center justify-between gap-2 rounded-2xl bg-warning py-1.5 pr-1.5 pl-3.5 text-warning-foreground shadow-md lg:top-4">
      <p className="min-w-0 truncate text-[0.95rem]"><Building2 className="mr-1.5 inline size-4" aria-hidden="true" /><span className="hidden sm:inline">Anda sedang mengelola: </span><strong>{target.name}</strong></p>
      <Button size="sm" variant="secondary" className="shrink-0" onPress={leave}>Semua perusahaan</Button>
    </div>
  );
}

export function AppShell({ route, navigate, children }: { route: string; navigate: (path: string) => void; children: ReactNode }) {
  const { main, manage, platform } = useNav();
  const { logout, user } = useSession();
  const { company, unseen } = useCompany();
  const menu = useOverlayState();
  const go = (id: string) => { menu.close(); navigate(id); };
  const bottom = main;
  const inMore = [...manage, ...platform].some((item) => item.id === route);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col gap-6 border-r border-border bg-surface px-4 py-5 lg:flex">
        <button type="button" onClick={() => navigate('beranda')} className="px-2 text-left" aria-label="Ke Beranda"><Logo className="h-11" /></button>
        <nav aria-label="Menu utama" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {main.map((item) => <NavLink key={item.id} item={item} active={route === item.id} onNavigate={go} />)}
          <p className="mt-5 mb-1 px-4 text-sm font-bold uppercase tracking-wider text-muted">Kelola</p>
          {manage.map((item) => <NavLink key={item.id} item={item} active={route === item.id} onNavigate={go} />)}
          {platform.length > 0 && <>
            <p className="mt-5 mb-1 px-4 text-sm font-bold uppercase tracking-wider text-muted">Platform</p>
            {platform.map((item) => <NavLink key={item.id} item={item} active={route === item.id} onNavigate={go} />)}
          </>}
        </nav>
        <UserCard onLogout={logout} />
      </aside>

      {/* Phone / tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => navigate('beranda')} aria-label="Ke Beranda"><Logo className="h-8" /></button>
        <p className="min-w-0 flex-1 truncate text-right text-sm font-semibold text-muted">{company?.company_name ?? ''}</p>
        <Button isIconOnly variant="tertiary" aria-label="Buka menu" onPress={() => menu.open()}><Menu className="size-5" /></Button>
      </header>

      <main className="px-4 pt-5 pb-28 sm:px-6 lg:ml-72 lg:px-10 lg:pt-8 lg:pb-12">
        <div className="mx-auto max-w-[1280px]"><ManagingBanner />{children}</div>
      </main>

      {/* Phone bottom navigation: five clear targets with visible labels */}
      <nav aria-label="Menu utama" className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 px-1 pt-1.5 backdrop-blur lg:hidden">
        {bottom.map((item) => {
          const Icon = item.icon;
          const active = route === item.id;
          return (
            <button key={item.id} type="button" onClick={() => go(item.id)} aria-current={active ? 'page' : undefined}
              className={cn('relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.8rem] font-semibold', active ? 'text-accent' : 'text-muted')}>
              <span className={cn('relative flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-accent-soft')}>
                <Icon className="size-[1.4rem]" aria-hidden="true" />
                {item.id === 'match-baru' && unseen > 0 && <span className="absolute -top-1 right-0.5 min-w-5 rounded-full bg-hot px-1 text-center text-[0.7rem] font-bold leading-5 text-white">{unseen > 99 ? '99+' : unseen}</span>}
              </span>
              {item.short ?? item.label}
            </button>
          );
        })}
        <button type="button" onClick={() => menu.open()} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.8rem] font-semibold', inMore ? 'text-accent' : 'text-muted')}>
          <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', inMore && 'bg-accent-soft')}><Menu className="size-[1.4rem]" aria-hidden="true" /></span>
          Lainnya
        </button>
      </nav>

      <Drawer.Backdrop isOpen={menu.isOpen} onOpenChange={(open) => menu.setOpen(open)}>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="max-h-[88dvh]">
            <Drawer.Handle />
            <Drawer.Header><Drawer.Heading>Menu</Drawer.Heading></Drawer.Header>
            <Drawer.Body className="space-y-2 pb-6">
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-background p-3">
                <Avatar color="accent"><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
                <div className="min-w-0"><p className="truncate font-bold">{user.display_name}</p><p className="truncate text-sm text-muted">{ROLE_LABEL[user.role]}{company?.company_name ? ` · ${company.company_name}` : ''}</p></div>
              </div>
              {[...manage, ...platform].map((item) => (
                <button key={item.id} type="button" onClick={() => go(item.id)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-left text-base font-semibold">
                  <item.icon className="size-5 text-accent" aria-hidden="true" /><span className="flex-1">{item.label}</span><ChevronRight className="size-4 text-muted" aria-hidden="true" />
                </button>
              ))}
              <Button variant="danger-soft" size="lg" fullWidth className="mt-3" onPress={() => { menu.close(); logout(); }}><LogOut className="size-4" aria-hidden="true" />Keluar</Button>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </div>
  );
}
