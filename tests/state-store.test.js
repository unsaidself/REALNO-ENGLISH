import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createStateStore, DATABASE_NAME, LEGACY_STATE_KEY, formatStorageError } from '../src/state-store.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function openDatabase(factory, version = 2) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'id' });
      if (version >= 2 && !db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function records(factory, storeName = 'state') {
  const db = await openDatabase(factory);
  const result = await new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    let value;
    request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  return result;
}

function instrumentFactory(factory, beforePut) {
  return {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const db = request.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...transactionArgs) => {
          const tx = transaction(...transactionArgs);
          if (transactionArgs[1] !== 'readwrite') return tx;
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = objectStore(name);
            if (name !== 'state') return store;
            const put = store.put.bind(store);
            store.put = (...putArgs) => beforePut({ tx, put, args: putArgs });
            return store;
          };
          return tx;
        };
      });
      return request;
    },
  };
}

const fixture = () => ({
  sets: [{ id: 'set-7', title: 'Мой набор', category: 'Своя', cards: [['term', 'определение', { id: 'card-1', imageId: 'image-1', audioId: 'audio-1', example: 'An example.' }]] }],
  learned: 9, answers: 17, days: ['2026-10-08'],
  reviews: { 'card-1': { level: 4, due: 1234567, lastReviewed: 987654 } },
  daily: { '2026-10-08': { answers: 17, correct: 9 } },
  ranks: { xp: 900, awards: { 'card-1': 2 } },
  settings: { goal: 40, sounds: false, theme: 'dark', voice: 'offline' },
  futureOptionalState: { nested: { value: true }, version: 5 },
});

test('migration commits all legacy state before removing it and preserves the v1 attachment store', async () => {
  const factory = new IDBFactory();
  const oldDb = await openDatabase(factory, 1);
  const image = new Blob(['image contents'], { type: 'image/png' });
  await new Promise((resolve, reject) => {
    const tx = oldDb.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').put({ id: 'image-1', blob: image });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  oldDb.close();
  const original = fixture();
  const storage = memoryStorage({ [LEGACY_STATE_KEY]: JSON.stringify(original) });
  let removed = false, calls = 0;
  const remove = storage.removeItem;
  storage.removeItem = key => { removed = true; remove(key); };
  const store = createStateStore({ indexedDB: factory, storage, navigator: { storage: { persist: async () => { calls++; return true; } } } });
  assert.deepEqual(await store.load({ sets: [] }), original);
  assert.equal(removed, true);
  assert.equal(storage.getItem(LEGACY_STATE_KEY), null);
  assert.deepEqual(await records(factory), [original]);
  const attachments = await records(factory, 'attachments');
  assert.equal(attachments.length, 1);
  assert.equal(await attachments[0].blob.text(), 'image contents');
  assert.equal(calls, 1);
  assert.equal(store.status.dirty, false);
  store.close();
});

test('failed migration keeps the entire legacy copy and reports a clear quota error', async () => {
  const factory = new IDBFactory();
  const original = fixture(), raw = JSON.stringify(original);
  const storage = memoryStorage({ [LEGACY_STATE_KEY]: raw });
  let failWrites = true;
  const instrumented = instrumentFactory(factory, ({ put, args }) => {
    if (failWrites) throw new DOMException('Disk quota exceeded', 'QuotaExceededError');
    return put(...args);
  });
  const errors = [];
  const store = createStateStore({ indexedDB: instrumented, storage, onError: error => errors.push(error) });
  assert.deepEqual(await store.load({ sets: [] }), original);
  assert.equal(storage.getItem(LEGACY_STATE_KEY), raw);
  assert.deepEqual(await records(factory), []);
  assert.match(errors.at(-1).message, /Не хватает места/);
  assert.equal(store.status.dirty, true);
  failWrites = false;
  await store.flush();
  assert.deepEqual(await records(factory), [original]);
  assert.equal(storage.getItem(LEGACY_STATE_KEY), null);
  assert.equal(store.status.error, null);
  store.close();
});

test('an abort after put succeeds still leaves the legacy migration copy intact', async () => {
  const factory = new IDBFactory();
  const original = fixture(), raw = JSON.stringify(original);
  const storage = memoryStorage({ [LEGACY_STATE_KEY]: raw });
  const instrumented = instrumentFactory(factory, ({ tx, put, args }) => {
    const request = put(...args);
    request.addEventListener('success', () => tx.abort());
    return request;
  });
  const store = createStateStore({ indexedDB: instrumented, storage });
  assert.deepEqual(await store.load({ sets: [] }), original);
  assert.equal(storage.getItem(LEGACY_STATE_KEY), raw);
  assert.deepEqual(await records(factory), []);
  assert.equal(store.status.dirty, true);
  store.close();
});

test('100,000-card state larger than the localStorage quota round-trips in IndexedDB', async () => {
  const factory = new IDBFactory();
  const original = fixture();
  original.sets[0].cards = Array.from({ length: 100_000 }, (_, index) => [
    `Term ${index}`, `Определение ${index}: это достаточно длинное описание для проверки больших наборов.`, { id: `card-${index}` },
  ]);
  assert.ok(JSON.stringify(original).length > 5 * 1024 * 1024);
  const storage = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); }, removeItem: () => {} };
  const store = createStateStore({ indexedDB: factory, storage });
  await store.load({ sets: [] });
  await store.commit(original);
  store.close();
  const reopened = createStateStore({ indexedDB: factory, storage });
  const loaded = await reopened.load({ sets: [] });
  assert.equal(loaded.sets[0].cards.length, 100_000);
  assert.deepEqual(loaded.sets[0].cards[99_999], original.sets[0].cards[99_999]);
  assert.deepEqual(loaded.reviews, original.reviews);
  reopened.close();
});

