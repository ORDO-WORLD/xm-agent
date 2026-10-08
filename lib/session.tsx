'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LOCKED_EVENT, UNAUTHORIZED_EVENT } from '@/lib/api';
import type { CompanySettings, Stats, User } from '@/lib/types';
import { useApi, WorkspaceProvider } from '@/lib/workspace-context';

/* ------------------------------------------------------------------ session */

type SessionValue = {
  user: User;
  logout: () => void;
};
const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionGate>');
  return value;
}

async function fetchMe() {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Aplikasi belum siap');
  return (await response.json()) as User;
}

/** Owns the login state: signed out, locked, or an account that may work. */
export function useAuth() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const refresh = () => { void fetchMe().then((next) => { setUser(next); setFailed(false); }).catch(() => {}); };
    void fetchMe().then(setUser).catch(() => { setFailed(true); setUser(null); });
    // A locked or unlocked account must be noticed quickly, without a reload.
    const timer = window.setInterval(refresh, 5000);
    const onUnauthorized = () => setUser(null);
    const onLocked = () => setUser((current) => (current ? { ...current, is_locked: true } : current));
    window.addEventListener('focus', refresh);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(LOCKED_EVENT, onLocked);
    };
  }, []);

  const logout = useCallback(() => {
    try { window.sessionStorage.removeItem(MANAGE_KEY); } catch { /* private mode */ }
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => { window.location.hash = ''; setUser(null); });
  }, []);
  return { user, setUser, logout, failed };
}

export function SessionProvider({ user, logout, children }: { user: User; logout: () => void; children: ReactNode }) {
  const value = useMemo(() => ({ user, logout }), [user, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/* ------------------------------------------------- platform admin: acting in a company */

const MANAGE_KEY = 'xm.manage';
export type ManageTarget = { userId: string; name: string };
type ManageValue = { target: ManageTarget | null; enter: (target: ManageTarget) => void; leave: () => void };
const ManageContext = createContext<ManageValue>({ target: null, enter: () => {}, leave: () => {} });
export const useManage = () => useContext(ManageContext);

/** Remembers which company the platform admin is working in, per browser tab. */
export function ManageProvider({ user, children }: { user: User; children: ReactNode }) {
  // Rendered only after sign-in, on the client, so sessionStorage can be read right away.
  const [target, setTarget] = useState<ManageTarget | null>(() => {
    if (user.role !== 'admin') return null;
    try {
      const saved = window.sessionStorage.getItem(MANAGE_KEY);
      return saved ? (JSON.parse(saved) as ManageTarget) : null;
    } catch { return null; }
  });

  const enter = useCallback((next: ManageTarget) => {
    try { window.sessionStorage.setItem(MANAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setTarget(next);
    window.location.hash = '/beranda';
  }, []);
  const leave = useCallback(() => {
    try { window.sessionStorage.removeItem(MANAGE_KEY); } catch { /* ignore */ }
    setTarget(null);
    window.location.hash = '/perusahaan';
  }, []);
  const value = useMemo(() => ({ target, enter, leave }), [target, enter, leave]);
  return (
    <ManageContext.Provider value={value}>
      {/* Remount everything when the company changes so no data of the old one lingers. */}
      <WorkspaceProvider key={target?.userId ?? user.id} userId={target?.userId ?? user.id}>{children}</WorkspaceProvider>
    </ManageContext.Provider>
  );
}

/* ----------------------------------------------------------- company context */

type CompanyValue = {
  company: CompanySettings | undefined;
  stats: Stats | undefined;
  unseen: number;
  unseenHot: number;
  refresh: () => void;
  markSeen: () => void;
};
const CompanyContext = createContext<CompanyValue | null>(null);
export function useCompany() {
  const value = useContext(CompanyContext);
  if (!value) throw new Error('useCompany must be used inside <CompanyProvider>');
  return value;
}

type RecentSummary = { unseen: number; unseen_hot: number };

/** Company settings, headline counters and the "new matches" badge; refreshed in the background. */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [company, setCompany] = useState<CompanySettings>();
  const [stats, setStats] = useState<Stats>();
  const [summary, setSummary] = useState<RecentSummary>({ unseen: 0, unseen_hot: 0 });
  const alive = useRef(true);

  const refresh = useCallback(() => {
    void api.get<CompanySettings>('/company/settings').then((value) => { if (alive.current) setCompany(value); }).catch(() => {});
    void api.get<Stats>('/stats').then((value) => { if (alive.current) setStats(value); }).catch(() => {});
    void api.get<RecentSummary>('/matches/recent/summary').then((value) => { if (alive.current) setSummary(value); }).catch(() => {});
  }, [api]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [refresh]);

  const markSeen = useCallback(() => {
    void api.post('/matches/recent/seen').then(() => { if (alive.current) setSummary({ unseen: 0, unseen_hot: 0 }); }).catch(() => {});
  }, [api]);

  const value = useMemo(() => ({ company, stats, unseen: summary.unseen, unseenHot: summary.unseen_hot, refresh, markSeen }),
    [company, stats, summary, refresh, markSeen]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

