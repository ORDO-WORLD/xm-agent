'use client';

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { AlertDialog, Avatar, Button, Drawer, Dropdown, Label, useOverlayState } from '@heroui/react';
import { ArrowLeft, Boxes, Building2, ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Menu, ScrollText, Settings, Sparkles, UploadCloud, Users, Workflow } from 'lucide-react';
import { initials } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany, useManage, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const MAIN = [
  { id: 'beranda', label: 'Beranda', icon: LayoutDashboard },
  { id: 'cocokkan', label: 'Cocokkan', icon: Workflow },
  { id: 'match-baru', label: 'Match Terbaru', icon: Sparkles },
  { id: 'stok', label: 'Stok Sales', icon: Boxes },
];
const MANAGE = [
  { id: 'data', label: 'Unggah Data', icon: UploadCloud },
  { id: 'tim', label: 'Tim & Akses', icon: Users },
  { id: 'pengaturan', label: 'Pengaturan', icon: Settings },
];
const AVATAR_COLORS = ['#80c4b5', '#89bcd1', '#aaa0ce', '#ccab92', '#9fb78c'];
type PageHeading = { title: string; onBack?: () => void } | null;
const PageHeadingContext = createContext<Dispatch<SetStateAction<PageHeading>> | null>(null);

export function usePageHeading(title: string | null, onBack?: () => void) {
  const setHeading = useContext(PageHeadingContext);
  useEffect(() => {
    if (!setHeading || !title) return;
    setHeading({ title, onBack });
    return () => setHeading(null);
  }, [setHeading, title, onBack]);
}

export function CompanyLogoutDialog({ state, onConfirm }: { state: ReturnType<typeof useOverlayState>; onConfirm: () => void }) {
  return (
    <AlertDialog.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)} className="company-logout-backdrop">
      <AlertDialog.Container placement="center" className="company-logout-container">
        <AlertDialog.Dialog className="company-logout-dialog">
          <div className="company-logout-intro">
            <AlertDialog.Header className="company-logout-heading">
              <div className="company-logout-icon"><LogOut className="size-7" aria-hidden="true" /></div>
              <AlertDialog.Heading>Konfirmasi Logout</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="company-logout-message">Apakah Anda yakin ingin keluar dari aplikasi? Sesi Anda akan diakhiri.</AlertDialog.Body>
          </div>
          <AlertDialog.Footer className="company-logout-actions">
            <Button slot="close" variant="secondary" className="company-logout-cancel">Batal</Button>
            <Button variant="danger" className="company-logout-confirm" onPress={onConfirm}>Ya, Logout</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

