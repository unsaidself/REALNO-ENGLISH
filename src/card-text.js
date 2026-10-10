import { csvRows, separatorFor, HEADER_ALIASES } from './portability.js';
import { normalizeTypedAnswer } from './exercises.js';

const headers = HEADER_ALIASES;
export const duplicateKey = card => normalizeTypedAnswer(card?.[0]);
export function duplicateCards(cards, existing = []) {
  const seen = new Set(existing.map(duplicateKey).filter(Boolean));
  return cards.filter(card => { const key = duplicateKey(card); const duplicate = seen.has(key); seen.add(key); return duplicate; });
}
export function parseCardText(value, { separator = 'auto', boundary = 'strict' } = {}) {
  const text = String(value || '').replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('Вставь хотя бы одну пару «термин; определение».');
  const delimiter = separator === 'auto' ? (/^.+\s[-–—]\s.+$/m.test(text) && !/[;,]/.test(text) ? 'dash' : separatorFor(text)) : separator;
  const rows = delimiter === 'dash' ? text.split(/\r?\n/).filter(line => line.trim()).map(line => line.split(/\s+[-–—]\s+/)) : csvRows(text, delimiter);
  const normalized = item => String(item).trim().toLowerCase().replace(/[\s_-]/g, '');
  const indices = Object.fromEntries(Object.entries(headers).map(([name, aliases]) => [name, rows[0]?.findIndex(item => aliases.includes(normalized(item))) ?? -1]));
  const header = indices.term >= 0 && indices.definition >= 0;
  if (header) rows.shift();
  const cards = rows.map((row, index) => {
    let term, definition, example;
    if (header) { term = row[indices.term]; definition = row[indices.definition]; example = row[indices.example]; }
    else {
      if (row.length > 2 && boundary === 'strict') throw new Error(`Строка ${row.sourceLine || index + 1}: несколько разделителей. Заключи поле в двойные кавычки или выбери границу первого/последнего разделителя.`);
      const joiner = delimiter === 'dash' ? ' - ' : delimiter;
      term = boundary === 'last' ? row.slice(0, -1).join(joiner) : row[0];
      definition = boundary === 'last' ? row.at(-1) : row.slice(1).join(joiner);
    }
    term = String(term || '').trim(); definition = String(definition || '').trim();
    if (!term || !definition || row.length < 2) throw new Error(`Строка ${row.sourceLine || index + 1}: нужны термин и определение в двух колонках.`);
    const metadata = example?.trim() ? { example: example.trim() } : {};
    if (header) for (const key of ['film', 'episode', 'timecode']) { const field = row[indices[key]]; if (field?.trim()) metadata[key] = field.trim(); }
    return Object.keys(metadata).length ? [term, definition, metadata] : [term, definition];
  });
  if (!cards.length) throw new Error('Вставь хотя бы одну пару «термин; определение».');
  if (cards.length > 100000) throw new Error('За один раз можно добавить не больше 100 000 карточек.');
  return cards;
}
