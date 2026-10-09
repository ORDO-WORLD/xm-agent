'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Description, Dropdown, Label, buttonVariants, toast } from '@heroui/react';
import { CircleCheck, Clock3, EllipsisVertical, PackageCheck, Trash2 } from 'lucide-react';
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
export function StatusMenu({ status = 'ready', name, onChoose }: { status?: EntityStatus; name: string; onChoose: (status: EntityStatus) => void }) {
  return (
    <Dropdown>
      <Dropdown.Trigger aria-label={`Ubah status ${name}`} className={buttonVariants({ variant: 'tertiary', isIconOnly: true, size: 'md' })}>
        <EllipsisVertical className="size-5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end" className="min-w-64">
        <Dropdown.Menu aria-label={`Status ${name}`} onAction={(key) => onChoose(key as EntityStatus)}>
          <Dropdown.Section>
            {OPTIONS.map((option) => (
              <Dropdown.Item key={option.id} id={option.id} textValue={option.label} isDisabled={option.id === status} variant={option.id === 'deleted' ? 'danger' : 'default'}>
                <option.icon className="size-5 shrink-0" aria-hidden="true" />
                <div className="flex flex-col">
                  <Label className="text-base">{option.id === status ? `${option.label} (saat ini)` : option.id === 'deleted' ? 'Tandai untuk dihapus' : `Tandai ${option.label}`}</Label>
                  <Description className="text-sm">{option.hint}</Description>
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
export function useStatusActions(onChanged: () => void): { request: (request: StatusRequest) => void; dialog: ReactNode } {
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
    if (next.status === 'deleted') setPending(next);
    else void apply(next);
  }, [apply]);

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
