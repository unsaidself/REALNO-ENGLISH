/** Portable local backups and CSV/Anki imports. No network or server is used. */
import { unzipSync } from 'fflate';
import { Decompress } from 'fzstd';
import initSqlJs from 'sql.js/dist/sql-asm.js';

const FORMAT = 'zhekandus-backup';
const VERSION = 1;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_MEDIA = 8 * 1024 * 1024;
const MAX_DATABASE = 64 * 1024 * 1024;
const DB_NAME = 'zhekandus-media';
const STORE = 'attachments';
const staged = new WeakMap();
let sqlPromise;
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
  for (const key of ['daily', 'reviews', 'settings']) if (data[key] !== undefined && !plain(data[key])) fail('Некорректные настройки или история повторений.');
  for (const [date, record] of Object.entries(data.daily || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !plain(record) || !nonnegativeInteger(record.answers) || !nonnegativeInteger(record.correct) || record.correct > record.answers) fail('Некорректная активность в календаре.');
  }
  for (const review of Object.values(data.reviews || {})) {
    if (!plain(review) || !nonnegativeInteger(review.level) || !Number.isFinite(review.due) || review.due < 0 || !Number.isFinite(review.interval) || review.interval < 0 || !Number.isFinite(review.lastReviewed) || review.lastReviewed < 0) fail('Некорректное расписание повторений.');
  }
  if (data.settings?.goal !== undefined && (!Number.isInteger(data.settings.goal) || data.settings.goal < 1 || data.settings.goal > 500)) fail('Некорректная дневная цель.');
  if (data.categories !== undefined && (!Array.isArray(data.categories) || data.categories.some(value => typeof value !== 'string'))) fail('Некорректный список категорий.');
  if (data.days !== undefined && (!Array.isArray(data.days) || data.days.some(value => typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)))) fail('Некорректный календарь занятий.');
  return cards;
}

async function openDatabase() {
  if (!globalThis.indexedDB) fail('Браузер не поддерживает хранилище вложений. Открой файл в обычной вкладке Chrome, Edge или Safari.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Хранилище вложений занято. Закрой другие вкладки приложения и повтори попытку.')), 8000);
    function finish(error, db) {
      if (settled) { db?.close(); return; }
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(db);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
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
      catch (error) { tx.abort(); reject(error); }
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
/** Call only after localStorage commit. A failed cleanup cannot undo a restore. */
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

function csvRows(text, separator) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else field += char;
    } else if (char === '"' && !field) { quoted = true; afterQuote = false; }
    else if (char === separator) { row.push(field); field = ''; afterQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row);
      row = []; field = ''; afterQuote = false;
    } else if (afterQuote && char.trim()) fail('После закрывающей кавычки в CSV должен быть разделитель или новая строка.');
    else field += char;
  }
  if (quoted) fail('В CSV не закрыта кавычка. Проверь строку перед импортом.');
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function separatorFor(text, directive) {
  const named = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };
  if (directive && (named[directive.toLowerCase()] || directive.length === 1)) return named[directive.toLowerCase()] || directive;
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
const HEADER_ALIASES = {
  term: ['term', 'word', 'front', 'question', 'термин', 'слово', 'вопрос'],
  definition: ['definition', 'meaning', 'translation', 'back', 'answer', 'значение', 'определение', 'перевод', 'ответ'],
  example: ['example', 'sentence', 'пример', 'предложение'],
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
    const title = clean(row[indices.deck]) || filenameTitle(name), category = clean(row[indices.category]) || 'Импорт';
    const key = `${title}\0${category}`;
    if (!groups.has(key)) groups.set(key, { title, desc: `Импорт из ${name || 'файла'}`, category, symbol: 'letters', color: 'neutral', cards: [] });
    const example = indices.example >= 0 ? clean(row[indices.example]) : '';
    groups.get(key).cards.push([term, definition, example ? { example } : {}]);
  }
  const sets = [...groups.values()];
  if (!sets.length) fail('Нужны хотя бы две заполненные колонки: термин и значение.');
  if (sets.reduce((sum, set) => sum + set.cards.length, 0) > 100000) fail('За один раз можно импортировать не больше 100 000 карточек.');
  const attachments = [], warnings = skipped ? [`Пропущено строк без термина или значения: ${skipped}.`] : [];
  return { sets, attachments, warnings, summary: { sets: sets.length, cards: sets.reduce((sum, set) => sum + set.cards.length, 0), attachments: 0, bytes: 0 } };
}

