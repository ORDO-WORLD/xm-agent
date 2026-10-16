export type SearchSection = { id: string; label: string; tab: string; phone?: string };

export function phoneSearchQuery(text: string) {
  if (!/^[+\d\s().-]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

export function matchingSections(sections: SearchSection[], tab: string, text: string) {
  const query = text.trim().toLocaleLowerCase('id-ID');
  const phoneQuery = phoneSearchQuery(query);
  return query ? sections.filter((section) => section.tab === tab && (section.label.toLocaleLowerCase('id-ID').includes(query) || !!(section.phone && phoneQuery && section.phone.includes(phoneQuery)))) : [];
}

export function nextSectionIndex(index: number, step: number, count: number) {
  return count > 0 ? ((index + step) % count + count) % count : 0;
}