export function CompanyShell({ route, navigate, children }: { route: string; navigate: Navigate; children: ReactNode }) {
  const { user, logout } = useSession();
  const { company, unseen } = useCompany();
  const { target, leave } = useManage();
  const [pageHeading, setPageHeading] = useState<PageHeading>(null);
  const menu = useOverlayState();
  const confirmLogout = useOverlayState();
  const [avatarColor] = useState(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem('xm.sidebar.collapsed') === '1'; } catch { return false; }
  });
  const manage = MANAGE.filter((item) => item.id === 'data' ? company?.permissions.upload_data : item.id === 'tim' ? company?.permissions.manage_team : true);
  const platform = user.role === 'admin' ? [
    { id: 'perusahaan', label: target ? 'Semua perusahaan' : 'Perusahaan', icon: Building2 },
    { id: 'aktivitas', label: 'Aktivitas', icon: ScrollText },
  ] : [];
  const title = route === 'perusahaan' ? 'Perusahaan' : [...MAIN, ...MANAGE, ...platform].find((item) => item.id === route)?.label ?? 'Beranda';
  const go = (path: string) => { menu.close(); navigate(path); };
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem('xm.sidebar.collapsed', next ? '1' : '0'); } catch { /* private mode */ }
  };
  const links = (compact: boolean) => (
    <>
      {MAIN.map((item) => navLink(item, compact))}
      <p className={cn('company-menu-group', compact && 'sr-only')}>Kelola</p>
      {manage.map((item) => navLink(item, compact))}
      {platform.length > 0 && <><p className={cn('company-menu-group', compact && 'sr-only')}>Platform</p>{platform.map((item) => navLink(item, compact))}</>}
    </>
  );
  function navLink(item: (typeof MAIN)[number], compact: boolean) {
    const Icon = item.icon;
    const badge = item.id === 'match-baru' ? unseen : 0;
    return (
      <button type="button" key={item.id} onClick={() => go(item.id)} title={compact ? item.label : undefined}
        aria-label={compact ? item.label : undefined} aria-current={route === item.id ? 'page' : undefined}
        className={cn('company-menu-item', route === item.id && 'is-active', compact && 'is-compact')}>
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <span className={compact ? 'sr-only' : 'min-w-0 flex-1 text-left'}>{item.label}</span>
        {badge > 0 && <span className={cn('company-menu-badge', compact && 'is-compact')}>{badge > 99 ? '99+' : badge}<span className="sr-only"> match belum dilihat</span></span>}
      </button>
    );
  }

  return (
    <PageHeadingContext.Provider value={setPageHeading}><div className={cn('company-frame', collapsed && 'company-sidebar-collapsed', route === 'pengaturan' && 'company-frame-settings')}>
      <aside className="company-sidebar">
        <div className="company-sidebar-brand">
          <button type="button" onClick={() => go('beranda')} aria-label="Ke Beranda" className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={collapsed ? '/brand-auto-audit-icon.png' : '/brand-auto-audit.png'} alt="AutoAudit" className="h-10 w-auto object-contain" />
          </button>
          <button type="button" className="company-sidebar-toggle" onClick={toggle} aria-label={collapsed ? 'Perluas sidebar' : 'Kecilkan sidebar'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </div>
        <nav className="company-sidebar-nav" aria-label="Menu utama">{links(collapsed)}</nav>
      </aside>

      <header className="company-navbar">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="company-navbar-menu lg:hidden" onClick={() => menu.open()} aria-label="Buka menu"><Menu className="size-5" /></button>
          {pageHeading?.onBack && <button type="button" className="company-navbar-back" aria-label={`Kembali dari ${pageHeading.title}`} onClick={pageHeading.onBack}><ArrowLeft size={20} aria-hidden="true" /></button>}
          <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">{pageHeading?.title ?? title}</h1>
        </div>
        <Dropdown>
          <Dropdown.Trigger className="company-profile-trigger" aria-label="Buka menu profil">
            <Avatar size="sm" className="company-profile-avatar" style={{ backgroundColor: avatarColor, color: '#fff' }}><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
            <span className="hidden min-w-0 text-left sm:block"><span className="block max-w-48 truncate text-[13px] leading-tight font-semibold">{user.display_name}</span><span className="mt-0.5 block max-w-48 truncate text-[11px] text-muted">{user.email}</span></span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end" className="company-profile-menu">
            <Dropdown.Menu aria-label="Menu akun" onAction={() => confirmLogout.open()}>
              <Dropdown.Item id="logout" textValue="Logout" variant="danger"><LogOut className="size-3.5 text-danger" aria-hidden="true" /><Label>Logout</Label></Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </header>

      <main className="company-content"><div className="company-content-inner">
        {user.role === 'admin' && target && <section className="company-managing-banner" aria-label="Company yang sedang dikelola"><p className="flex min-w-0 items-center gap-2"><Building2 className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">Mengelola: <span className="font-medium">{target.name}</span></span></p><Button variant="secondary" size="sm" className="shrink-0" onPress={leave}>Semua perusahaan</Button></section>}
        {children}
      </div></main>

      <Drawer.Backdrop isOpen={menu.isOpen} onOpenChange={(open) => menu.setOpen(open)}>
        <Drawer.Content placement="left"><Drawer.Dialog className="company-mobile-drawer">
          <Drawer.Header><Drawer.Heading>Menu</Drawer.Heading><Drawer.CloseTrigger /></Drawer.Header>
          <Drawer.Body><nav aria-label="Menu utama mobile">{links(false)}</nav></Drawer.Body>
        </Drawer.Dialog></Drawer.Content>
      </Drawer.Backdrop>
      <CompanyLogoutDialog state={confirmLogout} onConfirm={() => { confirmLogout.close(); logout(); }} />
    </div></PageHeadingContext.Provider>
  );
}
