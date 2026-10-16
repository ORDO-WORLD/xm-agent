'use client';

import { useState } from 'react';
import { Avatar, Button, Modal } from '@heroui/react';
import { ArrowRight, ChevronDown, Download } from 'lucide-react';
import { EmptyState, ErrorNotice, IdChip, LoadingIndicator, LoadingRows, StatusChip } from '@/components/app/primitives';
import { StatusMenu } from '@/components/app/status-menu';
import { DuplicateNote, WhatsAppButton } from '@/components/match/cards';
import { PropertyDetails, RecentSourceCard } from '@/components/match/recent-source-card';
import { query } from '@/lib/api';
import { asWib, cleanName, dateTime, formatPhone, initials, number } from '@/lib/format';
import type { Direction, EntityStatus, RecentGroup, RecentMatch, RecentResponse, Row } from '@/lib/types';
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
      <Modal.Container placement="center" size="lg" scroll="inside">
        <Modal.Dialog className="general-settings sales-edit-dialog recent-detail-dialog">
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Detail match terbaru</Modal.Heading><p className="mt-1 text-sm text-muted">{sourceLabel} {source.public_id} · {number(count)} pasangan pada tanggal yang dipilih</p></Modal.Header>
          <Modal.Body className="sales-dialog-body recent-detail-body">
            <div className="recent-detail-layout">
              <section aria-label="Informasi sumber" className="recent-detail-source">
                <Avatar color="accent" className="recent-card-avatar"><Avatar.Fallback>{initials(cleanName(source.contact_name) || sourceLabel)}</Avatar.Fallback></Avatar>
                <p className="recent-detail-source-name">{cleanName(source.contact_name) || `${sourceLabel} tanpa nama`}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2"><IdChip id={source.public_id} kind={direction} /><StatusChip status={source.entity_status ?? 'ready'} /><span className="recent-source-badge">Sumber</span><DuplicateNote row={source} /></div>
                <div className="recent-source-property"><PropertyDetails row={source} direction={direction} /></div>
                <dl className="recent-detail-source-meta">
                  <div><dt className="text-muted">Nomor kontak</dt><dd className="font-semibold">{formatPhone(source.contact_phone) || 'Belum tersedia'}</dd></div>
                  <div><dt className="text-muted">Tanggal posting</dt><dd>{dateTime(source.sent_at)}</dd></div>
                  <div><dt className="text-muted">Match ditemukan</dt><dd>{dateTime(group.latest_found_at)}</dd></div>
                  {source.author && <div><dt className="text-muted">Pengirim chat</dt><dd className="break-words">{source.author}</dd></div>}
                  {source.chat_name && <div><dt className="text-muted">Grup chat</dt><dd className="break-words">{source.chat_name}</dd></div>}
                </dl>
                <OriginalMessage row={source} />
                <div className="recent-source-actions"><WhatsAppButton row={source} kind={direction} label={`WhatsApp ${direction === 'buyer' ? 'buyer' : 'pemilik listing'}`} branded /><StatusMenu status={source.entity_status} name={`${sourceLabel} ${source.public_id}`} onChoose={(status) => onStatus(source, status)} textTrigger /></div>
              </section>
              <section aria-label="Hasil pencocokan" className="recent-detail-results min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{number(count)} Hasil {targetLabel === 'listing' ? 'Listing' : 'Buyer'}</h3><Button variant="secondary" isDisabled={!picked.length || data.loading} onPress={() => onExport()}>Export seluruh hasil PDF</Button></div>
                <ErrorNotice message={data.error} onRetry={data.reload} />
                {data.loading && !data.data && <LoadingRows rows={2} />}
                {data.loading && data.data && <LoadingIndicator />}
                {!data.loading && data.data === null && <EmptyState compact title="Hasil sudah berubah" description="Pasangan ini tidak lagi memenuhi filter atau aturan perusahaan. Tutup detail untuk memuat ulang galeri." />}
                {matches.length > 0 && <div className="recent-detail-selection flex flex-wrap items-center gap-2"><Button variant="tertiary" isDisabled={data.loading} onPress={() => setPicked(matches.slice(0, 200).map((match) => match.event_id))}>Pilih hasil yang tampil</Button><Button variant="tertiary" onPress={() => setPicked([])}>Kosongkan</Button><span className="text-sm text-muted">{picked.length} dipilih{matches.length > 200 ? ' · maksimal 200 pilihan' : ''}</span></div>}
                <div aria-busy={data.loading} inert={data.loading} className="recent-detail-matches space-y-3">
                  {matches.map((match) => <DetailResultCard key={match.event_id} match={match} source={source} direction={direction} checked={picked.includes(match.event_id)} onCheck={() => toggle(match.event_id)} onStatus={(status) => onStatus(match.target, status)} />)}
                </div>
                {data.data && matches.length < count && !data.error && <Button variant="secondary" fullWidth isDisabled={data.loading} onPress={() => setLimit((value) => value + 50)}>Tampilkan hasil berikutnya ({matches.length} dari {number(count)})</Button>}
              </section>
            </div>
          </Modal.Body>
          <Modal.Footer className="recent-detail-footer flex flex-wrap justify-between gap-3 border-t border-separator">
            {onManual ? <Button variant="secondary" onPress={onManual}>Buka di Cocokkan<ArrowRight className="size-4" aria-hidden="true" /></Button> : <span />}
            <div className="flex flex-wrap gap-2"><Button variant="tertiary" onPress={onClose}>Tutup</Button><Button variant="primary" isDisabled={!picked.length || data.loading} onPress={() => onExport(picked)}><Download className="size-4" aria-hidden="true" />Export pilihan PDF{picked.length ? ` (${picked.length})` : ''}</Button></div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function OriginalMessage({ row }: { row: Row }) {
  const sent = asWib(row.sent_at);
  const sender = row.author || 'Pengirim tidak diketahui';
  return <details className="recent-inline-original"><summary>Baca pesan asli<ChevronDown className="size-4" aria-hidden="true" /></summary><div className="recent-wa-message"><span className="recent-wa-avatar">{initials(sender)}</span><div className="recent-wa-bubble"><p className="recent-wa-sender">{sender}</p><p className="recent-wa-text">{row.raw_text || row.normalized_text || 'Pesan asli belum tersedia.'}</p><time className="recent-wa-time" title={dateTime(row.sent_at)}>{sent ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(sent).replace('.', ':') : 'Waktu kirim tidak tersedia'}</time></div></div></details>;
}

