'use client';

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { ArrowRight, Download } from 'lucide-react';
import { EmptyState, ErrorNotice, IdChip, LoadingIndicator, LoadingRows, StatusChip } from '@/components/app/primitives';
import { StatusMenu } from '@/components/app/status-menu';
import { DuplicateNote, RawChat, RecommendationCard, WhatsAppButton } from '@/components/match/cards';
import { query } from '@/lib/api';
import { cleanName, dateTime, formatPhone, number, structuredSummary } from '@/lib/format';
import type { Direction, EntityStatus, RecentGroup, RecentResponse, Row } from '@/lib/types';
import { useData } from '@/lib/use-data';
import { useApi } from '@/lib/workspace-context';

export function RecentDetailModal({ group, direction, filters, onClose, onStatus, onExport, onManual }: {
  group: RecentGroup; direction: Direction; filters: Record<string, string | boolean>;
  onClose: () => void; onStatus: (row: Row, status: EntityStatus) => void;
  onExport: (events?: number[]) => void; onManual?: () => void;
}) {
  const api = useApi();
  const [limit, setLimit] = useState(50);
  const [picked, setPicked] = useState<number[]>([]);
  // Only this source's counterparts are loaded after opening the gallery card.
  const data = useData(async (signal) => {
    const matches = [] as RecentGroup['matches'];
    let current: RecentGroup | undefined;
    for (let offset = 0; offset < limit; offset += 50) {
      const response = await api.get<RecentResponse>(`/matches/recent?${query({ ...filters, direction, source_entity: group.source.entity_id, per_source: 50, match_offset: offset, limit: 1 })}`, signal);
      current = response.groups[0];
      matches.push(...(current?.matches ?? []));
      if (!current || matches.length >= current.pair_count) break;
    }
    return current ? { ...current, matches } : null;
  }, [limit]);
  const source = data.data?.source ?? group.source;
  const matches = data.data?.matches ?? [];
  const count = data.data?.pair_count ?? group.pair_count;
  const sourceLabel = direction === 'buyer' ? 'Buyer' : 'Listing';
  const targetLabel = direction === 'buyer' ? 'listing' : 'buyer';
  const toggle = (id: number) => setPicked((values) => values.includes(id) ? values.filter((value) => value !== id) : values.length < 200 ? [...values, id] : values);

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container size="lg" scroll="inside" >
        <Modal.Dialog style={{ width: 'calc(100vw - 2rem)', maxWidth: 1280 }}>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Detail match terbaru</Modal.Heading><p className="mt-1 text-sm text-muted">{sourceLabel} {source.public_id} · {number(count)} pasangan pada tanggal yang dipilih</p></Modal.Header>
          <Modal.Body>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <section aria-label="Informasi sumber" className="rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Sumber · {sourceLabel}</h3><StatusMenu status={source.entity_status} name={`${sourceLabel} ${source.public_id}`} onChoose={(status) => onStatus(source, status)} /></div>
                <p className="mt-3 break-words text-lg font-bold">{cleanName(source.contact_name) || `${sourceLabel} tanpa nama`}</p>
                <div className="mt-2 flex flex-wrap gap-2"><IdChip id={source.public_id} kind={direction} /><StatusChip status={source.entity_status ?? 'ready'} /><DuplicateNote row={source} /></div>
                <p className="mt-4 text-base leading-relaxed">{structuredSummary(source)}</p>
                <dl className="my-4 space-y-2 text-sm">
                  <div><dt className="text-muted">Nomor kontak</dt><dd className="font-semibold">{formatPhone(source.contact_phone) || 'Belum tersedia'}</dd></div>
                  <div><dt className="text-muted">Tanggal posting</dt><dd>{dateTime(source.sent_at)}</dd></div>
                  <div><dt className="text-muted">Match ditemukan</dt><dd>{dateTime(group.latest_found_at)}</dd></div>
                  {source.author && <div><dt className="text-muted">Pengirim chat</dt><dd className="break-words">{source.author}</dd></div>}
                  {source.chat_name && <div><dt className="text-muted">Grup chat</dt><dd className="break-words">{source.chat_name}</dd></div>}
                </dl>
                <RawChat text={source.raw_text || source.normalized_text} />
                <div className="mt-4 border-t border-separator pt-3"><WhatsAppButton row={source} kind={direction} label={`WhatsApp ${direction === 'buyer' ? 'buyer' : 'pemilik listing'}`} /></div>
              </section>
              <section aria-label="Hasil pencocokan" className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Hasil · {number(count)} {targetLabel}</h3><Button variant="secondary" onPress={() => onExport()}>Export seluruh hasil PDF</Button></div>
                <p className="text-sm text-muted">Centang hasil untuk export pilihan. Hot tampil lebih dahulu.</p>
                <ErrorNotice message={data.error} onRetry={data.reload} />
                {data.loading && !data.data && <LoadingRows rows={2} />}
                {data.loading && data.data && <LoadingIndicator />}
                {!data.loading && data.data === null && <EmptyState compact title="Hasil sudah berubah" description="Pasangan ini tidak lagi memenuhi filter atau aturan perusahaan. Tutup detail untuk memuat ulang galeri." />}
                {matches.length > 0 && <div className="flex flex-wrap items-center gap-2"><Button variant="tertiary" isDisabled={data.loading} onPress={() => setPicked(matches.slice(0, 200).map((match) => match.event_id))}>Pilih hasil yang tampil</Button><Button variant="tertiary" onPress={() => setPicked([])}>Kosongkan</Button><span className="text-sm text-muted">{picked.length} dipilih{matches.length > 200 ? ' · maksimal 200 pilihan' : ''}</span></div>}
                <div aria-busy={data.loading} inert={data.loading} className="space-y-3">
                  {matches.map((match) => <RecommendationCard key={match.event_id} target={{ ...match.target, score: match.score }} source={source} direction={direction} checked={picked.includes(match.event_id)} onCheck={() => toggle(match.event_id)} onStatus={(status) => onStatus(match.target, status)} extra={<p className="mt-2 text-sm text-muted">Ditemukan {dateTime(match.found_at)}{match.upgraded_to_hot ? ' · Naik ke Hot' : ''}{match.agent_name ? ` · Upload ${match.agent_name}` : ''}</p>} />)}
                </div>
                {data.data && matches.length < count && !data.error && <Button variant="secondary" fullWidth isDisabled={data.loading} onPress={() => setLimit((value) => value + 50)}>Tampilkan hasil berikutnya ({matches.length} dari {number(count)})</Button>}
              </section>
            </div>
          </Modal.Body>
          <Modal.Footer className="flex flex-wrap justify-between gap-3 border-t border-separator">
            {onManual ? <Button variant="secondary" onPress={onManual}>Buka di Cocokkan<ArrowRight className="size-4" aria-hidden="true" /></Button> : <span />}
            <div className="flex flex-wrap gap-2"><Button variant="tertiary" onPress={onClose}>Tutup</Button><Button variant="primary" isDisabled={!picked.length || data.loading} onPress={() => onExport(picked)}><Download className="size-4" aria-hidden="true" />Export pilihan PDF{picked.length ? ` (${picked.length})` : ''}</Button></div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