async function sqlite() {
  if (!sqlPromise) sqlPromise = initSqlJs().catch(error => { sqlPromise = undefined; throw error; });
  return sqlPromise;
}
function query(db, sql) {
  const result = db.exec(sql)[0];
  return result ? result.values.map(values => Object.fromEntries(result.columns.map((name, index) => [name, values[index]]))) : [];
}
function zstd(bytes, max, label) {
  if (bytes.length < 8 || bytes[0] !== 0x28 || bytes[1] !== 0xb5 || bytes[2] !== 0x2f || bytes[3] !== 0xfd) fail('Некорректный Zstandard-архив.');
  const descriptor = bytes[4], single = !!(descriptor & 32), sizeFlag = descriptor >> 6;
  if (descriptor & 8) fail('Некорректный заголовок Zstandard.');
  let offset = 5, window = 0;
  if (!single) {
    const wd = bytes[offset++], base = 2 ** (10 + (wd >> 3));
    window = base + (base / 8) * (wd & 7);
    if (window > max) fail(`${label} требует слишком много памяти.`);
  }
  const dictionaryLength = [0, 1, 2, 4][descriptor & 3];
  offset += dictionaryLength;
  const sizeLength = sizeFlag ? 2 ** sizeFlag : single ? 1 : 0;
  if (offset + sizeLength > bytes.length) fail('Неполный заголовок Zstandard.');
  let declared = 0n;
  for (let index = sizeLength - 1; index >= 0; index--) declared = declared * 256n + BigInt(bytes[offset + index]);
  if (sizeFlag === 1) declared += 256n;
  if (declared > BigInt(max)) fail(`${label} слишком большой после распаковки.`);
  offset += sizeLength;
  // Anki emits one frame. Reject concatenated frames before the decoder could
  // allocate a second, unvalidated window; inspect block sizes without inflating.
  let last = false;
  while (!last) {
    if (offset + 3 > bytes.length) fail('Неполный блок Zstandard.');
    const header = bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
    last = !!(header & 1);
    const kind = (header >> 1) & 3, length = header >> 3;
    if (kind === 3) fail('Некорректный блок Zstandard.');
    offset += 3 + (kind === 1 ? 1 : length);
    if (offset > bytes.length) fail('Неполный блок Zstandard.');
  }
  offset += descriptor & 4 ? 4 : 0;
  if (offset !== bytes.length) fail('Неподдерживаемые дополнительные кадры Zstandard.');
  const chunks = [];
  let size = 0;
  const decoder = new Decompress(chunk => {
    size += chunk.length;
    if (size > max) fail(`${label} слишком большой после распаковки.`);
    chunks.push(chunk.slice());
  });
  decoder.push(bytes, true);
  const result = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
  return result;
}
function mediaKind(name) {
  const extension = String(name).split('.').pop().toLowerCase();
  const map = { jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], png: ['image', 'image/png'], webp: ['image', 'image/webp'], gif: ['image', 'image/gif'], bmp: ['image', 'image/bmp'], avif: ['image', 'image/avif'], mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], oga: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'], aac: ['audio', 'audio/aac'], webm: ['audio', 'audio/webm'], flac: ['audio', 'audio/flac'] };
  return map[extension];
}
function mediaReferences(html) {
  const sound = String(html).match(/\[sound:([^\]]+)\]/i)?.[1];
  const image = String(html).match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return { audio: sound ? decodeEntities(sound) : undefined, image: image ? decodeEntities(image[1] || image[2] || image[3]) : undefined };
}

