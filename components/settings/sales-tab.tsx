'use client';

import { useState } from 'react';
import { Button, Chip, useOverlayState } from '@heroui/react';
import { PhoneCall } from 'lucide-react';
import { EmptyState, Panel } from '@/components/app/primitives';
import { TrackedEditor } from '@/components/app/tracked-editor';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { formatPhone } from '@/lib/format';
import type { Navigate } from '@/lib/router';
import { useCompany } from '@/lib/session';
import { useData } from '@/lib/use-data';
import type { StockOverview } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

/** The company-wide list of sales numbers whose stock is logged automatically. */
export function SalesTab({ navigate }: { navigate?: Navigate }) {
  const api = useApi();
  const { company, refresh } = useCompany();
  const admin = !!company?.permissions.manage_settings;
  const [tick, setTick] = useState(0);
  const editor = useOverlayState();
  const overview = useData((signal) => api.get<StockOverview>('/stock/overview', signal), [tick]);
  const tracked = overview.data?.tracked ?? [];

  return (
    <div className="space-y-5">
      <Panel title={<span className="flex items-center gap-2"><PhoneCall className="size-5 text-accent" aria-hidden="true" />Nomor sales yang dipantau</span>}
        description="Masukkan banyak nomor sekaligus, dipisahkan koma. Sistem mencatat otomatis berapa listing milik tiap nomor setiap kali data diunggah atau status listing berubah. Berlaku untuk seluruh company."
        action={admin ? <ShimmerButton onClick={() => editor.open()} background="oklch(0.48 0.235 265)" borderRadius="14px" className="h-11 px-5 font-semibold">Atur nomor</ShimmerButton> : undefined}>
        {tracked.length === 0 ? (
          <EmptyState compact animation="searching" title="Belum ada nomor yang dipantau" description={admin ? 'Ketuk “Atur nomor” lalu tempel nomor, mis. 6282233744657, 6281202310022.' : 'Super admin company dapat menambahkan nomor.'} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tracked.map((item) => (
              <li key={item.phone} className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3.5">
                <div className="min-w-0"><p className="truncate text-base font-bold">{item.label || item.contact_name || 'Sales'}</p><p className="text-base text-muted">{formatPhone(item.phone)}</p></div>
                <Chip variant="soft" color="success" size="lg">{item.counts.ready} ready</Chip>
              </li>
            ))}
          </ul>
        )}
        {tracked.length > 0 && <Button className="mt-4" variant="secondary" size="lg" onPress={() => navigate?.('stok')}>Buka halaman Stok Sales</Button>}
      </Panel>
      <TrackedEditor state={editor} current={tracked} onSaved={() => { setTick((value) => value + 1); refresh(); }} />
    </div>
  );
}
