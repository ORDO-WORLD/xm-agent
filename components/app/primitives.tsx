'use client';

import { useState, type ReactNode } from 'react';
import { AlertDialog, Alert, Button, Chip, Skeleton, ToggleButton, ToggleButtonGroup, toast } from '@heroui/react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { LottiePlayer, type LottieName } from '@/components/lottie/lottie-player';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { STATUS_LABELS } from '@/lib/format';
import type { EntityStatus, Temperature } from '@/lib/types';
import { cn } from '@/lib/utils';

/* --------------------------------------------------------------- page layout */

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm font-semibold text-accent">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, description, action, children, className, bodyClassName }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn('xm-card min-w-0', className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn('p-4 sm:p-5', (title || action) && 'pt-3 sm:pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

const tones = {
  blue: 'bg-accent-soft text-accent-soft-foreground',
  cyan: 'bg-cyan-50 text-cyan-800',
  indigo: 'bg-indigo-50 text-indigo-800',
  green: 'bg-success-soft text-success-soft-foreground',
  amber: 'bg-warning-soft text-warning-soft-foreground',
  red: 'bg-danger-soft text-danger-soft-foreground',
  slate: 'bg-default text-default-foreground',
} as const;
export type Tone = keyof typeof tones;

export function IconBadge({ icon, tone = 'blue', className }: { icon: ReactNode; tone?: Tone; className?: string }) {
  return <span aria-hidden="true" className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl [&_svg]:size-5', tones[tone], className)}>{icon}</span>;
}

/** A headline number. Counts up once when it first scrolls into view. Stacks vertically on a phone so two fit side by side. */
export function StatTile({ label, value, icon, tone = 'blue', change, hint, loading }: {
  label: string; value: number; icon: ReactNode; tone?: Tone; change?: number | null; hint?: ReactNode; loading?: boolean;
}) {
  return (
    <div className="xm-card flex h-full flex-col items-start gap-2.5 p-3.5 sm:flex-row sm:gap-3.5 sm:p-5">
      <IconBadge icon={icon} tone={tone} className="size-10 sm:size-11" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-medium text-muted sm:text-base">{label}</p>
        {loading ? <Skeleton className="mt-2 h-8 w-20 rounded-lg" /> : (
          <p className="mt-0.5 text-[1.75rem] leading-tight font-bold tracking-tight text-foreground sm:text-3xl"><NumberTicker value={value} key={value} /></p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {change !== undefined && !loading && <ChangeBadge change={change} />}
          {hint && <p className="text-sm leading-snug text-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

export function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return null;
  const up = change >= 0;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold', up ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground')}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {Math.abs(change) > 999 ? '>999' : Math.abs(change).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
      <span className="sr-only">{up ? ' naik' : ' turun'} dibanding periode sebelumnya</span>
    </span>
  );
}

/* -------------------------------------------------------------- empty / error */

export function EmptyState({ animation = 'empty-box', title, description, action, compact }: {
  animation?: LottieName; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 text-center', compact ? 'py-8' : 'py-14')}>
      <LottiePlayer name={animation} className={compact ? 'w-32' : 'w-44'} />
      <h3 className="mt-2 text-lg font-bold text-foreground">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-base leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ status = 'default', title, children, action }: {
  status?: 'default' | 'accent' | 'success' | 'warning' | 'danger'; title?: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <Alert status={status} className="items-start">
      <Alert.Indicator />
      <Alert.Content>
        {title && <Alert.Title className="text-base">{title}</Alert.Title>}
        {children && <Alert.Description className="text-[0.95rem] leading-relaxed">{children}</Alert.Description>}
      </Alert.Content>
      {action}
    </Alert>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <Notice status="danger" title="Ada kendala" action={onRetry && <Button size="sm" variant="danger-soft" onPress={onRetry}>Coba lagi</Button>}>{message}</Notice>
  );
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <output aria-label="Memuat data" className={cn('block space-y-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="xm-card flex gap-3 p-4">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2.5"><Skeleton className="h-4 w-1/3 rounded-md" /><Skeleton className="h-3.5 w-5/6 rounded-md" /><Skeleton className="h-3.5 w-2/3 rounded-md" /></div>
        </div>
      ))}
    </output>
  );
}

/* ------------------------------------------------------------------ chips */

const statusStyle: Record<EntityStatus, string> = {
  ready: 'bg-success-soft text-success-soft-foreground',
  on_hold: 'bg-warning-soft text-warning-soft-foreground',
  sold: 'bg-accent-soft text-accent-soft-foreground',
  deleted: 'bg-danger-soft text-danger-soft-foreground',
};

export function StatusChip({ status, className }: { status?: EntityStatus; className?: string }) {
  if (!status) return null;
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold leading-none', statusStyle[status], className)}>{STATUS_LABELS[status]}</span>;
}

export function TemperatureChip({ temperature, count, className }: { temperature: Temperature; count?: number; className?: string }) {
  const hot = temperature === 'hot';
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold leading-none', hot ? 'bg-hot-soft text-hot' : 'bg-warm-soft text-amber-800', className)}>
      <span aria-hidden="true">{hot ? '🔥' : '🌡️'}</span>{hot ? 'Hot' : 'Warm'}{count !== undefined && <span className="font-bold"> · {count}</span>}
    </span>
  );
}

/** The public ID (L-AB908 / B-AB908). Tap to copy: it is what people say to each other on WhatsApp. */
export function IdChip({ id, kind, className }: { id?: string; kind: 'buyer' | 'property'; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(id!);
      setCopied(true);
      toast.success(`ID ${id} disalin`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.danger('ID tidak dapat disalin. Salin manual: ' + id);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`ID ${kind === 'buyer' ? 'buyer' : 'listing'} ${id}. Ketuk untuk menyalin`}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[0.95rem] font-bold tracking-wide transition-colors',
        kind === 'buyer' ? 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100' : 'bg-cyan-50 text-cyan-800 hover:bg-cyan-100', className)}
    >
      {id}{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5 opacity-60" />}
    </button>
  );
}

export function PlainChip({ children, color = 'default' }: { children: ReactNode; color?: 'default' | 'accent' | 'success' | 'warning' | 'danger' }) {
  return <Chip color={color} variant="soft" size="md">{children}</Chip>;
}

/* -------------------------------------------------------------- controls */

/** One choice out of a few, shown as big buttons that fit a thumb. */
export function Segmented<T extends string>({ value, onChange, options, label, fullWidth }: {
  value: T; onChange: (value: T) => void; options: { id: T; label: ReactNode }[]; label: string; fullWidth?: boolean;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([value])}
      onSelectionChange={(keys) => { const next = [...keys][0]; if (next) onChange(next as T); }}
      fullWidth={fullWidth}
      className="max-w-full"
    >
      {options.map((option, index) => (
        <ToggleButton key={option.id} id={option.id} className="min-h-11 px-4 text-[0.95rem] font-semibold">
          {index > 0 && <ToggleButtonGroup.Separator />}{option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** A confirmation that names what will happen, with a plain way back. */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, status = 'danger', busy, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; confirmLabel: string;
  status?: 'danger' | 'warning' | 'accent'; busy?: boolean; onConfirm: () => void;
}) {
  return (
    <AlertDialog.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[440px]">
          <AlertDialog.Header>
            <AlertDialog.Icon status={status}>{status === 'danger' ? <TriangleAlert /> : undefined}</AlertDialog.Icon>
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body className="text-base leading-relaxed">{children}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" size="lg">Batal</Button>
            <Button variant={status === 'danger' ? 'danger' : 'primary'} size="lg" isPending={busy} onPress={onConfirm}>{confirmLabel}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