test('debounced saves clone only at the eventual write and request persistence once', async () => {
  const factory = new IDBFactory();
  let puts = 0, persistenceRequests = 0;
  const instrumented = instrumentFactory(factory, ({ put, args }) => { puts++; return put(...args); });
  const store = createStateStore({
    indexedDB: instrumented, storage: memoryStorage(), debounceMs: 30,
    navigator: { storage: { persist: async () => { persistenceRequests++; return false; } } },
  });
  await store.load({ sets: [] });
  const original = fixture();
  for (let index = 0; index < 20; index++) { original.answers = index; assert.equal(store.save(original), true); }
  original.sets[0].title = 'Последнее изменение';
  assert.equal(puts, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  await store.flush();
  assert.equal(puts, 1);
  assert.deepEqual(await records(factory), [original]);
  assert.equal(persistenceRequests, 1);
  assert.equal(store.status.persistent, false);
  await store.commit({ ...original, answers: 100 });
  assert.equal(persistenceRequests, 1);
  store.close();
});

test('concurrent commits and a save during an in-flight write persist the latest state', async () => {
  const factory = new IDBFactory();
  const store = createStateStore({ indexedDB: factory, storage: memoryStorage(), debounceMs: 1000 });
  await store.load({ sets: [] });
  const first = store.commit({ ...fixture(), answers: 1 });
  const second = store.commit({ ...fixture(), answers: 2 });
  store.save({ ...fixture(), answers: 3 });
  await Promise.all([first, second]);
  assert.equal((await records(factory))[0].answers, 3);
  assert.equal(store.status.dirty, false);
  store.close();
});

test('flush starts an opened-database transaction immediately without waiting for debounce', async () => {
  const factory = new IDBFactory();
  let puts = 0;
  const instrumented = instrumentFactory(factory, ({ put, args }) => { puts++; return put(...args); });
  const store = createStateStore({ indexedDB: instrumented, storage: memoryStorage(), debounceMs: 1000 });
  await store.load({ sets: [] });
  store.save(fixture());
  const completion = store.flush();
  assert.equal(puts, 1);
  await completion;
  store.close();
});

test('existing IndexedDB state takes precedence without resetting optional future fields', async () => {
  const factory = new IDBFactory();
  const store = createStateStore({ indexedDB: factory, storage: memoryStorage() });
  await store.load({ sets: [] });
  await store.commit(fixture()); store.close();
  const reopened = createStateStore({ indexedDB: factory, storage: memoryStorage({ [LEGACY_STATE_KEY]: JSON.stringify({ sets: [], answers: 0 }) }) });
  assert.deepEqual(await reopened.load({ sets: [] }), fixture());
  reopened.close();
});

test('a failed read never returns an empty fallback over an existing database', async () => {
  const factory = new IDBFactory();
  const original = fixture();
  const writer = createStateStore({ indexedDB: factory, storage: memoryStorage() });
  await writer.load({ sets: [] }); await writer.commit(original); writer.close();
  let failReads = true, puts = 0;
  const faultyFactory = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const db = request.result, transaction = db.transaction.bind(db);
        db.transaction = (...txArgs) => {
          const tx = transaction(...txArgs), objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = objectStore(name);
            if (name !== 'state') return store;
            const get = store.get.bind(store), put = store.put.bind(store);
            store.get = (...getArgs) => { if (failReads) throw new DOMException('Transient read failed', 'UnknownError'); return get(...getArgs); };
            store.put = (...putArgs) => { puts++; return put(...putArgs); };
            return store;
          };
          return tx;
        };
      });
      return request;
    },
  };
  const store = createStateStore({ indexedDB: faultyFactory, storage: memoryStorage() });
  await assert.rejects(store.load({ sets: [] }), /Не удалось сохранить/);
  assert.equal(puts, 0);
  assert.deepEqual(await records(factory), [original]);
  failReads = false;
  assert.deepEqual(await store.load({ sets: [] }), original);
  assert.equal(store.status.error, null);
  store.close();
});

