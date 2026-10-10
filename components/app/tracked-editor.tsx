'use client';

import { useMemo, useState } from 'react';
import { Button, Description, Label, Modal, TextArea, TextField, toast, type useOverlayState } from '@heroui/react';
import { Notice } from '@/components/app/primitives';
import { errorMessage } from '@/lib/api';
import { formatPhone, normalizePhone } from '@/lib/format';
import { useCompany } from '@/lib/session';
import type { StockTracked } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

const PHONE = /^628\d{8,12}$/;

/** One box for many numbers, separated by commas. The list below the box shows what was understood. */
export function TrackedEditor({ state, current, onSaved }: { state: ReturnType<typeof useOverlayState>; current: StockTracked[]; onSaved: () => void }) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={(open) => state.setOpen(open)}>
      <Modal.Container size="lg" scroll="inside">
        {/* The form is mounted each time the dialog opens, so it always starts from what is saved. */}
        <Modal.Dialog><TrackedForm current={current} onClose={() => state.close()} onSaved={onSaved} /></Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function TrackedForm({ current, onClose, onSaved }: { current: StockTracked[]; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { company } = useCompany();
  const [text, setText] = useState(() => current.map((item) => item.phone).join(', '));
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(current.filter((item) => item.label).map((item) => [item.phone, item.label as string])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = useMemo(() => {
    const parts = text.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
    const rows = parts.map((raw) => ({ raw, phone: normalizePhone(raw) }));
    const valid = [...new Map(rows.filter((row) => PHONE.test(row.phone)).map((row) => [row.phone, row])).values()];
    const invalid = rows.filter((row) => !PHONE.test(row.phone));
    return { valid, invalid };
  }, [text]);

  async function save() {
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
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>Atur nomor sales yang dipantau</Modal.Heading></Modal.Header>
      <Modal.Body className="space-y-4">
        <Notice status="accent">Pengaturan ini berlaku untuk <strong>seluruh company</strong>. Sistem menghitung listing yang mencantumkan nomor itu di pesannya, dan mencatatnya otomatis setiap upload.</Notice>
        <p className="text-sm leading-relaxed text-muted">Pada mode Sales, watchlist langsung membatasi sumber di Cocokkan, Match Terbaru, dashboard, dan export. Perubahan nomor juga memperbarui hasil pencocokan di latar belakang.</p>
        <TextField value={text} onChange={setText} fullWidth>
          <Label className="text-base font-bold">Nomor telepon (pisahkan dengan koma)</Label>
          <TextArea rows={4} className="text-base" placeholder="6282233744657, 6281202310022" />
          <Description className="text-sm">Boleh diawali 08… atau 628…. Maksimal 50 nomor. Nomor yang sama hanya dihitung sekali.</Description>
        </TextField>
        {parsed.invalid.length > 0 && <Notice status="danger" title="Nomor ini tidak dikenali">{parsed.invalid.map((row) => row.raw).join(', ')} — gunakan nomor seluler Indonesia.</Notice>}
        {parsed.valid.length > 0 && (
          <div>
            <p className="mb-2 text-base font-bold">{parsed.valid.length} nomor akan dipantau</p>
            <ul className="space-y-2">
              {parsed.valid.map((row) => (
                <li key={row.phone} className="flex flex-wrap items-center gap-2 rounded-xl bg-background p-2.5">
                  <span className="min-w-40 text-base font-semibold">{formatPhone(row.phone)}</span>
                  <input aria-label={`Nama untuk ${row.phone}`} value={labels[row.phone] ?? ''} onChange={(event) => setLabels((currentLabels) => ({ ...currentLabels, [row.phone]: event.target.value }))}
                    maxLength={80} placeholder="Nama sales (opsional)" className="h-11 min-w-0 flex-1 rounded-xl border border-field-border bg-field px-3 text-base" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <Notice status="danger">{error}</Notice>}
      </Modal.Body>
      <Modal.Footer>
        <Button slot="close" variant="tertiary" size="lg">Batal</Button>
        <Button size="lg" isPending={busy} isDisabled={parsed.invalid.length > 0 || parsed.valid.length > 50} onPress={save}>Simpan</Button>
      </Modal.Footer>
    </>
  );
}
