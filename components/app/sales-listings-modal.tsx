'use client';

import { useState } from 'react';
import { Accordion, Button, Chip, Modal, type useOverlayState } from '@heroui/react';
import { Building2, PhoneCall } from 'lucide-react';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/app/primitives';
import { errorMessage, query } from '@/lib/api';
import { dateTime, formatPhone, STATUS_LABELS } from '@/lib/format';
import type { EntityStatus, Row } from '@/lib/types';
import { useData } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

type Page = { rows: Row[]; has_more: boolean };
const TONE: Record<EntityStatus, 'success' | 'warning' | 'accent' | 'default'> = { ready: 'success', on_hold: 'warning', sold: 'accent', deleted: 'default' };

/** First non-empty line of the message: what an agent would call the headline of the listing. */
const headline = (text: string) => (text.split('\n').map((line) => line.trim()).find(Boolean) ?? '(tanpa judul)').slice(0, 140);

/** Listings of one tracked sales number, shown in place so the stock page is never left. */
export function SalesListingsModal({ state, phone, name }: { state: ReturnType<typeof useOverlayState>; phone: string; name: string }) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container placement="center" size="lg" scroll="inside">
        <Modal.Dialog className="general-settings sales-edit-dialog stock-listings-dialog">{state.isOpen && phone ? <Body key={phone} phone={phone} name={name} /> : null}</Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function Body({ phone, name }: { phone: string; name: string }) {
  const api = useApi();
  const [offset, setOffset] = useState(0);
  const [extra, setExtra] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const params = { direction: 'property', phones: phone, statuses: 'hot,warm,unmatched', stock_status: 'ready,on_hold,sold', search: '' };
  const first = useData((signal) => api.get<Page>(`/workspace?${query({ ...params, offset: 0 })}`, signal), [phone]);
  const rows = [...(first.data?.rows ?? []), ...extra];
  const hasMore = offset === 0 ? !!first.data?.has_more : more;

  async function loadMore() {
    if (busy) return;
    setBusy(true); setLoadError('');
    try {
      const next = rows.length;
      const page = await api.get<Page>(`/workspace?${query({ ...params, offset: next })}`);
      setExtra((current) => [...current, ...page.rows]); setOffset(next); setMore(page.has_more);
    } catch (reason) { setLoadError(errorMessage(reason, 'Listing berikutnya belum dapat dimuat.')); } finally { setBusy(false); }
  }

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading className="flex items-start gap-2"><Building2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">Listing {name}</span></Modal.Heading><p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><PhoneCall className="size-3.5" aria-hidden="true" />{formatPhone(phone)}</p></Modal.Header>
      <Modal.Body className="sales-dialog-body space-y-3">
        {first.error && <ErrorNotice message={errorMessage(first.error)} onRetry={first.reload} />}
        {first.loading && <LoadingRows rows={4} />}
        {!first.loading && !first.error && rows.length === 0 && <EmptyState compact animation="empty-box" title="Belum ada listing" description="Tidak ada listing aktif dengan nomor ini." />}
        {rows.length > 0 && (
          <Accordion allowsMultipleExpanded className="stock-listing-accordion w-full">
            {rows.map((row) => (
              <Accordion.Item key={row.id} id={row.id}>
                <Accordion.Heading>
                  <Accordion.Trigger className="items-start gap-3 py-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {row.public_id && <span className="font-mono text-xs font-semibold text-accent">{row.public_id}</span>}
                        <Chip size="sm" color={TONE[row.entity_status ?? 'ready']} variant="soft">{STATUS_LABELS[row.entity_status ?? 'ready']}</Chip>
                        {row.sent_at && <span className="text-xs text-muted">{dateTime(row.sent_at, false)}</span>}
                      </span>
                      <span className="mt-1.5 block text-sm font-medium leading-snug">{headline(row.raw_text)}</span>
                    </span>
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel><Accordion.Body><p className="stock-listing-message whitespace-pre-wrap text-sm leading-relaxed">{row.raw_text}</p></Accordion.Body></Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
        {loadError && <ErrorNotice message={loadError} onRetry={loadMore} />}
        {hasMore && <Button variant="secondary" fullWidth isPending={busy} onPress={loadMore}>Tampilkan lebih banyak</Button>}
      </Modal.Body>
      <Modal.Footer className="stock-listings-footer"><span className="text-xs text-muted">{first.loading ? 'Memuat listing...' : `${rows.length} listing ditampilkan`}</span><Button slot="close" variant="secondary">Tutup</Button></Modal.Footer>
    </>
  );
}
