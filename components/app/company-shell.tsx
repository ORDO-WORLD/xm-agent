'use client';

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { AlertDialog, Avatar, Button, Drawer, Dropdown, Label, useOverlayState } from '@heroui/react';
import Image from 'next/image';
import { ArrowLeft, Boxes, Building2, ChevronDown, ChevronsLeft, ChevronsRight, House, LayoutDashboard, LogOut, Menu, Search, ScrollText, Settings, Sparkles, UploadCloud, Users, Workflow, X } from 'lucide-react';
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
  const profileMenu = useOverlayState();
  const [menuQuery, setMenuQuery] = useState('');
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1001px)');
    const onResize = () => { if (desktop.matches) menu.setOpen(false); };
    desktop.addEventListener('change', onResize);
    return () => desktop.removeEventListener('change', onResize);
  }, [menu]);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
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
  useEffect(() => {
    const previousTitle = document.title;
    const menuTitle = `Property AutoAudit | ${title}`;
    document.title = menuTitle;
    return () => {
      if (document.title === menuTitle) document.title = previousTitle;
    };
  }, [route, title]);
  const go = (path: string) => { menu.close(); navigate(path); };
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem('xm.sidebar.collapsed', next ? '1' : '0'); } catch { /* private mode */ }
  };
  const groups = [
    { id: 'utama', label: 'Menu Utama', items: MAIN },
    { id: 'kelola', label: 'Kelola', items: manage },
    { id: 'platform', label: 'Platform', items: platform },
  ].filter((group) => group.items.length > 0);
  const mobileGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLocaleLowerCase('id').includes(menuQuery.trim().toLocaleLowerCase('id'))) })).filter((group) => group.items.length > 0);
  const links = (compact: boolean, scope: string) => groups.map((group) => {
    const open = compact || !closedGroups[`${scope}-${group.id}`];
    const listId = `${scope}-menu-${group.id}`;
    return (
      <section key={group.id} className={cn('company-nav-group', compact && 'is-compact')} aria-label={group.label}>
        {!compact && <button type="button" className="company-menu-group" aria-expanded={open} aria-controls={listId}
          onClick={() => setClosedGroups((current) => ({ ...current, [`${scope}-${group.id}`]: open }))}>
          <span>{group.label}</span><ChevronDown className={cn('size-4', !open && 'is-closed')} aria-hidden="true" />
        </button>}
        <div id={listId} className="company-menu-list" hidden={!open}>{group.items.map((item) => navLink(item, compact))}</div>
      </section>
    );
  });
  function navLink(item: (typeof MAIN)[number], compact: boolean) {
    const Icon = item.icon;
    const badge = item.id === 'match-baru' ? unseen : 0;
    return (
      <button type="button" key={item.id} onClick={() => go(item.id)}
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
          <div className="company-sidebar-brand-row">
            <button type="button" onClick={() => go('beranda')} aria-label="Ke Beranda" className="company-sidebar-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={collapsed ? '/brand-auto-audit-icon.png' : '/brand-auto-audit.png'} alt="AutoAudit" className="h-10 w-auto object-contain" />
            </button>
            <button type="button" className="company-sidebar-toggle" onClick={toggle} aria-label={collapsed ? 'Perluas sidebar' : 'Kecilkan sidebar'} aria-expanded={!collapsed}>
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          </div>
          {!collapsed && <span className="company-product-badge"><House size={16} className="shrink-0" aria-hidden="true" />Agent Developer</span>}
        </div>
        <nav className="company-sidebar-nav" aria-label="Menu utama">{links(collapsed, 'desktop')}</nav>
      </aside>

      <header className="company-navbar">
        <button type="button" className="company-mobile-logo" onClick={() => go('beranda')} aria-label="Ke Beranda">
          <Image src="/brand-auto-audit.png" alt="AutoAudit" width={143} height={59} unoptimized />
        </button>
        <div className={cn('company-navbar-heading', pageHeading?.onBack && 'has-back')}>
          {pageHeading?.onBack && <button type="button" className="company-navbar-back" aria-label={`Kembali dari ${pageHeading.title}`} onClick={pageHeading.onBack}><ArrowLeft size={20} aria-hidden="true" /></button>}
          <h1 className="company-navbar-title">{pageHeading?.title ?? title}</h1>
        </div>
        <div className="company-desktop-profile"><Dropdown isOpen={profileMenu.isOpen} onOpenChange={(open) => profileMenu.setOpen(open)}>
          <Dropdown.Trigger className="company-profile-trigger" aria-label="Buka menu profil">
            <Avatar size="sm" className="company-profile-avatar" style={{ backgroundColor: avatarColor, color: '#fff' }}><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
            <span className="company-profile-details"><span className="company-profile-name">{user.display_name}</span><span className="company-profile-email">{user.email}</span></span>
            <ChevronDown className={cn('company-profile-chevron', profileMenu.isOpen && 'is-open')} aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end" offset={8} className="company-profile-menu">
            <Dropdown.Menu aria-label="Menu akun" onAction={() => confirmLogout.open()}>
              <Dropdown.Item id="logout" textValue="Logout" variant="danger"><LogOut className="size-3.5 text-danger" aria-hidden="true" /><Label>Logout</Label></Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown></div>
        <div className="company-mobile-account">
          <button type="button" onClick={() => { setMenuQuery(''); menu.open(); }} aria-label="Buka menu akun" aria-expanded={menu.isOpen} aria-controls="company-mobile-menu">
            <Avatar className="company-profile-avatar" style={{ backgroundColor: avatarColor, color: '#fff' }}><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
          </button>
          <button type="button" onClick={() => { setMenuQuery(''); menu.open(); }} aria-label="Buka menu navigasi" aria-expanded={menu.isOpen} aria-controls="company-mobile-menu"><Menu size={16} aria-hidden="true" /></button>
        </div>
      </header>

      <main className="company-content"><div className="company-content-inner">
        <div className="company-mobile-page-heading">
          {pageHeading?.onBack && <button type="button" className="company-navbar-back" aria-label={`Kembali dari ${pageHeading.title}`} onClick={pageHeading.onBack}><ArrowLeft size={20} aria-hidden="true" /></button>}
          <h1>{pageHeading?.title ?? title}</h1>
        </div>
        {user.role === 'admin' && target && <section className="company-managing-banner" aria-label="Company yang sedang dikelola"><p className="flex min-w-0 items-center gap-2"><Building2 className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">Mengelola: <span className="font-medium">{target.name}</span></span></p><Button variant="secondary" size="sm" className="shrink-0" onPress={leave}>Semua perusahaan</Button></section>}
        {children}
      </div></main>

      <Drawer.Backdrop isOpen={menu.isOpen} onOpenChange={(open) => menu.setOpen(open)} className="company-mobile-backdrop">
        <Drawer.Content placement="right" className="company-mobile-content"><Drawer.Dialog id="company-mobile-menu" aria-label="Menu akun dan navigasi" className="company-mobile-drawer">
          <Drawer.Header className="company-mobile-header">
            <button type="button" className="company-mobile-logout" aria-label="Logout" onClick={() => { menu.close(); confirmLogout.open(); }}><LogOut size={20} aria-hidden="true" /></button>
            <button type="button" className="company-mobile-identity" onClick={() => go('pengaturan')} aria-label="Buka pengaturan akun">
              <Avatar className="company-mobile-avatar" style={{ backgroundColor: avatarColor, color: '#fff' }}><Avatar.Fallback>{initials(user.display_name)}</Avatar.Fallback></Avatar>
              <span className="company-mobile-identity-text"><span>{user.company_name || user.display_name}</span><span>{user.email}</span></span>
            </button>
            <button type="button" className="company-mobile-close" aria-label="Tutup menu" onClick={() => menu.close()}><X size={20} aria-hidden="true" /></button>
          </Drawer.Header>
          <Drawer.Body className="company-mobile-body">
            <div className="company-mobile-search"><Search size={16} aria-hidden="true" /><input aria-label="Cari menu" placeholder="Cari menu..." value={menuQuery} onChange={(event) => setMenuQuery(event.target.value)} />{menuQuery && <button type="button" aria-label="Hapus pencarian" onClick={() => setMenuQuery('')}><X size={14} aria-hidden="true" /></button>}</div>
            <nav aria-label="Menu utama mobile">
              {mobileGroups.map((group) => <section key={group.id} className="company-mobile-group" aria-label={group.label}>
                <h2>{group.label}</h2><div className="company-mobile-grid">{group.items.map((item) => {
                  const Icon = item.icon;
                  return <button type="button" key={item.id} className={cn('company-mobile-tile', route === item.id && 'is-active')} aria-current={route === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                    <span className="company-mobile-tile-icon"><Icon size={20} aria-hidden="true" />{item.id === 'match-baru' && unseen > 0 && <span className="company-menu-badge">{unseen > 99 ? '99+' : unseen}<span className="sr-only"> match belum dilihat</span></span>}</span><span>{item.label}</span>
                  </button>;
                })}</div>
              </section>)}
              {mobileGroups.length === 0 && <p className="company-mobile-empty">Menu tidak ditemukan.</p>}
            </nav>
          </Drawer.Body>
        </Drawer.Dialog></Drawer.Content>
      </Drawer.Backdrop>
      <CompanyLogoutDialog state={confirmLogout} onConfirm={() => { confirmLogout.close(); logout(); }} />
    </div></PageHeadingContext.Provider>
  );
}