function DetailResultCard({ match, source, direction, checked, onCheck, onStatus }: {
  match: RecentMatch; source: Row; direction: Direction; checked: boolean; onCheck: () => void; onStatus: (status: EntityStatus) => void;
}) {
  const [allReasons, setAllReasons] = useState(false);
  const targetDirection = direction === 'buyer' ? 'property' : 'buyer';
  const reasons = match.target.explanation || [];
  return <RecentSourceCard row={match.target} direction={targetDirection} foundAt={match.found_at} isNew={false} selected={checked} onSelect={onCheck} onStatus={onStatus} bulk={{ checked, onToggle: onCheck }} showDetailAction={false} showSeenBadge={false} temperature={Number(match.score) >= 80 ? 'hot' : 'warm'}
    detailExtras={<>
      <span className="recent-result-score">Skor {Math.round(Number(match.score))}</span>
      {reasons.length > 0 && <div className="recent-result-reasons" aria-label="Alasan kecocokan">{(allReasons ? reasons : reasons.slice(0, 4)).map((reason) => <span key={reason}>{reason}</span>)}{reasons.length > 4 && <button type="button" onClick={() => setAllReasons((value) => !value)}>{allReasons ? 'Ringkas' : `+${reasons.length - 4} lainnya`}</button>}</div>}
      {(match.upgraded_to_hot || match.agent_name) && <p className="recent-result-upload">{match.upgraded_to_hot ? 'Naik ke Hot' : ''}{match.upgraded_to_hot && match.agent_name ? ' · ' : ''}{match.agent_name ? `Upload ${match.agent_name}` : ''}</p>}
      <OriginalMessage row={match.target} />
    </>}
    footerExtras={<div className="recent-result-contact"><WhatsAppButton row={match.target} kind={targetDirection} label={`WhatsApp ${targetDirection === 'buyer' ? 'buyer' : 'pemilik listing'}`} branded /><WhatsAppButton row={source} kind={direction} label={`WhatsApp ${direction === 'buyer' ? 'buyer' : 'pemilik listing'}`} branded /></div>}
  />;
}
