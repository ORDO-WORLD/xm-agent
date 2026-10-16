'use client';

import { useSyncExternalStore } from 'react';
import { getPaginationPages } from '@/lib/pagination';
export { getPaginationPages } from '@/lib/pagination';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

function subscribe(callback: () => void) {
  const mobile = window.matchMedia('(max-width: 500px)');
  const tablet = window.matchMedia('(max-width: 1024px)');
  mobile.addEventListener('change', callback); tablet.addEventListener('change', callback);
  return () => { mobile.removeEventListener('change', callback); tablet.removeEventListener('change', callback); };
}
export function useTableViewport() {
  return useSyncExternalStore<'mobile' | 'tablet' | 'desktop'>(subscribe, () => window.matchMedia('(max-width: 500px)').matches ? 'mobile' : window.matchMedia('(max-width: 1024px)').matches ? 'tablet' : 'desktop', () => 'desktop');
}


export function SettingsPagination({ page, pageSize, total, onPage, onPageSize, label }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void; label: string;
}) {
  const viewport = useTableViewport();
  const count = Math.max(1, Math.ceil(total / pageSize));
  const pages = getPaginationPages(page, count, viewport);
  return <footer className="sales-pagination">
    <label>Show <select aria-label={`Jumlah ${label} per halaman`} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
    <nav aria-label={`Pagination ${label}`}>
      {count >= 50 && <button aria-label="Halaman pertama" disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft size={16} /></button>}
      <button aria-label="Halaman sebelumnya" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
      {pages.map((number, index) => typeof number === 'number' ? <button key={number} aria-label={`Halaman ${number}`} aria-current={page === number ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button> : <span key={`gap-${index}`} className="px-1">{number}</span>)}
      <button aria-label="Halaman berikutnya" disabled={page === count} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      {count >= 50 && <button aria-label="Halaman terakhir" disabled={page === count} onClick={() => onPage(count)}><ChevronsRight size={16} /></button>}
    </nav><p>Halaman {page} dari {count}</p>
  </footer>;
}
