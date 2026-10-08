'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { readResponse } from '@/lib/api';

const WorkspaceContext = createContext<string | undefined>(undefined);

/** The platform administrator can act inside a company; everyone else stays in their own. */
export function WorkspaceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <WorkspaceContext.Provider value={userId}>{children}</WorkspaceContext.Provider>;
}

type Options = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit | null };

/** The owner is captured per mounted workspace, never in a global mutable header. */
export function useWorkspaceFetch() {
  const userId = useContext(WorkspaceContext);
  return useCallback((path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (userId) headers.set('X-XM-User-Id', userId);
    return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  }, [userId]);
}

/** Typed JSON helper over the workspace-scoped fetch. */
export function useApi() {
  const workspaceFetch = useWorkspaceFetch();
  return useMemo(() => {
    async function call<T>(path: string, options: Options = {}) {
      const { json, headers, ...rest } = options;
      const finalHeaders = new Headers(headers);
      let body = rest.body;
      if (json !== undefined) {
        finalHeaders.set('Content-Type', 'application/json');
        body = JSON.stringify(json);
      }
      return readResponse<T>(await workspaceFetch(path, { ...rest, body, headers: finalHeaders }));
    }
    return {
      get: <T,>(path: string, signal?: AbortSignal) => call<T>(path, { signal }),
      post: <T,>(path: string, json?: unknown, signal?: AbortSignal) => call<T>(path, { method: 'POST', json: json ?? {}, signal }),
      put: <T,>(path: string, json?: unknown) => call<T>(path, { method: 'PUT', json: json ?? {} }),
      del: <T,>(path: string) => call<T>(path, { method: 'DELETE' }),
      form: <T,>(path: string, data: FormData) => call<T>(path, { method: 'POST', body: data }),
      blob: async (path: string, json: unknown) => {
        const response = await workspaceFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
        if (!response.ok) await readResponse(response);
        return response.blob();
      },
    };
  }, [workspaceFetch]);
}
