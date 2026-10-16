'use client';

import type { ReactNode } from 'react';
import { CompanyShell } from '@/components/app/company-shell';
import type { Navigate } from '@/lib/router';

/** Shared navigation frame; role-specific menus and company context stay in the shell. */
export function AppShell({ route, navigate, children }: { route: string; navigate: Navigate; children: ReactNode }) {
  return <CompanyShell route={route} navigate={navigate}>{children}</CompanyShell>;
}