test('storage errors distinguish quota exhaustion from a privacy restriction', () => {
  assert.match(formatStorageError(new DOMException('Denied', 'SecurityError')), /Доступ к хранилищу заблокирован/);
  assert.match(formatStorageError(new DOMException('quota', 'QuotaExceededError')), /Не хватает места/);
  assert.match(formatStorageError({ code: 1014 }), /Не хватает места/);
  assert.match(formatStorageError(new DOMException('missing', 'NotSupportedError')), /IndexedDB/);
});

test('an existing malformed IndexedDB state stops startup and preserves both database and legacy data', async () => {
  for (const original of [{ cards: ['retained content'], marker: true }, null, [], 'unknown format']) {
    const factory = new IDBFactory(), db = await openDatabase(factory);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(original, 'main');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    db.close();
    const legacyRaw = JSON.stringify(fixture());
    const storage = memoryStorage({ [LEGACY_STATE_KEY]: legacyRaw });
    let puts = 0;
    const instrumented = instrumentFactory(factory, ({ put, args }) => { puts++; return put(...args); });
    const store = createStateStore({ indexedDB: instrumented, storage });
    await assert.rejects(store.load({ sets: [] }), /Сохранённые данные повреждены.*не изменены.*резервную копию/);
    assert.equal(puts, 0);
    assert.equal(store.status.dirty, false);
    assert.equal(storage.getItem(LEGACY_STATE_KEY), legacyRaw);
    assert.deepEqual(await records(factory), [original]);
    store.close();
  }
});

test('invalid legacy content is retained and cannot silently become a new empty database', async () => {
  for (const raw of ['not JSON', '{"unknownState":true}', 'null', '[]', '']) {
    const factory = new IDBFactory(), storage = memoryStorage({ [LEGACY_STATE_KEY]: raw });
    const store = createStateStore({ indexedDB: factory, storage });
    await assert.rejects(store.load({ sets: [] }), /Сохранённые данные повреждены/);
    assert.equal(storage.getItem(LEGACY_STATE_KEY), raw);
    assert.deepEqual(await records(factory), []);
    store.close();
  }
});

test('a blocked localStorage property getter is deferred and does not block valid IndexedDB state', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const factory = new IDBFactory();
  const seeded = createStateStore({ indexedDB: factory, storage: memoryStorage() });
  await seeded.load({ sets: [] }); await seeded.commit(fixture()); seeded.close();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Access blocked', 'SecurityError'); } });
  let store;
  try {
    assert.doesNotThrow(() => { store = createStateStore({ indexedDB: factory, navigator: {} }); });
    assert.deepEqual(await store.load({ sets: [] }), fixture());
    await store.commit({ ...fixture(), answers: 18 });
    assert.equal((await records(factory))[0].answers, 18);
  } finally {
    store?.close();
    descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage;
  }
});

test('a blocked legacy getter on an empty database reports a privacy error without writing fallback', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const factory = new IDBFactory();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Access blocked', 'SecurityError'); } });
  let store;
  try {
    assert.doesNotThrow(() => { store = createStateStore({ indexedDB: factory, navigator: {} }); });
    await assert.rejects(store.load({ sets: [] }), /Доступ к хранилищу заблокирован/);
    assert.equal(store.status.dirty, false);
    assert.deepEqual(await records(factory), []);
  } finally {
    store?.close();
    descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage;
  }
});

test('a blocked IndexedDB property getter is reported by load rather than crashing construction', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Database access blocked', 'SecurityError'); } });
  let store;
  try {
    assert.doesNotThrow(() => { store = createStateStore({ storage: memoryStorage(), navigator: {} }); });
    await assert.rejects(store.load({ sets: [] }), /Доступ к хранилищу заблокирован/);
    assert.equal(store.status.error.name, 'SecurityError');
    assert.equal(store.status.dirty, false);
  } finally {
    store?.close();
    descriptor ? Object.defineProperty(globalThis, 'indexedDB', descriptor) : delete globalThis.indexedDB;
  }
});