// Small, schema-specific protobuf reader for Anki's MediaEntries message.
// Field 1 repeats MediaEntry { string name=1; uint32 size=2; bytes sha1=3; }.
function protobufMedia(bytes) {
  function fields(input) {
    const result = [];
    let offset = 0;
    const variable = () => {
      let value = 0, factor = 1, count = 0;
      while (offset < input.length && count++ < 10) {
        const byte = input[offset++]; value += (byte & 127) * factor;
        if (!Number.isSafeInteger(value)) fail('Некорректное число в списке вложений Anki.');
        if (!(byte & 128)) return value;
        factor *= 128;
      }
      fail('Неполный список вложений Anki.');
    };
    while (offset < input.length) {
      const key = variable(), wire = key & 7, field = Math.floor(key / 8);
      if (!field) fail('Некорректный список вложений Anki.');
      let value;
      if (wire === 0) value = variable();
      else if (wire === 2) {
        const length = variable();
        if (offset + length > input.length) fail('Неполный список вложений Anki.');
        value = input.subarray(offset, offset + length); offset += length;
      } else if (wire === 1 || wire === 5) {
        offset += wire === 1 ? 8 : 4;
        if (offset > input.length) fail('Неполный список вложений Anki.');
      } else fail('Неподдерживаемый формат списка вложений Anki.');
      result.push({ field, wire, value });
    }
    return result;
  }
  const map = {};
  let index = 0;
  for (const outer of fields(bytes)) {
    if (outer.field !== 1 || outer.wire !== 2) continue;
    const entry = fields(outer.value), name = entry.find(item => item.field === 1 && item.wire === 2)?.value;
    if (!name) fail('В списке вложений Anki отсутствует имя файла.');
    const filename = new TextDecoder('utf-8', { fatal: true }).decode(name);
    if (!filename || filename.includes('\0')) fail('Некорректное имя вложения Anki.');
    const legacyIndex = entry.find(item => item.field === 255 && item.wire === 0)?.value;
    map[String(legacyIndex ?? index)] = filename;
    index++;
  }
  return map;
}

