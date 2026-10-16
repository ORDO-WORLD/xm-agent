'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar, Modal, toast } from '@heroui/react';
import { CalendarDays, Check, Copy, Info, MessageSquareText } from 'lucide-react';
import { StatusChip } from '@/components/app/primitives';
import { StatusMenu } from '@/components/app/status-menu';
import { area, asWib, categoryLabel, cleanName, dateTime, initials, money, relativeDate, titleCase, TRANSACTION_LABELS } from '@/lib/format';
import type { Direction, EntityStatus, Row } from '@/lib/types';

export function RecentSourceCard({ row, direction, foundAt, isNew, selected, onSelect, onStatus, bulk, detailExtras, footerExtras, showDetailAction = true, showSeenBadge = true, temperature }: {
  row: Row; direction: Direction; foundAt: string; isNew: boolean; selected: boolean;
  onSelect: () => void; onStatus: (status: EntityStatus) => void;
  bulk?: { checked: boolean; onToggle: () => void };
  detailExtras?: ReactNode; footerExtras?: ReactNode; showDetailAction?: boolean; showSeenBadge?: boolean; temperature?: 'hot' | 'warm';
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const infoId = useId();
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const day = 86400000;
    const timeout = window.setTimeout(() => setNow(Date.now()), day - ((now + 7 * 3600000) % day) + 50);
    const refresh = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', refresh); };
  }, [now]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copyId = async () => {
    if (!row.public_id) return;
    try { await navigator.clipboard.writeText(row.public_id); setCopied(true); toast.success('ID disalin'); }
    catch { toast.danger('ID belum dapat disalin. Silakan salin teks ID secara manual.'); }
  };
  useEffect(() => {
    if (!infoOpen) return;
    const dismiss = (event: PointerEvent) => { if (!infoRef.current?.contains(event.target as Node)) setInfoOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [infoOpen]);
  const name = cleanName(row.contact_name) || (direction === 'buyer' ? 'Buyer tanpa nama' : 'Listing tanpa nama');
  const posting = row.last_seen_at || row.sent_at;
  const sent = asWib(row.sent_at);
  const sentTime = sent ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(sent).replace('.', ':') : '';
  const sender = row.author || 'Pengirim tidak diketahui';
  const relative = relativeDate(posting, now).replace(/^1 minggu lalu$/, 'minggu kemarin');
  const old = !!asWib(foundAt) && now - asWib(foundAt)!.getTime() >= 7 * 86400000;
  // Seen follows the existing company-wide last-visit marker, rather than inventing a per-card receipt.
  const badge = isNew ? 'Baru' : old ? 'Lama' : 'Sudah dilihat';
  return <>
    <article className={`recent-source-card${selected || bulk?.checked ? ' is-selected' : ''}`}>
      <button type="button" className="recent-card-hit-area" onClick={bulk ? bulk.onToggle : onSelect} aria-label={bulk ? `Pilih kartu ${name}` : `Lihat detail match ${name}`} aria-pressed={bulk ? bulk.checked : selected} />
      <div className="recent-card-body">
        <div className="recent-card-top">
          <Avatar color="accent" className="recent-card-avatar"><Avatar.Fallback>{initials(name)}</Avatar.Fallback></Avatar>
          <div className="recent-card-top-meta">
            {bulk && <label className="recent-card-pick"><input type="checkbox" aria-label={`Pilih ${name} (${row.public_id ?? ''})`} checked={bulk.checked} onChange={bulk.onToggle} /></label>}
            <time title={dateTime(posting)}>{posting ? relative.charAt(0).toUpperCase() + relative.slice(1) : 'Waktu posting belum tersedia'}</time>
            <div className="recent-card-temperatures">
              {temperature ? <span className={temperature === 'hot' ? 'recent-card-hot' : 'recent-card-warm'}><span aria-hidden="true">{temperature === 'hot' ? '🔥' : '🌡️'}</span>{temperature === 'hot' ? 'Hot' : 'Warm'}</span> : <><span className="recent-card-hot"><span aria-hidden="true">🔥</span> {Number(row.hot_count) || 0} Hot</span><span className="recent-card-warm"><span aria-hidden="true">🌡️</span> {Number(row.warm_count) || 0} Warm</span></>}
              {row.entity_status && row.entity_status !== 'ready' && <StatusChip status={row.entity_status} />}
            </div>
          </div>
        </div>
        <div className="recent-card-name-row">
          <span className="recent-card-name">{name}</span>
          <div className="recent-card-info" ref={infoRef} onPointerEnter={(event) => { if (event.pointerType === 'mouse') setInfoOpen(true); }} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setInfoOpen(false); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInfoOpen(false); }}>
            <button type="button" className="recent-card-info-trigger" aria-label={`Informasi ID ${name}`} aria-expanded={infoOpen} aria-controls={infoId} onKeyDown={(event) => { if (event.key === 'Escape') setInfoOpen(false); }} onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) setInfoOpen(true); }} onClick={() => { if (window.matchMedia('(hover: none)').matches) setInfoOpen((open) => !open); else setInfoOpen(true); }}><Info className="size-4" aria-hidden="true" /></button>
            {infoOpen && <fieldset id={infoId} className="recent-card-id-tooltip" aria-label="ID sumber"><span>ID {direction === 'buyer' ? 'Buyer' : 'Listing'}: <strong>{row.public_id || 'Belum tersedia'}</strong></span>{row.public_id && <button type="button" className="recent-card-copy" aria-label={`Salin ID ${row.public_id}`} onClick={() => void copyId()}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button>}</fieldset>}
          </div>
        </div>
        <div className="recent-card-sender-row"><p className="recent-card-sender">Pengirim: <span>{row.author || 'Belum tersedia'}</span></p>{Number(row.duplicate_count) > 1 && <span className="recent-card-duplicate-badge">Teks sama · {row.duplicate_count}× muncul</span>}</div>
        <PropertyDetails row={row} direction={direction} />
        {detailExtras && <div className="recent-card-detail-extras">{detailExtras}</div>}
      </div>
      <footer className="recent-card-footer">
        <div className="recent-card-found"><CalendarDays className="size-4" aria-hidden="true" /><span>{dateTime(foundAt)}</span>{showSeenBadge && <span className={`recent-card-seen${isNew ? ' is-new' : ''}`}>{badge}</span>}</div>
        {footerExtras}
        <StatusMenu status={row.entity_status ?? 'ready'} name={`${name} ${row.public_id ?? ''}`} onChoose={onStatus} onPreview={() => setPreviewOpen(true)} onDetail={showDetailAction ? onSelect : undefined} />
      </footer>
    </article>
    {previewOpen && <Modal.Backdrop isOpen onOpenChange={setPreviewOpen}>
      <Modal.Container placement="center" size="lg" scroll="inside"><Modal.Dialog className="general-settings sales-edit-dialog recent-raw-dialog">
        <Modal.CloseTrigger />
        <Modal.Header><Modal.Heading className="flex items-start gap-2"><MessageSquareText className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><span>Preview Pesan Asli {name}</span></Modal.Heading><p className="recent-raw-subtitle">ID {direction === 'buyer' ? 'Buyer' : 'Listing'}: {row.public_id || 'Belum tersedia'}</p></Modal.Header>
        <Modal.Body className="recent-wa-body">
          <div className="recent-wa-content">
            <div className="recent-wa-date">{sent ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).format(sent) : 'Tanggal kirim tidak tersedia'}</div>
            {row.chat_name && <p className="recent-wa-group">{row.chat_name}</p>}
            <div className="recent-wa-message"><span className="recent-wa-avatar" aria-label={`Profil ${sender}`}>{initials(sender)}</span><div className="recent-wa-bubble"><p className="recent-wa-sender">{sender}</p><p className="recent-wa-text">{row.raw_text || row.normalized_text || 'Pesan asli belum tersedia.'}</p><time className="recent-wa-time" title={dateTime(row.sent_at)}>{sentTime || 'Waktu kirim tidak tersedia'}</time></div></div>
          </div>
        </Modal.Body>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>}
  </>;
}

export function PropertyDetails({ row, direction }: { row: Row; direction: Direction }) {
  const price = money(row.price_max ?? row.price_min);
  const details = [
    { label: 'Properti', value: row.categories?.map(categoryLabel).join(', ') },
    { label: 'Lokasi', value: row.locations?.map(titleCase).join(', ') },
    { label: 'Transaksi', value: row.transaction_type && row.transaction_type !== 'unknown' ? TRANSACTION_LABELS[row.transaction_type] || titleCase(row.transaction_type) : null },
    { label: 'Luas tanah', value: area(row.land_area_min, row.land_area_max) },
    { label: 'Luas bangunan', value: area(row.building_area_min, row.building_area_max) },
    { label: direction === 'buyer' ? 'Anggaran' : 'Harga', value: price ? `${price}${row.price_basis === 'per_m2' ? '/m²' : row.price_basis === 'per_year' ? '/tahun' : ''}` : null },
  ].filter((item) => item.value);
  return details.length > 0 ? <dl className="recent-card-details">{details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className="recent-card-summary">{row.raw_text || row.normalized_text || 'Detail pesan belum tersedia.'}</p>;
}
