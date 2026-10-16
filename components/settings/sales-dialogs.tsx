'use client';
import { useState } from 'react';
import { AlertDialog, Button, Modal, toast } from '@heroui/react';
import { Trash2 } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { formatPhone, normalizePhone } from '@/lib/format';
import type { StockOverview, StockTracked } from '@/lib/types';
import { useApi } from '@/lib/workspace-context';

export type SalesAction = { type: 'add' } | { type: 'edit' | 'delete'; item: StockTracked };
export function SalesDialog({ action, onClose, onSaved }: { action: SalesAction; onClose: () => void; onSaved: (data: StockOverview) => void }) {
  const api = useApi();
  const [value, setValue] = useState(action.type === 'edit' ? action.item.label || action.item.contact_name || '' : '');
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phoneLines = value.split(/\r?\n/);
  const nameLines = names.split(/\r?\n/);
  // Keep blank lines until pairing is complete, so a name never shifts to another number.
  const entries = Array.from({ length: Math.max(phoneLines.length, nameLines.length) }, (_, index) => ({
    raw: (phoneLines[index] ?? '').trim(),
    phone: normalizePhone(phoneLines[index] ?? ''),
    name: (nameLines[index] ?? '').trim(),
    line: index + 1,
  })).filter((entry) => entry.raw || entry.name);
  const numbers = [...new Set(entries.map((entry) => entry.phone))];
  const invalidEntry = entries.find((entry) => !/^628\d{8,12}$/.test(entry.phone) || /[,;]/.test(entry.raw));
  const longName = entries.find((entry) => entry.name.length > 80);
  const duplicate = entries.find((entry, index) => entries.findIndex((other) => other.phone === entry.phone) !== index);
  const validation = action.type !== 'add' ? '' : invalidEntry ? `Baris ${invalidEntry.line}: masukkan satu nomor seluler Indonesia dengan awalan 08 atau 628.` : longName ? `Baris ${longName.line}: nama sales maksimal 80 karakter.` : duplicate ? `Baris ${duplicate.line}: nomor sudah ditulis di baris sebelumnya.` : '';
  const invalid = !!validation;
  async function save() {
    if (invalid) return;
    setBusy(true); setError('');
    try {
      // Preserve the latest company watchlist, including names on other rows.
      const latest = await api.get<StockOverview>('/stock/overview');
      let phones = latest.tracked.map((item) => item.phone);
      const labels = Object.fromEntries(latest.tracked.filter((item) => item.label).map((item) => [item.phone, item.label!]));
      if (action.type === 'add') {
        phones = [...new Set([...phones, ...numbers])];
        if (phones.length > 50) throw new Error('Maksimal 50 nomor dapat dipantau.');
        for (const entry of entries) if (entry.name) labels[entry.phone] = entry.name;
      } else {
        if (!phones.includes(action.item.phone)) throw new Error('Nomor sudah tidak ada di daftar pantauan. Muat ulang daftar.');
        if (action.type === 'edit') labels[action.item.phone] = value.trim();
        else { phones = phones.filter((phone) => phone !== action.item.phone); delete labels[action.item.phone]; }
      }
      const data = await api.put<StockOverview>('/stock/tracked', { phones, labels });
      if (action.type === 'delete' && data.tracked.some((item) => item.phone === action.item.phone)) throw new Error('Nomor belum terhapus. Silakan coba lagi.');
      onSaved(data);
      toast.success(action.type === 'delete' ? 'Nomor dihapus dari pantauan' : action.type === 'edit' ? 'Nama akun diperbarui' : 'Nomor ditambahkan ke pantauan');
      onClose();
    } catch (reason) { const message = errorMessage(reason); setError(message); toast.danger(message); } finally { setBusy(false); }
  }
  if (action.type === 'delete') return (
    <AlertDialog.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="company-logout-backdrop">
      <AlertDialog.Container placement="center" className="company-logout-container"><AlertDialog.Dialog className="company-logout-dialog sales-delete-dialog">
        <AlertDialog.Header className="company-logout-heading company-logout-intro sales-delete-header">
          <div className="company-logout-icon"><Trash2 className="size-7" aria-hidden="true" /></div><AlertDialog.Heading>Konfirmasi Hapus</AlertDialog.Heading>
        </AlertDialog.Header><AlertDialog.Body className="company-logout-message sales-dialog-body">Hapus {action.item.label || action.item.contact_name || formatPhone(action.item.phone)} dari daftar pantauan? Data listing tetap tersimpan.
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </AlertDialog.Body><AlertDialog.Footer className="company-logout-actions">
          <Button variant="secondary" className="company-logout-cancel" isDisabled={busy} onPress={onClose}>Batal</Button>
          <Button variant="danger" className="company-logout-confirm" isPending={busy} onPress={save}>Ya, Hapus</Button>
        </AlertDialog.Footer>
      </AlertDialog.Dialog></AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
  return (
    <Modal.Backdrop isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Modal.Container placement="center" size={action.type === 'add' ? 'lg' : 'md'} scroll="inside"><Modal.Dialog className={`general-settings sales-edit-dialog${action.type === 'add' ? ' sales-add-dialog' : ''}`}>
      {!busy && <Modal.CloseTrigger />}<Modal.Header><Modal.Heading>{action.type === 'add' ? 'Tambah nomor sales' : 'Edit nama akun'}</Modal.Heading></Modal.Header>
      <Modal.Body className="sales-dialog-body space-y-2">
        {action.type === 'add' ? <div className="sales-paired-inputs">
          <div className="sales-line-numbers" aria-hidden="true">{Array.from({ length: Math.max(7, phoneLines.length, nameLines.length) }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
          <textarea id="sales-dialog-value" aria-label="Nomor telepon" className="textarea" rows={Math.max(7, phoneLines.length, nameLines.length)} wrap="off" value={value} onChange={(event) => setValue(event.target.value)} placeholder={'6282233744657\n081202310022'} aria-describedby="sales-paired-help" />
          <textarea id="sales-dialog-names" aria-label="Nama sales" className="textarea sales-names-input" rows={Math.max(7, phoneLines.length, nameLines.length)} wrap="off" value={names} onChange={(event) => setNames(event.target.value)} placeholder={'Nama sales pertama\nNama sales kedua'} aria-describedby="sales-paired-help" />
        </div> : <><label className="block text-sm" htmlFor="sales-dialog-value">Nama akun</label><input id="sales-dialog-value" className="input w-full" maxLength={80} value={value} onChange={(event) => setValue(event.target.value)} /></>}
        <p id="sales-paired-help" className="text-xs text-muted">{action.type === 'add' ? 'Satu nomor per baris. Isi nama sales pada baris yang sama di kolom kanan. Maksimal 50 nomor untuk seluruh company.' : `Nomor telepon: ${formatPhone(action.item.phone)}`}</p>
        {invalid && <p role="alert" className="text-xs text-danger">{validation}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </Modal.Body><Modal.Footer><Button variant="secondary" isDisabled={busy} onPress={onClose}>Batal</Button><Button isPending={busy} isDisabled={invalid || (action.type === 'add' ? !numbers.length : !value.trim())} onPress={save}>{action.type === 'add' ? 'Tambah nomor' : 'Simpan'}</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  );
}


