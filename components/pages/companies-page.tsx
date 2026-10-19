'use client';

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Building2, CalendarDays, Eye, LogIn, Mail, ScrollText, Search, UserRound, UsersRound, X } from 'lucide-react';
import { DeployPanel } from '@/components/app/deploy-panel';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/app/primitives';
import { SettingsPagination } from '@/components/settings/settings-pagination';
import { dateOnly, initials, number } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useManage, useSession } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { CompanySummary } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

/** Company directory and Login As; account and Company mutations stay in AutoAudit. */
export default function CompaniesPage({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { enter } = useManage();
  const { user } = useSession();
  const companies = useData((signal) => api.get<CompanySummary[]>('/admin/companies', signal), []);
  const [search, setSearch] = useState('');
  const [paging, setPaging] = useState({ query: '', page: 1 });
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<CompanySummary | null>(null);
  const query = search.trim().toLocaleLowerCase('id-ID');
  const filtered = (companies.data ?? []).filter((company) => [company.name, company.autoaudit_company_name, ...company.users.flatMap((account) => [account.display_name, account.email])].join(' ').toLocaleLowerCase('id-ID').includes(query));
  const page = Math.min(paging.query === query ? paging.page : 1, Math.max(1, Math.ceil(filtered.length / pageSize)));
  return <div className="general-settings companies-page">
    <header className="companies-toolbar">
      <div className="team-search"><Search className="size-4 shrink-0" aria-hidden="true" /><input type="search" aria-label="Cari perusahaan" placeholder="Cari perusahaan, nama admin, atau email…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Hapus pencarian" onClick={() => setSearch('')}><X className="size-4" /></button>}</div>
      <a className="text-accent underline" href={`${user.autoaudit_url || ''}/dashboard/companies`}>Kelola Company di AutoAudit</a>
    </header>
    <ErrorNotice message={companies.error} onRetry={companies.reload} />
    {companies.loading && !companies.data && <LoadingRows rows={3} />}
    {companies.data && <div className="companies-data">
      <div className="companies-list">{!companies.data.length ? <EmptyState title="Belum ada perusahaan" description="Kelola perusahaan melalui AutoAudit." /> : !filtered.length ? <EmptyState compact title="Perusahaan tidak ditemukan" description="Coba nama perusahaan, admin, atau email lainnya." /> : <ul>{filtered.slice((page - 1) * pageSize, page * pageSize).map((company) => {
        const admin = company.users.find((account) => account.role === 'company_admin') ?? company.users[0];
        return <li key={company.company_id} className="company-summary-card">
          <div className="company-summary-logo"><span aria-label={`Inisial ${company.name}`}>{initials(company.name)}</span><span className="company-source-badge" data-autoaudit={Boolean(company.autoaudit_company_id)}>{company.autoaudit_company_id ? 'AutoAudit' : 'Lokal'}</span></div>
          <div className="company-summary-identity"><h2 title={company.name}>{company.name}</h2><div className="company-summary-contact"><div className="company-summary-admin"><UsersRound size={14} aria-hidden="true" /><span title={admin?.display_name}>{admin?.display_name ?? 'Belum ada akun'}</span></div><div className="company-summary-admin"><Mail size={14} aria-hidden="true" /><span title={admin?.email}>{admin?.email ?? '—'}</span></div></div><div className="company-summary-setting"><span className="company-keyword-setting"><strong>Kata kunci:</strong><span>{company.search_locked ? 'Dikunci' : 'Tidak dikunci'}</span></span><span className="company-setting-separator" aria-hidden="true">·</span><div className="company-summary-integration"><strong>Integrasi AutoAudit:</strong><span title={company.autoaudit_company_name ?? undefined}>{company.autoaudit_company_name ?? 'Belum dihubungkan'}</span></div></div></div>
          <dl className="company-summary-stats"><div><dt><UsersRound className="company-stat-icon" aria-hidden="true" /><span>Buyer</span></dt><dd>{number(company.buyers)}</dd></div><div><dt><Building2 className="company-stat-icon" aria-hidden="true" /><span>Listing</span></dt><dd>{number(company.listings)}</dd></div><div><dt><UserRound className="company-stat-icon" aria-hidden="true" /><span>Akun</span></dt><dd>{number(company.users.length)}</dd></div></dl>
          <div className="company-summary-controls"><div className="company-summary-buttons"><Button isDisabled={!company.owner_id} onPress={() => company.owner_id && enter({ userId: company.owner_id, name: company.name })}><LogIn className="size-4" aria-hidden="true" />Login As</Button><Button variant="secondary" onPress={() => setDetail(company)}><Eye className="size-4" aria-hidden="true" />Detail akun</Button></div><Button variant="tertiary" onPress={() => navigate?.('aktivitas', { company: company.company_id })}><ScrollText size={14} aria-hidden="true" />Aktivitas</Button></div>
        </li>;
      })}</ul>}</div>
      {!!filtered.length && <SettingsPagination total={filtered.length} page={page} pageSize={pageSize} label="perusahaan" onPage={(next) => setPaging({ query, page: next })} onPageSize={(size) => { setPageSize(size); setPaging({ query, page: 1 }); }} />}
    </div>}
    <Modal.Backdrop isOpen={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>Detail {detail?.name}</Modal.Heading></Modal.Header><Modal.Body className="sales-dialog-body">{detail && (detail.users.length ? <ul className="company-detail-users">{detail.users.map((account) => <li key={account.id}><div className="company-detail-account-heading"><strong>{account.display_name}</strong><span className="company-detail-status" data-locked={account.is_locked}>{account.is_locked ? 'Terkunci' : 'Aktif'}</span></div><div className="company-detail-account-info"><span><Mail size={14} aria-hidden="true" />{account.email}</span><span><UserRound size={14} aria-hidden="true" />{account.role === 'admin' ? 'Administrator platform' : account.role === 'company_admin' ? 'Admin Company' : 'Anggota'}</span></div><p className="company-detail-joined"><CalendarDays size={14} aria-hidden="true" />Bergabung {dateOnly(account.created_at)}</p></li>)}</ul> : <EmptyState compact title="Belum ada akun" />)}</Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
    <DeployPanel />
  </div>;
}
