'use client';

import { useMemo, useState } from 'react';
import { Button, Description, Label, Modal, TextArea, TextField, toast, type useOverlayState } from '@heroui/react';
import { PhoneCall } from 'lucide-react';
import { SettingsNote } from '@/components/settings/settings-section';
import { errorMessage } from '@/lib/api';
import { formatPhone, normalizePhone } from '@/lib/format';
import { useCompany } from '@/lib/session';
import type { StockTracked } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const PHONE = /^628\d{8,12}$/;

/** One box for many numbers, separated by commas. The list below the box shows what was understood. */
export function TrackedEditor({ state, current, onSaved }: { state: ReturnType<typeof useOverlayState>; current: StockTracked[]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal.Backdrop isOpen={state.isOpen} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!busy) state.setOpen(open); }}>
      <Modal.Container placement="center" size="lg" scroll="inside">
        {/* The form is mounted each time the dialog opens, so it always starts from what is saved. */}
        <Modal.Dialog className="general-settings sales-edit-dialog stock-tracked-dialog"><TrackedForm current={current} busy={busy} setBusy={setBusy} onClose={() => state.close()} onSaved={onSaved} /></Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function TrackedForm({ current, busy, setBusy, onClose, onSaved }: { current: StockTracked[]; busy: boolean; setBusy: (busy: boolean) => void; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { company } = useCompany();
  const [text, setText] = useState(() => current.map((item) => item.phone).join(', '));
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(current.filter((item) => item.label).map((item) => [item.phone, item.label as string])));
  const [error, setError] = useState('');

  const parsed = useMemo(() => {
    const parts = text.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
    const rows = parts.map((raw) => ({ raw, phone: normalizePhone(raw) }));
    const valid = [...new Map(rows.filter((row) => PHONE.test(row.phone)).map((row) => [row.phone, row])).values()];
    const invalid = rows.filter((row) => !PHONE.test(row.phone));
    return { valid, invalid };
  }, [text]);

  async function save() {
    if (busy || parsed.invalid.length > 0 || parsed.valid.length > 50) return;
    setBusy(true); setError('');
    try {
      await api.put('/stock/tracked', { phones: parsed.valid.map((row) => row.phone), labels });
      const phonesChanged = parsed.valid.length !== current.length || parsed.valid.some((row) => !current.some((item) => item.phone === row.phone));
      toast.success(company?.matching_mode === 'sales' && phonesChanged ? 'Watchlist disimpan. Aturan langsung berlaku; hasil pencocokan diperbarui di latar belakang.' : `${parsed.valid.length} nomor sales dipantau`);
      onClose();
      onSaved();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return (
    <>
      {!busy && <Modal.CloseTrigger />}
      <Modal.Header><Modal.Heading className="flex items-center gap-2"><PhoneCall className="size-4" aria-hidden="true" />Atur nomor sales</Modal.Heading></Modal.Header>
      <Modal.Body className="sales-dialog-body space-y-4">
        <SettingsNote>Berlaku untuk seluruh company. Listing dikenali dari nomor kontak yang tercantum dalam pesan. {company?.matching_mode === 'sales' && 'Perubahan nomor juga memperbarui hasil pencocokan pada mode Sales.'}</SettingsNote>
        <TextField value={text} onChange={setText} isDisabled={busy} fullWidth>
          <Label>Nomor telepon</Label>
          <TextArea rows={4} placeholder="6282233744657, 6281202310022" />
          <Description className="text-xs">Pisahkan dengan koma atau baris baru. Awalan 08 atau 628, maksimal 50 nomor. Nomor duplikat dihitung sekali.</Description>
        </TextField>
        {parsed.invalid.length > 0 && <SettingsNote tone="danger">Nomor tidak dikenali: {parsed.invalid.map((row) => row.raw).join(', ')}. Gunakan nomor seluler Indonesia.</SettingsNote>}
        {parsed.valid.length > 50 && <SettingsNote tone="danger">Maksimal 50 nomor dapat dipantau.</SettingsNote>}
        {parsed.valid.length > 0 && (
          <div>
            <div className="stock-tracked-heading"><h3>{parsed.valid.length} nomor akan dipantau</h3><span>Nama sales opsional</span></div>
            <ul className="stock-tracked-list">
              {parsed.valid.map((row) => (
                <li key={row.phone}>
                  <span>{formatPhone(row.phone)}</span>
                  <input aria-label={`Nama untuk ${row.phone}`} value={labels[row.phone] ?? ''} onChange={(event) => setLabels((currentLabels) => ({ ...currentLabels, [row.phone]: event.target.value }))}
                    maxLength={80} disabled={busy} placeholder="Nama sales" className="input" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <SettingsNote tone="danger">{error}</SettingsNote>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" isDisabled={busy} onPress={onClose}>Batal</Button>
        <Button isPending={busy} isDisabled={parsed.invalid.length > 0 || parsed.valid.length > 50} onPress={save}>Simpan</Button>
      </Modal.Footer>
    </>
  );
}
