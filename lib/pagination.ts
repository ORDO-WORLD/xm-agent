export function getPaginationPages(page: number, count: number, viewport: 'mobile' | 'tablet' | 'desktop'): (number | string)[] {
  const size = viewport === 'mobile' ? 3 : viewport === 'tablet' ? 5 : 10;
  const start = viewport === 'mobile'
    ? Math.min(Math.max(1, page - 1), Math.max(1, count - size + 1))
    : Math.min(Math.max(1, page - size + 1), Math.max(1, count - size + 1));
  const end = Math.min(count, start + size - 1);
  const pages: (number | string)[] = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  if (viewport !== 'mobile' && end < count) {
    if (end < count - 1) pages.push('…');
    pages.push(count);
  }
  return pages;
}
