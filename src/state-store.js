// The attachment and application state stores share one database. Keep the
// version in sync with media.js so either store can be opened first.
export const DATABASE_NAME = 'zhekandus-media';
export const DATABASE_VERSION = 2;
export const LEGACY_STATE_KEY = 'lexi-data';
export const STATE_STORE = 'state';
const STATE_KEY = 'main';

export function formatStorageError(error) {
  const name = error?.name || '';
  const message = String(error?.message || '');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014 || /quota|disk.{0,10}full|no space/i.test(message)) {
    return 'Не хватает места для сохранения. Освободи место на устройстве или удали ненужные вложения. Изменения пока не сохранены; сделай резервную копию перед закрытием.';
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return 'Доступ к хранилищу заблокирован настройками браузера. Разреши хранение данных для этого приложения или открой его в обычном режиме. Изменения пока не сохранены.';
  }
  if (name === 'NotSupportedError') {
    return 'В этом браузере недоступно локальное хранилище IndexedDB. Открой приложение в современном браузере. Изменения пока не сохранены.';
  }
  if (name === 'BlockedError') {
    return 'Не удалось открыть хранилище: закрой другие вкладки zhekandus и попробуй сохранить ещё раз. Изменения пока не сохранены.';
  }
  if (name === 'CorruptStateError') {
    return 'Сохранённые данные повреждены или имеют неизвестный формат. Они не изменены. Восстанови резервную копию zhekandus.';
  }
  return 'Не удалось сохранить данные на устройстве. Попробуй ещё раз и сделай резервную копию перед закрытием.';
}

function isState(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.sets);
}

/**
 * save() only retains the current state reference and restarts a timer. IndexedDB
 * clones it when the eventual transaction begins, rather than cloning a large
 * collection after every answer. commit() and flush() wait for durable writes.
 */
