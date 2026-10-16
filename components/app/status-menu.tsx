'use client';

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertDialog, Button, Description, Dropdown, Label, buttonVariants, toast } from '@heroui/react';
import { ChevronDown, CircleCheck, Clock3, EllipsisVertical, MessageSquareText, PackageCheck, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { STATUS_LABELS } from '@/lib/format';
import { useCompany } from '@/lib/session';
import type { EntityStatus } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const OPTIONS: { id: EntityStatus; label: string; hint: string; icon: typeof CircleCheck }[] = [
  { id: 'ready', label: 'Ready', hint: 'Masih tersedia / masih dicari', icon: CircleCheck },
  { id: 'on_hold', label: 'On-hold', hint: 'Ditahan sementara', icon: Clock3 },
  { id: 'sold', label: 'Sold', hint: 'Sudah terjual / sudah deal', icon: PackageCheck },
  { id: 'deleted', label: 'Hapus', hint: 'Sembunyikan dari semua daftar', icon: Trash2 },
];

/** The "⋮" on a card: mark it Ready, On-hold, Sold or deleted. */
export function StatusMenu({ status = 'ready', name, onChoose, onPreview, onDetail, textTrigger = false }: { status?: EntityStatus; name: string; onChoose: (status: EntityStatus) => void; onPreview?: () => void; onDetail?: () => void; textTrigger?: boolean }) {
  return (
    <Dropdown>
      <Dropdown.Trigger aria-label={`Aksi ${name}`} className={onPreview || textTrigger ? 'recent-card-action' : buttonVariants({ variant: 'tertiary', isIconOnly: true, size: 'md' })}>
        {onPreview || textTrigger ? <>Aksi<ChevronDown className="size-4" aria-hidden="true" /></> : <EllipsisVertical className="size-5" aria-hidden="true" />}
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end" className={onPreview || textTrigger ? 'min-w-64 recent-card-action-menu' : 'min-w-64'}>
        <Dropdown.Menu aria-label={`Aksi ${name}`} onAction={(key) => { if (key === 'preview') onPreview?.(); else if (key === 'detail') onDetail?.(); else onChoose(key as EntityStatus); }}>
          {onDetail && <Dropdown.Item id="detail" textValue="Detail Match"><CircleCheck className="size-5" aria-hidden="true" /><Label>Detail Match</Label></Dropdown.Item>}
          {onPreview && <Dropdown.Item id="preview" textValue="Preview Pesan Asli"><MessageSquareText className="size-5" aria-hidden="true" /><Label>Preview Pesan Asli</Label></Dropdown.Item>}
          <Dropdown.Section>
            {OPTIONS.map((option) => (
              <Dropdown.Item key={option.id} id={option.id} textValue={option.label} isDisabled={option.id === status} variant={option.id === 'deleted' ? 'danger' : 'default'}>
                <option.icon className="size-5 shrink-0" style={option.id === 'deleted' ? { color: '#ef2028' } : undefined} aria-hidden="true" />
                <div className="flex flex-col">
                  <Label className="text-base">{option.id === status ? `${option.label} (saat ini)` : option.id === 'deleted' ? 'Tandai untuk dihapus' : `Tandai ${option.label}`}</Label>
                  {!onPreview && !textTrigger && <Description className="text-sm">{option.hint}</Description>}
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export type StatusRequest = {
  /** Entity IDs or public IDs. */
  refs: string[];
  status: EntityStatus;
  /** What to call it in messages: "Listing L-AB908" or "3 listing". */
  name: string;
  /** If every item had the same status before, "Urungkan" can restore it. */
  previous?: EntityStatus;
};

/**
 * Applies a status change, asks first when it hides something, and always offers
 * a way back. Render `dialog` somewhere in the page.
 */
export function useStatusActions(onChanged: () => void, confirmChanges = false): { request: (request: StatusRequest) => void; dialog: ReactNode } {
  const api = useApi();
  const { refresh } = useCompany();
  const [pending, setPending] = useState<StatusRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(async (request: StatusRequest) => {
    setBusy(true);
    // The API takes 200 at a time; "Pilih semua" can hand over far more.
    const send = async (status: EntityStatus) => {
      for (let start = 0; start < request.refs.length; start += 200) await api.post('/entities/status', { ids: request.refs.slice(start, start + 200), status });
    };
    try {
      await send(request.status);
      const undo = request.previous && request.previous !== request.status
        ? { children: 'Urungkan', variant: 'tertiary' as const, onPress: () => { const previous = request.previous; if (previous) void send(previous).then(() => { onChanged(); refresh(); }).catch((reason) => toast.danger(errorMessage(reason))); } }
        : undefined;
      toast.success(`${request.name} ditandai ${STATUS_LABELS[request.status]}`, { timeout: 8000, ...(undo ? { actionProps: undo } : {}) });
      onChanged();
      refresh();
    } catch (reason) {
      toast.danger(errorMessage(reason, 'Status belum dapat diubah. Coba lagi.'));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [api, onChanged, refresh]);

  const request = useCallback((next: StatusRequest) => {
    if (next.status === 'deleted' || (confirmChanges && next.status !== 'ready')) setPending(next);
    else void apply(next);
  }, [apply, confirmChanges]);

  if (confirmChanges) {
    const status = pending?.status ?? 'deleted';
    const option = OPTIONS.find((item) => item.id === status)!;
    const Icon = option.icon;
    const color = status === 'on_hold' ? '#d97706' : status === 'sold' ? '#0a3be0' : '#ed1c24';
    const soft = status === 'on_hold' ? '#fffbeb' : status === 'sold' ? '#eff6ff' : '#fff1f2';
    const label = status === 'deleted' ? 'Hapus' : STATUS_LABELS[status];
    const dialog = <AlertDialog.Backdrop isOpen={!!pending} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!open && !busy) setPending(null); }} className="company-logout-backdrop">
      <AlertDialog.Container placement="center" className="company-logout-container">
        <AlertDialog.Dialog className="company-logout-dialog recent-status-dialog" style={{ '--status-color': color, '--status-soft': soft } as CSSProperties}>
          <div className="company-logout-intro">
            <AlertDialog.Header className="company-logout-heading"><div className="company-logout-icon"><Icon className="size-7" aria-hidden="true" /></div><AlertDialog.Heading>{status === 'deleted' ? 'Tandai untuk dihapus?' : `Tandai ${label}?`}</AlertDialog.Heading></AlertDialog.Header>
            <AlertDialog.Body className="company-logout-message"><strong>{pending?.name}</strong>{status === 'deleted' ? ' akan disembunyikan dari daftar dan pencocokan. Data dapat dipulihkan lewat filter Dihapus.' : status === 'on_hold' ? ' akan ditandai On-hold. Data ditampilkan saat filter On-hold disertakan.' : ' akan ditandai Sold. Data ditampilkan saat filter Sold disertakan.'}</AlertDialog.Body>
          </div>
          <AlertDialog.Footer className="company-logout-actions"><Button variant="secondary" className="company-logout-cancel" isDisabled={busy} onPress={() => setPending(null)}>Batal</Button><Button variant="primary" className="company-logout-confirm" isPending={busy} onPress={() => { if (pending && !busy) void apply(pending); }}>{status === 'deleted' ? 'Ya, Hapus' : `Ya, Tandai ${label}`}</Button></AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>;
    return { request, dialog };
  }

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => { if (!open && !busy) setPending(null); }}
      title="Tandai untuk dihapus?"
      confirmLabel="Ya, hapus dari daftar"
      busy={busy}
      onConfirm={() => pending && void apply(pending)}
    >
      <p><strong>{pending?.name}</strong> akan disembunyikan dari semua daftar dan pencocokan.</p>
      <p className="mt-2 text-muted">Data tidak hilang permanen. Anda dapat mengembalikannya kapan saja lewat filter <strong>Dihapus</strong>.</p>
    </ConfirmDialog>
  );
  return { request, dialog };
}
