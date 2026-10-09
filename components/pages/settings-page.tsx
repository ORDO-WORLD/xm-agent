'use client';

import { Tabs } from '@heroui/react';
import { AccountTab } from '@/components/settings/account-tab';
import { IntegrationTab } from '@/components/settings/integration-tab';
import { useCompany } from '@/lib/session';
import { GeneralTab } from '@/components/settings/general-tab';
import { MatchingTab } from '@/components/settings/matching-tab';
import { SalesTab } from '@/components/settings/sales-tab';
import { PageHeader } from '@/components/app/primitives';
import { useRoute, type Navigate } from '@/lib/router';

const TABS = [
  { id: 'umum', label: 'Umum' },
  { id: 'pencocokan', label: 'Pencocokan' },
  { id: 'sales', label: 'Pantau Sales' },
  { id: 'akun', label: 'Akun saya' },
] as const;

export default function SettingsPage({ params, navigate }: { params?: URLSearchParams; navigate?: Navigate }) {
  const { navigate: go } = useRoute();
  const { company } = useCompany();
  const admin = !!company?.permissions.manage_settings;
  const tabs = [...TABS, ...(admin ? [{ id: 'integrasi', label: 'Integrasi workflow' }] : [])];
  const active = tabs.some((tab) => tab.id === params?.get('tab')) ? (params?.get('tab') as string) : 'umum';
  return (
    <div>
      <PageHeader title="Pengaturan" description="Atur kata kunci, pengelompokan listing, nomor sales yang dipantau, aturan pencocokan, dan koneksi workflow." />
      <Tabs selectedKey={active} onSelectionChange={(key) => (navigate ?? go)('pengaturan', { tab: String(key) })} variant="secondary">
        <Tabs.ListContainer className="xm-scroll-x mb-5 max-w-full">
          <Tabs.List aria-label="Bagian pengaturan">
            {tabs.map((tab) => <Tabs.Tab key={tab.id} id={tab.id} className="min-h-11 px-4 text-base font-semibold">{tab.label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="umum"><GeneralTab /></Tabs.Panel>
        <Tabs.Panel id="pencocokan"><MatchingTab /></Tabs.Panel>
        <Tabs.Panel id="sales"><SalesTab navigate={navigate} /></Tabs.Panel>
        <Tabs.Panel id="akun"><AccountTab /></Tabs.Panel>
        {admin && <Tabs.Panel id="integrasi"><IntegrationTab /></Tabs.Panel>}
      </Tabs>
    </div>
  );
}
