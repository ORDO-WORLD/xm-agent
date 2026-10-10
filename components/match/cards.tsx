'use client';

import { useState, type ReactNode } from 'react';
import { Avatar, buttonVariants } from '@heroui/react';
import { Check, ChevronDown, MessageCircle } from 'lucide-react';
import { IdChip, StatusChip, TemperatureChip } from '@/components/app/primitives';
import { StatusMenu } from '@/components/app/status-menu';
import { cleanName, dateTime, followUpMessage, formatPhone, initials, relativeDate, structuredSummary, waLink } from '@/lib/format';
import type { Direction, EntityStatus, Row } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Native checkbox with a big, always-clickable box (44 px touch area). */
function PickBox({ label, checked, onChange, className }: { label: string; checked: boolean; onChange: () => void; className?: string }) {
  return (
    <label className={cn('relative z-10 flex size-11 shrink-0 cursor-pointer items-center justify-center', className)}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0" />
      <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-md border-2 border-border bg-surface text-accent-foreground transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
        <Check className="size-4" strokeWidth={3} />
      </span>
    </label>
  );
}

const kindOf = (direction: Direction): 'buyer' | 'property' => direction;

/** Full original message, hidden until asked for so lists stay short. */
export function RawChat({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="group/chat" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 text-[0.95rem] font-semibold text-accent">
        Baca pesan asli <ChevronDown className="size-4 transition group-open/chat:rotate-180" aria-hidden="true" />
      </summary>
      {open && <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-background p-3 text-[0.95rem] leading-relaxed text-foreground/80">{text}</p>}
    </details>
  );
}

export function DuplicateNote({ row }: { row: Row }) {
  return Number(row.duplicate_count) > 1 ? <span className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent-soft-foreground">Teks sama · {row.duplicate_count}× muncul</span> : null;
}

export function WhatsAppButton({ row, kind, label, className }: { row: Row; kind: 'buyer' | 'property'; label: string; className?: string }) {
  const href = waLink(row.contact_phone, followUpMessage(row, kind));
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'text-success-soft-foreground', className)}>
      <MessageCircle className="size-4" aria-hidden="true" />{label}
      <span className="sr-only"> ({formatPhone(row.contact_phone)}, buka WhatsApp di tab baru)</span>
    </a>
  );
}

function LastSeen({ row }: { row: Row }) {
  const value = row.last_seen_at || row.sent_at;
  if (!value) return <span>Waktu posting belum tersedia</span>;
  return <time title={dateTime(value)}>{relativeDate(value)}</time>;
}

type SourceCardProps = {
  row: Row;
  direction: Direction;
  selected: boolean;
  onSelect: () => void;
  onStatus: (status: EntityStatus) => void;
  bulk?: { checked: boolean; onToggle: () => void };
  /** In grouped views the sender is already in the header. */
  showSender?: boolean;
  extra?: ReactNode;
};

