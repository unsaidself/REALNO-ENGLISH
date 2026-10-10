/** Portable local backups and CSV/Anki text imports. No network or server is used. */

const FORMAT = 'zhekandus-backup';
const VERSION = 1;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_MEDIA = 8 * 1024 * 1024;
const DB_NAME = 'zhekandus-media';
const STORE = 'attachments';
const staged = new WeakMap();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const MEDIA_REFERENCE_KEYS = /^(?:imageId|audioId|recordingId|referenceAudioId)$/;
const newId = () => globalThis.crypto?.randomUUID?.() || `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function safeTree(value, depth = 0) {
  if (depth > 35) fail('Файл содержит слишком глубоко вложенные данные.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) safeTree(item, depth + 1); return; }
  if (!plain(value)) fail('Некорректные данные в файле.');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Файл содержит недопустимые поля.');
    safeTree(item, depth + 1);
  }
}

function validateData(data) {
  safeTree(data);
  if (!plain(data) || !Array.isArray(data.sets) || data.sets.length > 10000) fail('В резервной копии нет корректных наборов.');
  const setIds = new Set(), cardIds = new Set();
  let cards = 0;
  for (const set of data.sets) {
    if (!plain(set) || !['string', 'number'].includes(typeof set.id) || !String(set.id) || setIds.has(String(set.id))) fail('Некорректный или повторяющийся идентификатор набора.');
    setIds.add(String(set.id));
    if (typeof set.title !== 'string' || !set.title.trim() || !Array.isArray(set.cards)) fail('Набор должен содержать название и список карточек.');
    if (set.category !== undefined && typeof set.category !== 'string') fail('Некорректная категория набора.');
    for (const card of set.cards) {
      if (!Array.isArray(card) || card.length < 2 || card.length > 3 || typeof card[0] !== 'string' || typeof card[1] !== 'string' || !card[0].trim() || !card[1].trim()) fail('Карточка должна содержать термин и значение.');
      if (card[2] !== undefined && !plain(card[2])) fail('Некорректные дополнительные данные карточки.');
      if (card[2]?.id !== undefined) {
        if (!identifier(card[2].id) || cardIds.has(card[2].id)) fail('Некорректный или повторяющийся идентификатор карточки.');
        cardIds.add(card[2].id);
      }
      if (++cards > 100000) fail('В одном файле можно восстановить не больше 100 000 карточек.');
    }
  }
  const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
  for (const key of ['answers', 'learned']) if (data[key] !== undefined && !nonnegativeInteger(data[key])) fail('Некорректные счётчики прогресса.');
  for (const key of ['daily', 'reviews', 'settings', 'cardStats']) if (data[key] !== undefined && !plain(data[key])) fail('Некорректные настройки или история повторений.');
  for (const [date, record] of Object.entries(data.daily || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !plain(record) || !nonnegativeInteger(record.answers) || !nonnegativeInteger(record.correct) || record.correct > record.answers) fail('Некорректная активность в календаре.');
  }
  for (const review of Object.values(data.reviews || {})) {
    if (!plain(review) || !nonnegativeInteger(review.level) || !Number.isFinite(review.due) || review.due < 0 || !Number.isFinite(review.interval) || review.interval < 0 || !Number.isFinite(review.lastReviewed) || review.lastReviewed < 0) fail('Некорректное расписание повторений.');
  }
  for (const stats of Object.values(data.cardStats || {})) {
    if (!plain(stats) || !nonnegativeInteger(stats.answers) || !nonnegativeInteger(stats.errors) || stats.errors > stats.answers) fail('Некорректная статистика ответов по карточкам.');
  }
  if (data.lastStudySetId !== undefined && !['string', 'number'].includes(typeof data.lastStudySetId)) fail('Некорректный идентификатор последнего изученного набора.');
  for (const key of ['lastBackupAt']) if (data[key] !== undefined && (!Number.isFinite(data[key]) || data[key] < 0)) fail('Некорректная дата последней резервной копии.');
  if (data.settings?.goal !== undefined && (!Number.isInteger(data.settings.goal) || data.settings.goal < 1 || data.settings.goal > 500)) fail('Некорректная дневная цель.');
  if (data.categories !== undefined && (!Array.isArray(data.categories) || data.categories.some(value => typeof value !== 'string'))) fail('Некорректный список категорий.');
  if (data.days !== undefined && (!Array.isArray(data.days) || data.days.some(value => typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)))) fail('Некорректный календарь занятий.');
  if (data.newCardDay !== undefined && (!plain(data.newCardDay) || !/^\d{4}-\d{2}-\d{2}$/.test(data.newCardDay.day) || !Array.isArray(data.newCardDay.ids) || data.newCardDay.ids.some(id => !identifier(id)))) fail('Некорректный дневной список новых карточек.');
  if (data.editorDraft !== undefined && (!plain(data.editorDraft) || !Array.isArray(data.editorDraft.cards) || data.editorDraft.cards.some(card => !Array.isArray(card) || typeof card[0] !== 'string' || typeof card[1] !== 'string'))) fail('Некорректный черновик редактора.');
  if (data.deletedSets !== undefined) {
    if (!Array.isArray(data.deletedSets)) fail('Некорректная корзина удалённых наборов.');
    for (const entry of data.deletedSets) {
      if (!plain(entry) || !identifier(entry.key) || !Number.isFinite(entry.expiresAt) || !Number.isInteger(entry.index) || entry.index < 0) fail('Некорректный удалённый набор.');
      validateData({ sets: [entry.set], reviews: entry.reviews, cardStats: entry.cardStats });
    }
  }
  return cards;
}

async function openDatabase() {
  if (!globalThis.indexedDB) fail('Браузер не поддерживает хранилище вложений. Открой файл в обычной вкладке Chrome, Edge или Safari.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Хранилище вложений занято. Закрой другие вкладки приложения и повтори попытку.')), 8000);
    function finish(error, db) {
      if (settled) { db?.close(); return; }
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(db);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
    };
    request.onerror = () => finish(new Error('Не получилось открыть хранилище вложений. Проверь разрешения браузера.'));
    request.onblocked = () => finish(new Error('Хранилище вложений занято другой вкладкой.'));
    request.onsuccess = () => finish(null, request.result);
  });
}

async function readAttachments(keysOnly = false) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = keysOnly ? tx.objectStore(STORE).getAllKeys() : tx.objectStore(STORE).getAll();
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result || []);
      tx.onabort = tx.onerror = () => reject(new Error('Не получилось прочитать вложения. Резервная копия не создана.'));
    });
  } finally { db.close(); }
}

async function writeAttachments(records, removing = false) {
  if (!records.length) return;
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'Не хватает места для восстановления вложений. Старые данные сохранены.' : 'Не получилось сохранить вложения. Старые данные сохранены.'));
      try { for (const record of records) removing ? store.delete(record) : store.add(record); }
      catch (error) { tx.abort(); reject(new Error(error?.name === 'QuotaExceededError' ? 'Не хватает места для восстановления вложений. Старые данные сохранены.' : 'Не получилось сохранить вложения. Старые данные сохранены.')); }
    });
  } finally { db.close(); }
}

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
function fromBase64(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(MAX_MEDIA / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail('Повреждены данные вложения в резервной копии.');
  const binary = atob(text);
  if (!binary.length || binary.length > MAX_MEDIA) fail('Вложение пустое или превышает 8 МБ.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
const mimeAllowed = (kind, mime) => kind === 'image' ? /^image\/(jpeg|png|webp|gif|bmp|avif|x-ms-bmp)$/i.test(mime) : kind === 'audio' && /^audio\/[\w.+-]+(?:;[^\r\n]*)?$/i.test(mime);
function validateRecord(record) {
  if (!plain(record) || !identifier(record.id) || !['image', 'audio'].includes(record.type) || typeof record.name !== 'string' || !mimeAllowed(record.type, record.mime)) fail('Некорректное вложение в резервной копии.');
  const bytes = fromBase64(record.base64);
  if (record.size !== bytes.length) fail('Размер вложения не совпадает: файл повреждён.');
  if (record.type === 'image' && /<svg(?:\s|>)/i.test(new TextDecoder().decode(bytes.subarray(0, 2048)))) fail('SVG нельзя восстанавливать как изображение.');
  return bytes;
}
function attachmentReferences(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && MEDIA_REFERENCE_KEYS.test(key)) result.add(item);
    else if (item && typeof item === 'object') attachmentReferences(item, result);
  }
  return result;
}
function summary(data, attachments) {
  return { sets: data.sets.length, cards: data.sets.reduce((sum, set) => sum + set.cards.length, 0), attachments: attachments.length, bytes: attachments.reduce((sum, record) => sum + record.size, 0), answers: data.answers || 0, learned: data.learned || 0 };
}

export async function createBackup(data) {
  // Copy before awaiting IDB so one file represents one consistent text snapshot.
  const copy = JSON.parse(JSON.stringify(data));
  validateData(copy);
  const stored = await readAttachments();
  const attachments = [];
  let total = 0;
  for (const record of stored) {
    if (!record?.blob || !identifier(record.id) || !mimeAllowed(record.type, record.blob.type) || !record.blob.size || record.blob.size > MAX_MEDIA) fail('Одно из вложений повреждено. Проверь вложения перед созданием копии.');
    total += record.blob.size;
    if (total > MAX_FILE * 0.7) fail('Вложения слишком большие для одной копии. Сохрани часть наборов отдельно.');
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    attachments.push({ id: record.id, type: record.type, name: String(record.name || 'Вложение'), size: bytes.length, mime: record.blob.type, createdAt: record.createdAt || Date.now(), ...(record.width ? { width: record.width, height: record.height } : {}), base64: toBase64(bytes) });
  }
  const ids = new Set(attachments.map(record => record.id));
  for (const id of attachmentReferences(copy)) if (!ids.has(id)) fail('Вложение одной из карточек не найдено. Удали отсутствующее вложение или добавь его заново, чтобы копия была полной.');
  const blob = new Blob([JSON.stringify({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), data: copy, attachments })], { type: 'application/json' });
  if (blob.size > MAX_FILE) fail('Резервная копия превышает 128 МБ.');
  return blob;
}

function validateSnapshot(value) {
  safeTree(value);
  if (!plain(value) || value.format !== FORMAT || value.version !== VERSION || !Array.isArray(value.attachments)) fail('Выбери резервную копию zhekandus версии 1.');
  validateData(value.data);
  const ids = new Set();
  let bytes = 0;
  for (const record of value.attachments) {
    validateRecord(record);
    if (ids.has(record.id)) fail('В резервной копии повторяются вложения.');
    ids.add(record.id); bytes += record.size;
    if (bytes > MAX_FILE) fail('Вложения в резервной копии слишком большие.');
  }
  for (const id of attachmentReferences(value.data)) if (!ids.has(id)) fail('Резервная копия неполная: отсутствует вложение карточки.');
  return value;
}

export async function inspectBackup(file) {
  if (!file || typeof file.text !== 'function' || !file.size || file.size > MAX_FILE) fail('Выбери непустую резервную копию размером до 128 МБ.');
  let value;
  try { value = JSON.parse(await file.text()); } catch { fail('Не получилось прочитать JSON. Резервная копия повреждена.'); }
  validateSnapshot(value);
  value.summary = summary(value.data, value.attachments);
  return value;
}

function remap(value, mapping) {
  if (Array.isArray(value)) return value.map(item => remap(item, mapping));
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    typeof item === 'string' && MEDIA_REFERENCE_KEYS.test(key) ? mapping.get(item) || item : remap(item, mapping)]));
  return value;
}
async function stage(data, attachments, restoring = false) {
  const oldIds = restoring ? await readAttachments(true) : [];
  const mapping = new Map(), records = [];
  for (const record of attachments) {
    const bytes = record.blob ? new Uint8Array(await record.blob.arrayBuffer()) : validateRecord(record);
    const id = newId(); mapping.set(record.id, id);
    records.push({ id, type: record.type, name: record.name, size: bytes.length, blob: new Blob([bytes], { type: record.mime || record.blob.type }), createdAt: record.createdAt || Date.now(), ...(record.width ? { width: record.width, height: record.height } : {}) });
  }
  const result = remap(data, mapping);
  await writeAttachments(records);
  staged.set(result, { newIds: records.map(record => record.id), oldIds });
  return result;
}
export async function restoreBackup(snapshot) {
  // Revalidate even inspected objects: the preview object may have been edited.
  validateSnapshot(snapshot);
  return stage(snapshot.data, snapshot.attachments, true);
}
export async function stageImport(result) {
  if (!result || !Array.isArray(result.sets) || !Array.isArray(result.attachments)) fail('Не удалось подготовить импорт.');
  return stage(result.sets, result.attachments);
}
/** Call only after durable state commit. A failed cleanup cannot undo a restore. */
export async function commitStaged(value) {
  const entry = staged.get(value);
  if (!entry) return true;
  staged.delete(value);
  if (!entry.oldIds.length) return true;
  try { await writeAttachments(entry.oldIds, true); return true; }
  catch { return false; } // Data and new blobs remain valid if old-blob GC fails.
}
export async function discardStaged(value) {
  const entry = staged.get(value);
  if (!entry) return;
  await writeAttachments(entry.newIds, true);
  staged.delete(value);
}

export function csvRows(text, separator) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false, line = 1, startLine = 1;
  const addRow = () => { Object.defineProperty(row, 'sourceLine', { value: startLine }); if (row.some(value => value.trim())) rows.push(row); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else { field += char; if (char === '\n' || char === '\r' && text[i + 1] !== '\n') line++; }
    } else if (char === '"' && !field.trim()) { field = ''; quoted = true; afterQuote = false; }
    else if (char === separator) { row.push(field); field = ''; afterQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); addRow(); line++; startLine = line;
      row = []; field = ''; afterQuote = false;
    } else if (afterQuote && char.trim()) fail('После закрывающей кавычки в CSV должен быть разделитель или новая строка.');
    else field += char;
  }
  if (quoted) fail('В CSV не закрыта кавычка. Проверь строку перед импортом.');
  row.push(field); addRow();
  return rows;
}
export function separatorFor(text, directive) {
  const named = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };
  if (directive && (named[directive.toLowerCase()] || directive.length === 1)) return named[directive.toLowerCase()] || directive;
  let tabs = [];
  try { tabs = csvRows(text, '\t'); } catch { /* A quoted CSV may use another delimiter. */ }
  if (tabs.length && tabs.every(row => row.length >= 2)) return '\t';
  let winner = ',', score = 0;
  for (const separator of ['\t', ';', ',']) {
    let rows;
    try { rows = csvRows(text, separator).slice(0, 20); } catch { continue; }
    const counts = new Map();
    for (const row of rows) if (row.length >= 2) counts.set(row.length, (counts.get(row.length) || 0) + 1);
    const value = Math.max(0, ...[...counts].map(([columns, count]) => count * 100 + Math.min(columns, 20)));
    if (value > score) { score = value; winner = separator; }
  }
  return winner;
}
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const point = Number.parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return named[entity.toLowerCase()] || '';
  });
}
function plainText(html) {
  return decodeEntities(String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\[sound:[^\]]+\]/g, '')).trim();
}
const filenameTitle = name => String(name || 'Импортированный набор').replace(/\.(csv|tsv|txt|apkg|colpkg)$/i, '').trim() || 'Импортированный набор';
const normalizedHeader = value => String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
export const HEADER_ALIASES = {
  term: ['term', 'word', 'front', 'question', 'термин', 'слово', 'вопрос'],
  definition: ['definition', 'meaning', 'translation', 'back', 'answer', 'значение', 'определение', 'перевод', 'ответ'],
  example: ['example', 'sentence', 'пример', 'предложение'],
  film: ['film', 'movie', 'фильм', 'сериал'],
  episode: ['episode', 'серия', 'сезонсерия'],
  timecode: ['timecode', 'таймкод'],
  category: ['category', 'категория'],
  deck: ['deck', 'set', 'title', 'набор', 'колода', 'название'],
};
function textImport(text, name) {
  text = text.replace(/^\uFEFF/, '');
  const directives = {};
  const lines = text.split(/\r?\n/);
  let start = 0;
  // Directives only occur before the first card. A multiline quoted example can
  // itself contain a line starting with #deck:; its content must remain intact.
  for (; start < lines.length; start++) {
    const line = lines[start];
    const match = line.match(/^#(separator|html|columns|deckcolumn|notetypecolumn|guidcolumn|tagscolumn):\s*(.*)$/i);
    if (match) { directives[match[1].toLowerCase()] = match[2]; continue; }
    if (/^#(?:notetype|deck|tags):/i.test(line) || !line.trim()) continue;
    break;
  }
  text = lines.slice(start).join('\n');
  const separator = separatorFor(text, directives.separator);
  const rows = csvRows(text, separator);
  if (!rows.length) fail('В файле нет карточек.');
  let headers = directives.columns ? directives.columns.split(separator) : rows[0];
  const indices = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) indices[key] = headers.findIndex(value => aliases.includes(normalizedHeader(value)));
  const header = indices.term >= 0 && indices.definition >= 0;
  if (header && !directives.columns) rows.shift();
  if (!header) {
    const structural = new Set(['deckcolumn', 'notetypecolumn', 'guidcolumn', 'tagscolumn'].map(key => Number(directives[key]) - 1).filter(value => value >= 0));
    const content = rows[0].map((_, index) => index).filter(index => !structural.has(index));
    indices.term = content[0] ?? 0; indices.definition = content[1] ?? 1;
    indices.example = content[2] ?? -1;
    indices.category = -1;
    indices.deck = directives.deckcolumn ? Number(directives.deckcolumn) - 1 : -1;
  }
  const groups = new Map();
  let skipped = 0;
  for (const row of rows) {
    const clean = value => directives.html?.toLowerCase() === 'true' ? plainText(value) : String(value ?? '').trim();
    const term = clean(row[indices.term]), definition = clean(row[indices.definition]);
    if (!term || !definition) { skipped++; continue; }
    const title = clean(row[indices.deck]) || filenameTitle(name), category = clean(row[indices.category]);
    const key = `${title}\0${category}`;
    if (!groups.has(key)) groups.set(key, { title, desc: `Импорт из ${name || 'файла'}`, category, symbol: 'letters', cards: [] });
    const example = indices.example >= 0 ? clean(row[indices.example]) : '';
    const metadata = example ? { example } : {};
    for (const field of ['film', 'episode', 'timecode']) { const value = indices[field] >= 0 ? clean(row[indices[field]]) : ''; if (value) metadata[field] = value; }
    groups.get(key).cards.push([term, definition, metadata]);
  }
  const sets = [...groups.values()];
  if (!sets.length) fail('Нужны хотя бы две заполненные колонки: термин и значение.');
  if (sets.reduce((sum, set) => sum + set.cards.length, 0) > 100000) fail('За один раз можно импортировать не больше 100 000 карточек.');
  const attachments = [], warnings = skipped ? [`Пропущено строк без термина или значения: ${skipped}.`] : [];
  return { sets, attachments, warnings, summary: { sets: sets.length, cards: sets.reduce((sum, set) => sum + set.cards.length, 0), attachments: 0, bytes: 0 } };
}

/** Text export uses the same column names accepted by parseImport. */
export function exportCSV(data) {
  validateData(data);
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [['термин', 'определение', 'пример', 'категория', 'набор']];
  for (const set of data.sets) for (const card of set.cards) {
    rows.push([card[0], card[1], card[2]?.example || '', set.category || '', set.title]);
  }
  return new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

/** Anki's text importer accepts tab columns, HTML fields, deck and tags. */
export function exportAnki(data) {
  validateData(data);
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])).replace(/\r?\n/g, '<br>').replace(/\t/g, '&#9;');
  const header = '#separator:tab\n#html:true\n#columns:Front\tBack\tExample\tMovie\tEpisode\tTimecode\tDeck\tTags\n#deckcolumn:7\n#tagscolumn:8\n';
  const rows = data.sets.flatMap(set => set.cards.map(card => [card[0], card[1], card[2]?.example, card[2]?.film, card[2]?.episode, card[2]?.timecode, set.title, card[2]?.starred ? 'zhekandus_hard' : ''].map(escape).join('\t')));
  return new Blob([header + rows.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
}

export async function parseImport(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_FILE) fail('Выбери непустой CSV, TXT или TSV размером до 128 МБ.');
  const name = String(file.name || 'Импортированный набор');
  const archiveMessage = 'Импорт архивов Anki (.apkg) удалён. Экспортируй колоду из Anki в текстовый файл (.txt/.tsv) или CSV.';
  if (/\.(apkg|colpkg|zip)$/i.test(name)) fail(archiveMessage);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3])) fail(archiveMessage);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('Не удалось прочитать текст. Сохрани CSV или экспорт Anki в кодировке UTF-8.'); }
  if (text.includes('\0')) fail('Это двоичный файл. Выбери CSV или текстовый экспорт Anki (.txt/.tsv) в UTF-8.');
  return textImport(text, name);
}
