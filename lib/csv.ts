/** Small CSV reader for the glossary upload (quotes and both line endings handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim()); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export type CsvPreview = { fileName: string; rows: [string, string][]; invalid: number; duplicates: number };

/** Column A = word as written in chats, column B = the standard name. */
export function prepareGlossaryCsv(fileName: string, text: string): CsvPreview {
  let grid = parseCsv(text);
  const headerWords = new Set(['alias', 'istilah', 'sinonim', 'kolom a', 'asal', 'from']);
  if (grid[0] && headerWords.has((grid[0][0] || '').toLowerCase())) grid = grid.slice(1);
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const cells of grid) {
    const alias = (cells[0] || '').trim();
    const canonical = (cells[1] || '').trim();
    if (!alias || !canonical || alias.length > 100 || canonical.length > 100) { invalid += 1; continue; }
    const key = alias.toLowerCase();
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    entries.push([alias, canonical]);
  }
  return { fileName, rows: entries, invalid, duplicates };
}