/** One buyer or listing in the list. Tapping it opens its recommendations. */
export function SourceCard({ row, direction, selected, onSelect, onStatus, bulk, showSender, extra }: SourceCardProps) {
  const kind = kindOf(direction);
  const hot = Number(row.hot_count) > 0;
  const name = cleanName(row.contact_name) || (kind === 'buyer' ? 'Buyer tanpa nama' : 'Listing tanpa nama');
  const status = row.entity_status ?? 'ready';
  return (
    <article
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 190px' }}
      className={cn('relative rounded-2xl border bg-surface p-3.5 transition sm:p-4', hot && 'hot-match', selected ? 'border-accent bg-accent-soft/50 ring-2 ring-accent/20' : 'border-border hover:border-accent/50', status !== 'ready' && 'opacity-90')}
    >
      <div className="flex items-start gap-3">
        {bulk && (
          <PickBox label={`Pilih ${name} (${row.public_id ?? ''})`} checked={bulk.checked} onChange={bulk.onToggle} className="-ml-1.5 -mt-1.5" />
        )}
        <Avatar color={hot ? 'danger' : 'accent'} size="md" className="hidden shrink-0 sm:flex"><Avatar.Fallback>{initials(name)}</Avatar.Fallback></Avatar>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Lihat rekomendasi untuk ${name}${row.public_id ? `, ID ${row.public_id}` : ''}`} className="block w-full text-left after:absolute after:inset-0 after:rounded-2xl">
            <span className="block min-w-0 break-words pr-12 text-[1.0625rem] leading-snug font-bold">{name}</span>
            <span className="mt-0.5 block text-sm text-muted"><LastSeen row={row} /></span>
          </button>
          <div className="absolute top-2 right-2 z-10"><StatusMenu status={status} name={`${kind === 'buyer' ? 'buyer' : 'listing'} ${row.public_id ?? name}`} onChoose={onStatus} /></div>
          <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1.5">
            <IdChip id={row.public_id} kind={kind} />
            {status !== 'ready' && <StatusChip status={status} />}
            {hot && <TemperatureChip temperature="hot" count={Number(row.hot_count)} />}
            {Number(row.warm_count) > 0 && <TemperatureChip temperature="warm" count={Number(row.warm_count)} />}
            {Number(row.match_count) === 0 && <span className="rounded-full bg-default px-2.5 py-1 text-sm font-semibold text-default-foreground">Belum cocok</span>}
          </div>
          <p className="mt-2.5 line-clamp-2 text-base leading-relaxed text-foreground/85">{structuredSummary(row) || row.raw_text}</p>
          {showSender && row.author && <p className="mt-1 truncate text-sm text-muted">Pengirim: {row.author}</p>}
          <div className="relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><DuplicateNote row={row} /><RawChat text={row.raw_text || row.normalized_text} /></div>
          {extra}
        </div>
      </div>
    </article>
  );
}

/** A suggested counterpart for the selected buyer/listing. */
export function RecommendationCard({ target, source, direction, checked, onCheck, onStatus, extra }: {
  target: Row; source: Row; direction: Direction; checked: boolean; onCheck: () => void; onStatus: (status: EntityStatus) => void; extra?: ReactNode;
}) {
  const targetKind = direction === 'buyer' ? 'property' : 'buyer';
  const hot = Number(target.score) >= 80;
  const status = target.entity_status ?? 'ready';
  const name = cleanName(target.contact_name) || structuredSummary(target);
  const [all, setAll] = useState(false);
  const reasons = target.explanation ?? [];
  const shown = all ? reasons : reasons.slice(0, 4);
  return (
    <article style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 260px' }} className={cn('rounded-2xl border p-3.5 sm:p-4', hot ? 'hot-match bg-hot-soft/40' : 'border-border bg-surface')}>
      <div className="flex items-start gap-3">
        <PickBox label={`Sertakan ${name} (${target.public_id ?? ''}) dalam PDF`} checked={checked} onChange={onCheck} className="-ml-1.5 -mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-[1.0625rem] leading-snug font-bold">{cleanName(target.contact_name) || `${targetKind === 'buyer' ? 'Buyer' : 'Listing'} tanpa nama`}</p>
              <p className="mt-0.5 text-sm text-muted"><LastSeen row={target} /></p>
            </div>
            <TemperatureChip temperature={hot ? 'hot' : 'warm'} className="shrink-0" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <IdChip id={target.public_id} kind={targetKind} />
            {status !== 'ready' && <StatusChip status={status} />}
            <span className="rounded-full bg-default px-2.5 py-1 text-sm font-semibold text-default-foreground">Skor {Math.round(Number(target.score))}</span>
          </div>
          <p className="mt-2.5 text-base leading-relaxed text-foreground/85">{structuredSummary(target)}</p>
          {reasons.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Alasan kecocokan">
              {shown.map((reason) => <span key={reason} className="rounded-full bg-default px-2.5 py-1 text-sm leading-snug text-default-foreground">{reason}</span>)}
              {reasons.length > 4 && <button type="button" onClick={() => setAll((value) => !value)} className="rounded-full px-2.5 py-1 text-sm font-semibold text-accent">{all ? 'Ringkas' : `+${reasons.length - 4} lainnya`}</button>}
            </div>
          )}
          {extra}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"><DuplicateNote row={target} /><RawChat text={target.raw_text || target.normalized_text} /></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-separator pt-3">
            <div className="flex flex-wrap gap-2">
              <WhatsAppButton row={target} kind={targetKind} label={`WhatsApp ${targetKind === 'buyer' ? 'buyer' : 'pemilik listing'}`} />
              <WhatsAppButton row={source} kind={direction === 'buyer' ? 'buyer' : 'property'} label={`WhatsApp ${direction === 'buyer' ? 'buyer' : 'pemilik listing'}`} />
            </div>
            <StatusMenu status={status} name={`${targetKind === 'buyer' ? 'buyer' : 'listing'} ${target.public_id ?? name}`} onChoose={onStatus} />
          </div>
        </div>
      </div>
    </article>
  );
}
