'use client';
import { useCompany, useManage, useSession } from '@/lib/session';
import { useApi } from '@/lib/workspace-context';
import { useData } from '@/lib/use-data';
import { Button } from '@heroui/react';
import type { CompanySummary, AutoAuditSources } from '@/lib/types';
import { DeployPanel } from '@/components/app/deploy-panel';

export function AutoAuditSettingsLink({ team = false }: { team?: boolean }) {
  const { user } = useSession();
  const { company } = useCompany();
  const path = team ? '/dashboard/profile-company' : `/dashboard/property/settings${company?.autoaudit_company_id ? `?company_id=${company.autoaudit_company_id}` : ''}`;
  return <section className="xm-card space-y-4 p-6"><h1 className="text-xl font-semibold">{team ? 'Tim & Akses' : 'Pengaturan Property'}</h1><p>Pengaturan dikelola melalui AutoAudit. Perubahan tetap memakai aturan Property yang sama.</p><a className="inline-flex rounded-xl bg-brand px-4 py-3 text-white" href={`${user.autoaudit_url || ''}${path}`}>Buka {team ? 'Team Access' : 'pengaturan'} di AutoAudit</a></section>;
}

export function PropertyDirectory() {
  const api = useApi();
  const { enter } = useManage();
  const { user } = useSession();
  const data = useData((signal) => api.get<CompanySummary[]>('/admin/companies', signal), []);
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Perusahaan</h1><a className="text-accent underline" href={`${user.autoaudit_url || ''}/dashboard/companies`}>Kelola Company di AutoAudit</a>{data.loading && <p>Memuat perusahaan…</p>}{data.error && <p role="alert">{String(data.error)}</p>}<ul className="space-y-3">{data.data?.map((company) => <li className="xm-card flex items-center justify-between gap-4 p-4" key={company.company_id}><span>{company.name}</span><Button isDisabled={!company.owner_id} onPress={() => company.owner_id && enter({ userId: company.owner_id, name: company.name })}>Buka workspace</Button></li>)}</ul><DeployPanel /></div>;
}

export function PropertySources() {
  const api = useApi();
  const state = useData((signal) => api.get<AutoAuditSources>('/autoaudit/sources', signal), []);
  return <div className="space-y-4"><AutoAuditSettingsLink /><Button variant="secondary" onPress={state.reload}>Muat ulang status sumber</Button>{state.error && <p role="alert">{state.error}</p>}<ul>{state.data?.sources.map((source) => <li key={source.id} className="border-b py-3">{source.sales_name} — {source.status}{source.last_error ? `: ${source.last_error}` : ''}</li>)}</ul></div>;
}
