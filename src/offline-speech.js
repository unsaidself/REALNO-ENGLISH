import SpeechWorker from './speech-worker.js?worker&inline';

let worker;
let nextId = 0;
let cachedBytes = 0;
const pending = new Map();
const cache = new Map();
const MAX_CACHE = 8 * 1024 * 1024;

function abortError() { return new DOMException('Speech cancelled.', 'AbortError'); }

function resetWorker(error) {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.abort);
    request.reject(error);
  }
  pending.clear();
}

function speechWorker() {
  if (worker) return worker;
  if (!globalThis.Worker) throw new Error('Для встроенного голоса нужен современный браузер с поддержкой Web Worker.');
  worker = new SpeechWorker();
  worker.onmessage = event => {
    const { id, wav, error } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.abort);
    if (error) request.reject(new Error('Не удалось подготовить встроенный голос. Перезагрузи приложение и попробуй ещё раз.'));
    else request.resolve(new Blob([wav], { type: 'audio/wav' }));
  };
  worker.onerror = () => resetWorker(new Error('Не удалось запустить встроенный голос. Открой приложение в Chrome, Edge, Firefox или Safari.'));
  return worker;
}

/** Real local WAV synthesis, also used as the reference for pronunciation. */
export async function synthesizeSpeech(text, { lang, rate = 0.9, signal } = {}) {
  const content = String(text ?? '').trim();
  if (!content) throw new Error('Нет текста для озвучки.');
  if (content.length > 5000) throw new Error('Для озвучки выбери текст короче 5000 символов.');
  if (signal?.aborted) throw abortError();
  const language = lang || (/[а-яё]/i.test(content) ? 'ru-RU' : 'en-US');
  const numericRate = Number(rate);
  const speed = Number.isFinite(numericRate) ? Math.max(0.5, Math.min(1.5, numericRate)) : 0.9;
  const key = `${language}|${speed}|${content}`;
  if (cache.has(key)) {
    const blob = cache.get(key);
    cache.delete(key);
    cache.set(key, blob);
    return blob;
  }
  const engine = speechWorker();
  const blob = await new Promise((resolve, reject) => {
    const id = ++nextId;
    const request = { resolve, reject, signal };
    request.abort = () => {
      if (!pending.delete(id)) return;
      clearTimeout(request.timer);
      signal?.removeEventListener('abort', request.abort);
      reject(abortError());
      // Terminating a lone cancelled computation prevents its result from
      // delaying a replacement. Other callers' reference requests stay intact.
      if (!pending.size) { worker?.terminate(); worker = undefined; }
    };
    request.timer = setTimeout(() => resetWorker(new Error('Встроенный голос готовится слишком долго. Выбери более короткий текст и попробуй ещё раз.')), 90000);
    pending.set(id, request);
    signal?.addEventListener('abort', request.abort, { once: true });
    engine.postMessage({ id, text: content, lang: language, rate: speed });
  });
  if (signal?.aborted) throw abortError();
  if (blob.size <= MAX_CACHE) {
    if (cache.has(key)) {
      cachedBytes -= cache.get(key).size;
      cache.delete(key);
    }
    while (cachedBytes + blob.size > MAX_CACHE && cache.size) {
      const oldest = cache.keys().next().value;
      cachedBytes -= cache.get(oldest).size;
      cache.delete(oldest);
    }
    cache.set(key, blob);
    cachedBytes += blob.size;
  }
  return blob;
}
