/** Local image attachments. Legacy attachment bytes remain readable for backup v1. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_EDGE = 1200;
const DATABASE_NAME = 'zhekandus-media', STORE_NAME = 'attachments';
let databasePromise, mediaEpoch = 0;
const mediaUrls = new Map(), mediaNodeTokens = new WeakMap();

function mediaStorageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('Не хватает места для файла. Удали ненужные вложения или выбери файл поменьше.');
  return new Error('Браузер не разрешил сохранить вложение. Открой приложение в обычной вкладке; текстовые карточки продолжат работать.');
}

function openMediaDatabase() {
  if (databasePromise) return databasePromise;
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) return Promise.reject(new Error('Вложения недоступны в этом браузере. Текстовые карточки можно сохранять как обычно.'));
  databasePromise = new Promise((resolve, reject) => {
    let finished = false;
    let request;
    const timer = setTimeout(() => fail(), 8000);
    function fail(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(mediaStorageError(error));
    }
    try {
      request = indexedDB.open(DATABASE_NAME, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail();
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true;
        clearTimeout(timer);
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = undefined; };
        resolve(database);
      };
    } catch (error) {
      fail(error);
    }
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function transact(mode, operation) {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    let result;
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(mediaStorageError(transaction.error));
      transaction.onabort = () => reject(mediaStorageError(transaction.error));
    } catch (error) {
      reject(mediaStorageError(error));
    }
  });
}

async function decodeImage(blob) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try { return await globalThis.createImageBitmap(blob); } catch { /* Safari/format fallback. */ }
  }
  if (!globalThis.document || !globalThis.Image) throw new Error('Браузер не поддерживает обработку изображений.');
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку. Выбери JPG, PNG или WebP.')); };
    image.src = url;
  });
}

async function prepareImage(file) {
  const image = await decodeImage(file);
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height || width * height > 80000000) throw new Error('Картинка слишком большая. Выбери изображение меньшего разрешения.');
    if (!globalThis.document) throw new Error('Обработка картинок недоступна в этом браузере.');
    const ratio = Math.min(1, IMAGE_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает обработку изображений.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // WebP preserves transparent PNG artwork; browsers without WebP encoding
    // fall back to PNG. JPEG inputs remain JPEG at a high quality setting.
    const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.92));
    if (!blob) throw new Error('Не удалось обработать картинку. Попробуй другой файл.');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    image.close?.();
  }
}

export async function storeAttachment(file, kind = 'image') {
  if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') throw new Error('Выбери файл для вложения.');
  if (kind !== 'image') throw new Error('Можно добавить только картинку.');
  if (!file.size) throw new Error('Файл пустой. Выбери другой файл.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Максимальный размер вложения — 8 МБ.');
  const name = String(file.name || 'Картинка').slice(0, 200);
  const mime = String(file.type || '').toLowerCase();
  if (mime.includes('svg') || /\.svgz?$/i.test(name)) throw new Error('SVG не поддерживается. Выбери JPG, PNG или WebP.');
  if (!/^image\/(jpeg|png|webp|gif|bmp|avif|x-ms-bmp)$/.test(mime) && !(mime === '' && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name))) throw new Error('Выбери картинку в формате JPG, PNG, WebP, GIF или AVIF.');
  if (/<svg(?:\s|>)/i.test(await file.slice(0, 2048).text())) throw new Error('SVG не поддерживается. Выбери JPG, PNG или WebP.');
  const prepared = await prepareImage(file);
  const id = globalThis.crypto?.randomUUID?.() || `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const record = { id, type: 'image', name, size: prepared.blob.size, createdAt: Date.now(), ...prepared };
  await transact('readwrite', store => store.put(record));
  return { id, type: 'image', name, size: record.size };
}

export async function loadAttachment(id) {
  if (!id || typeof id !== 'string') return undefined;
  return transact('readonly', store => store.get(id));
}

export async function removeAttachment(id) {
  if (!id || typeof id !== 'string') return;
  await transact('readwrite', store => store.delete(id));
}

export function attachmentMarkup(card, esc, { image = true } = {}) {
  const media = card?.[2] || {};
  const parts = [];
  if (image && media.imageId) parts.push(`<img class="card-image" data-image-id="${esc(media.imageId)}" alt="${esc(media.imageName || 'Картинка к карточке')}" loading="lazy" decoding="async">`);
  return parts.length ? `<div class="card-media">${parts.join('')}</div>` : '';
}

function revokeNodeUrl(node) {
  const url = mediaUrls.get(node);
  if (!url) return;
  node.removeAttribute('src');
  URL.revokeObjectURL(url);
  mediaUrls.delete(node);
}

/** Hydrate newly-rendered media; keep URLs for live nodes, discard detached ones. */
export async function hydrateAttachments(container) {
  if (!container?.querySelectorAll || typeof globalThis.URL?.createObjectURL !== 'function') return;
  for (const node of mediaUrls.keys()) if (!node.isConnected) revokeNodeUrl(node);
  const epoch = mediaEpoch;
  const loads = new Map();
  const nodes = [...container.querySelectorAll('[data-image-id]')];
  if (container.matches?.('[data-image-id]')) nodes.unshift(container);
  await Promise.all(nodes.map(async node => {
    const id = node.dataset.imageId;
    if (mediaUrls.has(node) && node.dataset.mediaLoaded === id) return;
    const token = Symbol();
    mediaNodeTokens.set(node, token);
    try {
      if (!loads.has(id)) loads.set(id, loadAttachment(id));
      const record = await loads.get(id);
      if (epoch !== mediaEpoch || mediaNodeTokens.get(node) !== token || !node.isConnected) return;
      if (!record?.blob) throw new Error('Вложение не найдено');
      revokeNodeUrl(node);
      const url = URL.createObjectURL(record.blob);
      mediaUrls.set(node, url);
      node.src = url;
      node.dataset.mediaLoaded = id;
      node.removeAttribute('data-media-error');
    } catch {
      if (epoch !== mediaEpoch || mediaNodeTokens.get(node) !== token) return;
      node.dataset.mediaError = 'true';
      node.setAttribute('title', 'Вложение недоступно в этом браузере или было удалено.');
      if (node.tagName === 'IMG') node.alt = 'Картинка недоступна';
    }
  }));
}

export function releaseMediaUrls() {
  mediaEpoch += 1;
  for (const node of [...mediaUrls.keys()]) revokeNodeUrl(node);
}
