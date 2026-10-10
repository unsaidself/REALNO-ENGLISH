import { createBackup } from './portability.js';

async function handleStore(value, writing = false) {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('zhekandus-media',2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('state', writing ? 'readwrite' : 'readonly');
      const operation = writing ? (value ? tx.objectStore('state').put(value,'backup-file-handle') : tx.objectStore('state').delete('backup-file-handle')) : tx.objectStore('state').get('backup-file-handle');
      let result; operation.onsuccess = () => { result = operation.result; };
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
export function createAutoBackup({ getData, onWritten = () => {}, onChange = () => {}, makeBackup = createBackup, loadHandle = () => handleStore(), saveHandle = value => handleStore(value,true), picker = (...args) => globalThis.showSaveFilePicker(...args) } = {}) {
  let handle = null, lastFilename = '', lastWrittenAt = 0, timer, active = false, revision = 0, written = 0, error = '', paused = false;
  const status = () => ({ enabled: Boolean(handle), filename: handle?.name || lastFilename, lastWrittenAt, saving: active, error, supported: typeof globalThis.showSaveFilePicker === 'function' });
  const announce = () => onChange(status());
  async function flush() {
    clearTimeout(timer);
    if (!handle || active || paused || written >= revision) return;
    active = true; error = ''; announce();
    const current = revision, selected = handle;
    let stream;
    try {
      if (await selected.queryPermission?.({ mode: 'readwrite' }) === 'denied' || await selected.queryPermission?.({ mode: 'readwrite' }) === 'prompt') throw new Error('Разреши запись в выбранный файл: нажми «Выбрать файл автокопии» ещё раз.');
      const timestamp = Date.now(), copy = structuredClone(getData()); copy.lastBackupAt = timestamp;
      const blob = await makeBackup(copy);
      if (selected !== handle) return;
      stream = await selected.createWritable(); await stream.write(blob); await stream.close(); stream = null;
      written = current; lastWrittenAt = timestamp; onWritten(timestamp);
    } catch (cause) { try { await stream?.abort?.(); } catch { /* Previous backup remains on disk. */ } error = cause?.message || 'Не удалось обновить файл автокопии. Сделай обычную резервную копию.'; }
    finally { active = false; announce(); if (!error && written < revision && handle) timer = setTimeout(flush,1500); }
  }
  return {
    status,
    async initialize() { try { const choice = await loadHandle(); lastFilename = typeof choice?.filename === 'string' ? choice.filename : ''; } catch { error = 'Не удалось открыть настройку автокопии. Обычные резервные копии доступны.'; } announce(); if (handle && revision > written) timer = setTimeout(flush,1500); },
    request() { revision++; if (handle && !paused) { clearTimeout(timer); timer = setTimeout(flush,1500); } },
    async configure() {
      try {
        // The picker runs before any await, preserving the button's user gesture.
        const selected = await picker({ suggestedName: 'zhekandus-autobackup.json', types: [{ description: 'Копия zhekandus', accept: { 'application/json': ['.json'] } }] });
        handle = selected; lastFilename = selected.name || ''; error = ''; await saveHandle({ filename: lastFilename }); revision++; await flush(); announce();
      } catch (cause) { if (cause?.name !== 'AbortError') { error = cause?.message || 'Не удалось выбрать файл автокопии.'; announce(); } }
    },
    async disable() { handle = null; lastFilename = ''; clearTimeout(timer); await saveHandle(null); error = ''; announce(); },
    pause(value) { paused = value; if (!value && written < revision) { clearTimeout(timer); timer = setTimeout(flush,1500); } },
    flush,
  };
}
