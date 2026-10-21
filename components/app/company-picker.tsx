'use client';

import { ComboBox, Input, ListBox } from '@heroui/react';
import { Building2 } from 'lucide-react';
import { useManage } from '@/lib/session';
import type { CompanySummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The platform admin picks the company to work in, like the Companies select in AutoAudit. There is no "all companies". */
export function CompanyPicker({ companies, stay, className }: { companies: CompanySummary[] | undefined; stay: boolean; className?: string }) {
  const { target, enter } = useManage();
  const items = (companies ?? []).filter((company) => company.owner_id);
  const choose = (key: unknown) => {
    const company = items.find((item) => item.owner_id === key);
    if (company?.owner_id && company.owner_id !== target?.userId) enter({ userId: company.owner_id, name: company.name }, { stay });
  };
  return (
    <ComboBox className={cn('company-picker', className)} aria-label="Pilih company" value={target?.userId ?? null} onChange={choose} menuTrigger="focus" isDisabled={!companies}>
      <ComboBox.InputGroup>
        <Building2 className="company-picker-icon" aria-hidden="true" />
        <Input placeholder={companies ? 'Pilih company…' : 'Memuat company…'} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="activity-select-popover">
        <ListBox renderEmptyState={() => <p className="p-3 text-sm">Company tidak ditemukan.</p>}>
          {items.map((company) => <ListBox.Item key={company.owner_id} id={company.owner_id!} textValue={company.name}>{company.name}<ListBox.ItemIndicator /></ListBox.Item>)}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
