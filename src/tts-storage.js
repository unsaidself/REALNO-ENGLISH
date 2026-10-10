let opening;
const sessionKeys = new Map();

function openTTSDatabase() {
  if (opening) return opening;
  opening = new Promise((resolve,reject) => {
    const request = indexedDB.open('zhekandus-tts',1);
    request.onupgradeneeded = () => { request.result.createObjectStore('assets'); request.result.createObjectStore('credentials'); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закрой другую вкладку zhekandus и повтори загрузку голоса.'));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

export async function ttsRecord(store, key, value, remove = false) {
  const database = await openTTSDatabase(), writing = value !== undefined || remove;
  return new Promise((resolve,reject) => {
    const transaction = database.transaction(store, writing ? 'readwrite' : 'readonly'), table = transaction.objectStore(store);
    const request = remove ? table.delete(key) : writing ? table.put(value,key) : table.get(key);
    let result; request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error?.name === 'QuotaExceededError' ? new Error('Не хватает места для нейросетевого голоса. Освободи место или используй голос браузера.') : new Error('Не удалось открыть хранилище голосов. Проверь разрешения браузера.'));
  });
}

export async function setTTSKey(provider, key, remember = false) {
  const content = String(key || '').trim();
  if (content) sessionKeys.set(provider, content); else sessionKeys.delete(provider);
  await ttsRecord('credentials',provider, remember && content ? { key: content } : undefined, !(remember && content));
}

export async function getTTSKey(provider) {
  return sessionKeys.get(provider) || (await ttsRecord('credentials',provider))?.key || '';
}

export async function ttsKeyState(provider) {
  return { available: Boolean(sessionKeys.get(provider) || (await ttsRecord('credentials',provider))?.key), remembered: Boolean((await ttsRecord('credentials',provider))?.key) };
}

export async function clearTTSKeys() {
  sessionKeys.clear();
  for (const provider of ['openai','google','azure']) await ttsRecord('credentials',provider,undefined,true);
}