export function createStateStore({
  indexedDB,
  storage,
  navigator,
  debounceMs = 300,
  onError,
  databaseName = DATABASE_NAME,
} = {}) {
  // Browser privacy policies may throw from these property getters themselves.
  // Defer reporting until load(), where the caller can render its error screen.
  let indexedDBAccessError, legacyStorageAccessError;
  if (indexedDB === undefined) {
    try { indexedDB = globalThis.indexedDB; } catch (error) { indexedDBAccessError = error; }
  }
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch (error) { legacyStorageAccessError = error; }
  }
  if (navigator === undefined) {
    try { navigator = globalThis.navigator; } catch { /* Persistence is optional. */ }
  }
  let database, opening, loading, timer, pendingValue, writing;
  let wantedVersion = 0, savedVersion = 0, persistenceRequested = false;
  let lastError = null, persistent = null, migratingLegacy = null;
  const listeners = new Set();
  const status = () => ({ dirty: wantedVersion > savedVersion, saving: Boolean(writing), error: lastError, persistent });
  const announce = () => {
    const value = status();
    for (const listener of listeners) {
      try { listener(value); } catch { /* A UI listener must not stop saving. */ }
    }
  };
  const report = cause => {
    const error = new Error(formatStorageError(cause), { cause });
    error.name = cause?.name || 'StorageError';
    lastError = error;
    announce();
    try { onError?.(error); } catch { /* Saving errors remain available in status. */ }
    return error;
  };

  function open() {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (indexedDBAccessError) { reject(indexedDBAccessError); return; }
      if (!indexedDB) {
        reject(new DOMException('IndexedDB unavailable', 'NotSupportedError'));
        return;
      }
      let request, settled = false;
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      try { request = indexedDB.open(databaseName, DATABASE_VERSION); }
      catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new DOMException('Database upgrade blocked', 'BlockedError'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        database = db;
        db.onversionchange = () => { db.close(); if (database === db) database = undefined; opening = undefined; };
        resolve(db);
      };
    });
    opening.catch(() => { opening = undefined; });
    return opening;
  }

  function requestPersistence() {
    if (persistenceRequested) return;
    persistenceRequested = true;
    // The request is a best effort; a denial must not prevent a normal save.
    try {
      Promise.resolve(navigator?.storage?.persist?.()).then(value => {
        if (typeof value === 'boolean') { persistent = value; announce(); }
      }).catch(() => {});
    } catch { /* Some browser configurations reject this optional request. */ }
  }

  function read(db) {
    return new Promise((resolve, reject) => {
      let transaction, result;
      try {
        transaction = db.transaction(STATE_STORE, 'readonly');
        const request = transaction.objectStore(STATE_STORE).get(STATE_KEY);
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error || new DOMException('Read aborted', 'AbortError'));
        transaction.onerror = () => {}; // onabort reports the actual transaction error.
      } catch (error) { reject(error); }
    });
  }

  function beginWrite(db) {
    // Capturing the revision here also includes saves received while open()
    // was pending. objectStore.put synchronously snapshots pendingValue.
    const version = wantedVersion;
    requestPersistence();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STATE_STORE, 'readwrite');
        transaction.oncomplete = () => { savedVersion = version; lastError = null; resolve(); };
        transaction.onabort = () => reject(transaction.error || new DOMException('Write aborted', 'AbortError'));
        transaction.onerror = () => {};
        transaction.objectStore(STATE_STORE).put(pendingValue, STATE_KEY);
      } catch (error) {
        // If structured cloning fails, abort before the transaction can commit.
        try { transaction?.abort(); } catch {}
        reject(error);
      }
    });
  }

  async function flush() {
    clearTimeout(timer); timer = undefined;
    while (wantedVersion > savedVersion) {
      if (!writing) {
        // Begin synchronously when the connection is already open. This lets
        // pagehide/visibilitychange start a transaction without a timer or an
        // initial await. Browsers can still terminate a page before completion.
        const operation = database ? beginWrite(database) : open().then(beginWrite);
        writing = operation.catch(error => { throw report(error); }).finally(() => { writing = undefined; announce(); });
        announce();
      }
      await writing;
    }
    if (migratingLegacy !== null) {
      try {
        // A previous migration may have run out of quota. A successful retry
        // can now remove that copy, but must preserve edits from an old tab.
        if (storage?.getItem(LEGACY_STATE_KEY) === migratingLegacy) storage?.removeItem(LEGACY_STATE_KEY);
        migratingLegacy = null;
      } catch { /* The state is already committed; an extra legacy copy is safe. */ }
    }
    return true;
  }

  function save(value) {
    if (!isState(value)) {
      report(new TypeError('Application state must contain sets'));
      return false;
    }
    pendingValue = value;
    wantedVersion++;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void flush().catch(() => {}); }, Math.max(0, debounceMs));
    announce();
    return true;
  }

  async function commit(value) {
    if (!save(value)) throw lastError;
    return flush();
  }

  function load(fallback) {
    if (loading) return loading;
    loading = (async () => {
      let db;
      try {
        db = await open();
        const current = await read(db);
        if (isState(current)) { lastError = null; announce(); return current; }
        if (current !== undefined) throw Object.assign(new Error('Invalid stored state'), { name: 'CorruptStateError' });
      } catch (error) {
        // A failed read does not prove that the database is empty. Returning
        // fallback here would let the caller accidentally overwrite real data.
        throw report(error);
      }
      let legacy, raw;
      try {
        // A blocked legacy getter is irrelevant once valid IndexedDB state was
        // loaded, but cannot safely be treated as an empty first-run database.
        if (legacyStorageAccessError) throw legacyStorageAccessError;
        raw = storage?.getItem(LEGACY_STATE_KEY);
        if (raw !== null && raw !== undefined) {
          try { legacy = JSON.parse(raw); }
          catch { throw Object.assign(new Error('Invalid legacy state'), { name: 'CorruptStateError' }); }
          if (!isState(legacy)) throw Object.assign(new Error('Invalid legacy state'), { name: 'CorruptStateError' });
        }
      } catch (error) { throw report(error); }
      if (!isState(legacy)) return fallback;
      migratingLegacy = raw;
      try {
        // Removing the original requires transaction.oncomplete, not merely
        // the request's success event; an abort can still happen after put().
        await commit(legacy);
      } catch { /* Keep the legacy copy and let the user retry or export it. */ }
      return legacy;
    })();
    const attempt = loading;
    attempt.catch(() => { if (loading === attempt) loading = undefined; });
    return loading;
  }

  return {
    load, save, commit, flush,
    get status() { return status(); },
    subscribe(listener) { listeners.add(listener); listener(status()); return () => listeners.delete(listener); },
    close() { clearTimeout(timer); timer = undefined; database?.close(); database = undefined; opening = undefined; },
  };
}