async function ankiImport(bytes, name) {
  let expanded = 0, entries;
  try {
    entries = unzipSync(bytes, { filter: entry => {
      if (entry.originalSize > MAX_EXPANDED || (expanded += entry.originalSize) > MAX_EXPANDED) fail('Anki-архив слишком большой после распаковки.');
      return /^(?:collection\.anki(?:2|21|21b)|media|\d+)$/.test(entry.name);
    } });
  } catch (error) { fail(error?.message?.includes('слишком') ? error.message : 'Не удалось распаковать Anki. Выбери настоящий файл .apkg или текстовый экспорт Anki.'); }
  const databaseKey = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find(key => entries[key]);
  if (!databaseKey) fail('В Anki-архиве нет базы карточек. Экспортируй колоду в .apkg ещё раз.');
  let databaseBytes = entries[databaseKey];
  if (databaseKey.endsWith('21b')) {
    try { databaseBytes = zstd(databaseBytes, MAX_DATABASE, 'База Anki'); }
    catch { fail('Не удалось прочитать современную сжатую базу Anki. Экспортируй .apkg с опцией совместимости со старыми версиями.'); }
  }
  if (databaseBytes.length > MAX_DATABASE || new TextDecoder().decode(databaseBytes.subarray(0, 16)) !== 'SQLite format 3\0') fail('Некорректная или слишком большая база Anki.');
  const SQL = await sqlite();
  let db;
  try { db = new SQL.Database(databaseBytes); } catch { fail('База Anki повреждена. Экспортируй колоду заново.'); }
  try {
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
    if (!tables.has('notes') || !tables.has('cards')) fail('В базе Anki нет заметок или карточек.');
    const notes = query(db, 'SELECT id, mid, flds FROM notes'), cards = query(db, 'SELECT nid, did, ord FROM cards');
    const deckNames = new Map(), modelFields = new Map();
    if (tables.has('col')) {
      const col = query(db, 'SELECT decks, models FROM col LIMIT 1')[0];
      for (const deck of Object.values(JSON.parse(col?.decks || '{}'))) deckNames.set(String(deck.id), deck.name);
      for (const model of Object.values(JSON.parse(col?.models || '{}'))) modelFields.set(String(model.id), (model.flds || []).map(field => field.name));
    }
    if (tables.has('decks')) for (const deck of query(db, 'SELECT id, name FROM decks')) deckNames.set(String(deck.id), deck.name);
    if (tables.has('fields')) for (const field of query(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) {
      if (!modelFields.has(String(field.ntid))) modelFields.set(String(field.ntid), []);
      modelFields.get(String(field.ntid))[field.ord] = field.name;
    }
    const firstCard = new Map();
    for (const card of cards) if (!firstCard.has(String(card.nid))) firstCard.set(String(card.nid), card);
    let mediaMap = {};
    if (entries.media?.length) {
      let manifest = entries.media;
      // Legacy APKG uses JSON; current Anki uses a Zstandard-compressed
      // protobuf MediaEntries message, with ZIP filenames matching entry indices.
      if (manifest[0] === 0x28 && manifest[1] === 0xb5) manifest = zstd(manifest, 4 * 1024 * 1024, 'Список вложений Anki');
      try { mediaMap = databaseKey.endsWith('21b') ? protobufMedia(manifest) : JSON.parse(new TextDecoder().decode(manifest)); }
      catch (error) { fail(error?.message?.includes('Anki') ? error.message : 'Не удалось прочитать список вложений Anki. Экспортируй колоду заново.'); }
      safeTree(mediaMap);
      if (!plain(mediaMap)) fail('Некорректный список вложений Anki.');
    }
    const mediaByName = new Map(Object.entries(mediaMap).map(([key, value]) => [String(value), key]));
    const attachments = [], byFilename = new Map(), warnings = new Set();
    const obtainAttachment = (filename, kind) => {
      if (!filename) return undefined;
      if (byFilename.has(filename)) return byFilename.get(filename);
      const entryKey = mediaByName.get(filename), source = entryKey !== undefined ? entries[entryKey] : undefined;
      const info = mediaKind(filename);
      if (!source || !info || info[0] !== kind) { warnings.add(`Вложение не импортировано: ${filename}. Поддерживаются растровые картинки и обычные аудиофайлы.`); return undefined; }
      let content = source;
      if (databaseKey.endsWith('21b') && content[0] === 0x28 && content[1] === 0xb5) content = zstd(content, MAX_MEDIA, 'Вложение Anki');
      if (!content.length || content.length > MAX_MEDIA) { warnings.add(`Вложение ${filename} превышает 8 МБ или пустое.`); return undefined; }
      if (kind === 'image' && /<svg(?:\s|>)/i.test(new TextDecoder().decode(content.subarray(0, 2048)))) { warnings.add(`SVG ${filename} пропущен. Используй PNG или JPG.`); return undefined; }
      const record = { id: `anki-${newId()}`, type: kind, name: filename.slice(0, 200), size: content.length, mime: info[1], blob: new Blob([content], { type: info[1] }) };
      attachments.push(record); byFilename.set(filename, record.id); return record.id;
    };
    const groups = new Map();
    let skipped = 0, imported = 0;
    for (const note of notes) {
      const card = firstCard.get(String(note.id));
      if (!card) { skipped++; continue; }
      const fields = String(note.flds || '').split('\x1f');
      const names = modelFields.get(String(note.mid)) || [];
      const front = names.findIndex(field => HEADER_ALIASES.term.includes(normalizedHeader(field)));
      const back = names.findIndex(field => HEADER_ALIASES.definition.includes(normalizedHeader(field)));
      const exampleIndex = names.findIndex(field => HEADER_ALIASES.example.includes(normalizedHeader(field)));
      const frontHtml = fields[front >= 0 ? front : 0] || '', backHtml = fields[back >= 0 ? back : 1] || '';
      const clozes = [...frontHtml.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi)];
      const term = plainText(frontHtml), definition = plainText(backHtml);
      const fullExample = clozes.length ? plainText(frontHtml.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/gi, '$1')) : '';
      const baseExample = exampleIndex >= 0 ? plainText(fields[exampleIndex]) : '';
      const variants = clozes.length
        ? clozes.map(match => ({ term: plainText(match[2]), definition: plainText(match[3] || '') || definition || fullExample, example: fullExample }))
        : [{ term, definition, example: baseExample }];
      if (clozes.length) warnings.add('В Cloze каждый пропуск сохранён отдельной карточкой: ответ — термин, подсказка — значение, предложение — пример.');
      else if (front < 0 || back < 0) warnings.add('В пользовательских типах Anki без полей Front/Back используются первые два поля. Проверь термины и значения после импорта.');
      const title = String(deckNames.get(String(card.did)) || filenameTitle(name)).replace(/\x1f|::/g, ' / ');
      const refs = mediaReferences(`${frontHtml}\n${backHtml}`);
      let media;
      const duplicates = new Set();
      for (const variant of variants) {
        if (!variant.term || !variant.definition) { skipped++; continue; }
        const key = `${variant.term}\0${variant.definition}`;
        if (duplicates.has(key)) continue;
        duplicates.add(key);
        if (!groups.has(title)) groups.set(title, { title, desc: `Импорт из Anki: ${name}`, category: 'Anki', color: 'neutral', symbol: 'letters', cards: [] });
        if (!media) {
          const imageId = obtainAttachment(refs.image, 'image'), audioId = obtainAttachment(refs.audio, 'audio');
          media = { ...(imageId ? { imageId, imageName: refs.image } : {}), ...(audioId ? { audioId, audioName: refs.audio } : {}) };
        }
        groups.get(title).cards.push([variant.term, variant.definition, { ...(variant.example ? { example: variant.example } : {}), ...media }]);
        if (++imported > 100000) fail('За один раз можно импортировать не больше 100 000 карточек.');
      }
    }
    const sets = [...groups.values()];
    if (!sets.length) fail('В Anki нет карточек с заполненными лицевой и обратной стороной.');
    if (skipped) warnings.add(`Пропущено заметок без двух заполненных полей: ${skipped}.`);
    warnings.add('Импортированы содержимое и поддерживаемые вложения. Расписание повторений Anki и шаблоны оформления не переносятся.');
    return { sets, attachments, warnings: [...warnings], summary: { sets: sets.length, cards: sets.reduce((sum, set) => sum + set.cards.length, 0), attachments: attachments.length, bytes: attachments.reduce((sum, record) => sum + record.size, 0) } };
  } catch (error) {
    if (/SQL|no such|file is not|malformed|out of memory/i.test(error?.message || '')) fail('Не удалось прочитать структуру Anki. Экспортируй .apkg в режиме совместимости или текст с разделителями.');
    throw error;
  } finally { db.close(); }
}

export async function parseImport(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_FILE) fail('Выбери непустой CSV, TXT, TSV или APKG размером до 128 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = String(file.name || 'Импортированный набор');
  if (/\.(apkg|colpkg)$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return ankiImport(bytes, name);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('Не удалось прочитать текст. Сохрани CSV или экспорт Anki в кодировке UTF-8.'); }
  if (text.includes('\0')) fail('Это двоичный файл. Для Anki выбери .apkg, для таблицы — CSV в UTF-8.');
  return textImport(text, name);
}
