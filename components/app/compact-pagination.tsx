'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CompactPagination({ total, page, pageSize, label, onPage }: { total: number; page: number; pageSize: number; label: string; onPage: (page: number) => void }) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const first = Math.max(1, Math.min(page - 1, count - 2));
  const pages = Array.from({ length: Math.min(3, count) }, (_, index) => first + index);
  return <footer className="compact-list-pagination"><span>{total} {label}</span><nav aria-label={`Pagination ${label}`}>
    <button type="button" aria-label={`Halaman ${label} sebelumnya`} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" /></button>
    {pages.map((number) => <button type="button" key={number} aria-label={`Halaman ${label} ${number}`} aria-current={page === number ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>)}
    <button type="button" aria-label={`Halaman ${label} berikutnya`} disabled={page === count} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" /></button>
  </nav></footer>;
}
