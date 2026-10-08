'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Tiny hash router: `#/cocokkan?arah=property`. Works with a static export and keeps the back button useful. */
export type Route = { path: string; params: URLSearchParams };
export type Navigate = (path: string, params?: Record<string, string | undefined>) => void;

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
const snapshot = () => window.location.hash;
const serverSnapshot = () => '';

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return { path: path || 'beranda', params: new URLSearchParams(search) };
}

export function buildHash(path: string, params?: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value) search.set(key, value);
  const text = search.toString();
  return `#/${path}${text ? `?${text}` : ''}`;
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const route = useMemo(() => parseHash(hash), [hash]);
  const navigate = useCallback((path: string, params?: Record<string, string | undefined>) => {
    window.location.hash = buildHash(path, params);
    window.scrollTo({ top: 0 });
  }, []);
  return { ...route, navigate };
}
