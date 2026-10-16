'use client';

import { Tabs, useOverlayState } from '@heroui/react';
import { AccountTab } from '@/components/settings/account-tab';
import { IntegrationTab } from '@/components/settings/integration-tab';
import { useCompany } from '@/lib/session';
import { GeneralTab } from '@/components/settings/general-tab';
import { MatchingTab } from '@/components/settings/matching-tab';
import { SalesTab } from '@/components/settings/sales-tab';
import { SectionSearchScope, SettingsSearchLayout, SettingsTabToolbar } from '@/lib/section-search';
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
  const salesEditor = useOverlayState();
  const tabs = [...TABS, ...(admin ? [{ id: 'integrasi', label: 'Integrasi workflow' }] : [])];
  const active = tabs.some((tab) => tab.id === params?.get('tab')) ? (params?.get('tab') as string) : 'umum';
  return (
    <div className="settings-page">
      <SettingsSearchLayout activeTab={active} tabLabel={tabs.find((tab) => tab.id === active)?.label ?? 'Umum'}>
      <Tabs className="settings-tabs" selectedKey={active} onSelectionChange={(key) => (navigate ?? go)('pengaturan', { tab: String(key) })} variant="secondary">
        <Tabs.ListContainer className="xm-scroll-x max-w-full">
          <Tabs.List aria-label="Bagian pengaturan">
            {tabs.map((tab) => <Tabs.Tab key={tab.id} id={tab.id}>{tab.label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
        <SettingsTabToolbar />
        <Tabs.Panel id="umum"><SectionSearchScope tab="umum"><GeneralTab /></SectionSearchScope></Tabs.Panel>
        <Tabs.Panel id="pencocokan"><SectionSearchScope tab="pencocokan"><MatchingTab /></SectionSearchScope></Tabs.Panel>
        <Tabs.Panel id="sales"><SectionSearchScope tab="sales"><SalesTab navigate={navigate ?? go} editor={salesEditor} /></SectionSearchScope></Tabs.Panel>
        <Tabs.Panel id="akun"><SectionSearchScope tab="akun"><AccountTab /></SectionSearchScope></Tabs.Panel>
        {admin && <Tabs.Panel id="integrasi"><SectionSearchScope tab="integrasi"><IntegrationTab /></SectionSearchScope></Tabs.Panel>}
      </Tabs>
      </SettingsSearchLayout>
    </div>
  );
}
