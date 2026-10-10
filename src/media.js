/**
 * Local media storage and pronunciation. Native online voices are supported;
 * optional cloud TTS and downloaded Piper models cache audio in IndexedDB.
 * Bundled eSpeak is the final fallback and requires no network or installed voice.
 * Attachments live in IndexedDB, never in the application's localStorage JSON.
 * file:// and private browsing storage support depends on the browser. Errors
 * are actionable so a failed media save does not prevent text-card editing.
 */

import { synthesizeSpeech } from './offline-speech.js';
import { selectSpeechVoice, rankSpeechVoices, describeSpeechVoice, voiceQuality } from './speech-voices.js';
import { cloudSpeechIdentity, synthesizeCloudSpeech, speechCacheKey } from './cloud-speech.js';
import { getTTSKey } from './tts-storage.js';
import { neuralModel, neuralModelInstalled } from './neural-assets.js';
import { synthesizeNeuralSpeech } from './neural-speech.js';
export { synthesizeSpeech } from './offline-speech.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_EDGE = 1200;
const DATABASE_NAME = 'zhekandus-media';
const STORE_NAME = 'attachments';
let audioContext;
let databasePromise;
let currentSpeech;
let mediaEpoch = 0;
let audioEpoch = 0;
const soundingNodes = new Set();
const mediaUrls = new Map();
const mediaNodeTokens = new WeakMap();
const mediaPlayNodes = new WeakSet();

export async function unlockAudio() {
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext.state === 'running';
  } catch {
    return false;
  }
}

// [frequency, relative start, length, waveform, gain]. Short attacks avoid pops;
// the small volume keeps feedback comfortable alongside spoken definitions.
const soundPatterns = {
  click: [[620, 0, 0.065, 'sine', 0.035]],
  flip: [[280, 0, 0.07, 'triangle', 0.035], [420, 0.045, 0.09, 'sine', 0.035]],
  correct: [[523.25, 0, 0.12, 'sine', 0.075], [783.99, 0.08, 0.2, 'sine', 0.075]],
  wrong: [[220, 0, 0.14, 'triangle', 0.065], [164.81, 0.12, 0.18, 'triangle', 0.055]],
  match: [[659.25, 0, 0.1, 'sine', 0.07], [880, 0.065, 0.16, 'sine', 0.065]],
  streak: [[523.25, 0, 0.14, 'triangle', 0.055], [659.25, 0.095, 0.14, 'triangle', 0.055], [783.99, 0.19, 0.14, 'triangle', 0.055], [1046.5, 0.285, 0.32, 'sine', 0.075]],
  complete: [[523.25, 0, 0.15, 'sine', 0.065], [659.25, 0.13, 0.15, 'sine', 0.065], [783.99, 0.26, 0.16, 'sine', 0.065], [1046.5, 0.4, 0.4, 'sine', 0.065], [659.25, 0.4, 0.4, 'sine', 0.025]],
};

export async function playSound(kind, enabled = true) {
  if (!enabled || !soundPatterns[kind]) return false;
  const epoch = audioEpoch;
  if (!await unlockAudio() || epoch !== audioEpoch) return false;
  try {
    const start = audioContext.currentTime + 0.01;
    for (const [frequency, delay, duration, waveform, volume] of soundPatterns[kind]) {
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      const at = start + delay;
      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(frequency, at);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(envelope);
      envelope.connect(audioContext.destination);
      soundingNodes.add(oscillator);
      oscillator.onended = () => {
        soundingNodes.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + duration + 0.015);
    }
    return true;
  } catch {
    return false;
  }
}

function stopSpeech() {
  const session = currentSpeech;
  if (session) {
    // Retire ownership before cancel() can emit a synchronous native error.
    session.finish({ status: 'cancelled', cancelled: true });
    session.abort.abort();
    try { session.source?.stop(); } catch { /* A completed source is harmless. */ }
  }
  try { globalThis.speechSynthesis?.cancel(); } catch { /* Optional browser API. */ }
}

function pauseAttachmentAudio(except) {
  const elements = new Set([
    ...[...mediaUrls.keys()].filter(node => node.tagName === 'AUDIO'),
    ...(globalThis.document?.querySelectorAll('audio[data-audio-id]') || []),
  ]);
  for (const element of elements) {
    if (element === except) continue;
    try { element.pause(); } catch { /* Detached/unsupported audio element. */ }
  }
}

function installedVoices() {
  try { return globalThis.speechSynthesis?.getVoices?.() || []; }
  catch { return []; }
}

export function getSpeechVoices(language = 'en-US') {
  return rankSpeechVoices(installedVoices(),language).map(describeSpeechVoice);
}

function waitForVoices(synthesis, signal) {
  const ready = installedVoices();
  if (ready.length || !synthesis?.addEventListener || signal.aborted) return Promise.resolve(ready);
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', finish);
      signal.removeEventListener('abort', finish);
      resolve(installedVoices());
    };
    const timer = setTimeout(finish, 1500);
    synthesis.addEventListener('voiceschanged', finish);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Queue speech while the click still has permission to unlock Web Audio. Native
 * failures and missing voices switch to real local WAV synthesis automatically.
 * A retired session can neither start audio nor finish its replacement's UI.
 */
export async function cachedSpeechAudio(text, { identity, lang, rate, cacheEntries, signal, onCache, synthesize }) {
  const key = await speechCacheKey(text,{identity,lang,rate});
  if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
  const entry = cacheEntries?.[key], id = entry?.audioId || `tts-${key}`;
  const record = await loadAttachment(id).catch(()=>undefined);
  if (record?.blob?.size) {
    const info = record.ttsInfo || entry || identity;
    onCache?.(key,{...identity,...entry,audioId:id});
    return {blob:record.blob,info:{...identity,...info,type:'local',sourceType:identity.type,cached:true}};
  }
  const result = await synthesize();
  if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
  let cacheWarning = '';
  try {
    await transact('readwrite',store=>store.put({id:`tts-${key}`,type:'audio',name:`Озвучка: ${identity.name}`,blob:result.blob,size:result.blob.size,createdAt:Date.now(),ttsInfo:identity}));
    onCache?.(key,{...identity,audioId:`tts-${key}`});
  } catch { cacheWarning = 'Звук воспроизведён, но аудиокопия не сохранилась. Проверь свободное место в браузере.'; }
  return {...result,info:{...result.info,cacheWarning}};
}

export async function speakText(text, { lang, rate = 0.9, voice = 'auto', systemVoice = 'auto', cloud = {}, neuralId, cacheEntries, onCache, onStart, onEnd, onError, onNotice } = {}) {
  const content = String(text ?? '').trim();
  if (!content) return { ok: false, message: 'Нет текста для озвучки.' };
  if (content.length > 5000) return { ok: false, message: 'Для озвучки выбери текст короче 5000 символов.' };
  pauseAttachmentAudio(); stopSpeech();
  const unlocking = unlockAudio();
  const language = lang || (/[а-яё]/i.test(content) ? 'ru-RU' : 'en-US');
  const numericRate = Number(rate), speed = Number.isFinite(numericRate) ? Math.max(.5,Math.min(1.5,numericRate)) : .9;
  const session = {abort:new AbortController(),timer:null,utterance:null,source:null,finished:false,nativeEpoch:0,neuralTried:false,finalTried:false,voices:[],attempted:new Set()};
  const active = () => !session.finished && currentSpeech === session && !session.abort.signal.aborted;
  session.finish = (event = {status:'ended'}) => {
    if (!active()) return false;
    session.finished = true; clearTimeout(session.timer); currentSpeech = null;
    onEnd?.(event); return true;
  };
  currentSpeech = session;
  const fail = error => { if (!active()) return; const message=error?.message || 'Не получилось включить звук. Проверь звук вкладки.'; onError?.(message);session.finish({status:'error',error:message}); };
  const retireNative = () => {
    session.nativeEpoch++; clearTimeout(session.timer);
    if (session.utterance) session.utterance.onend = session.utterance.onerror = session.utterance.onstart = null;
    try { globalThis.speechSynthesis?.cancel(); } catch { /* Optional native API. */ }
  };
  const playBlob = async (blob,info) => {
    if (!active()) return;
    if (!await unlocking || !await unlockAudio()) throw new Error('Браузер не включил звук. Нажми «Прослушать» ещё раз и проверь звук вкладки.');
    if (!active()) return;
    const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    if (!active()) return;
    const source = session.source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination);
    source.onended = () => { source.disconnect();session.finish({status:'ended',...info}); };
    source.start();onStart?.(info);if(info.cacheWarning)onNotice?.(info.cacheWarning);
  };
  const generated = async engine => {
    const model=neuralModel(neuralId), identity = engine === 'cloud' ? cloudSpeechIdentity(cloud,language) : {engine:'neural',type:'local',name:model.name,lang:model.lang,model:model.id};
    if (engine === 'neural' && model.lang.split('-')[0] !== language.split('-')[0]) throw new Error('Эта модель Piper предназначена для английского. Для другого языка использую голос браузера.');
    const result = await cachedSpeechAudio(content,{identity,lang:language,rate:speed,cacheEntries,signal:session.abort.signal,onCache,
      synthesize:async()=>{
        if(engine === 'cloud') {
          if(globalThis.navigator?.onLine === false) throw new Error('Нет интернета для нового облачного аудио. Сохранённые записи доступны офлайн.');
          return synthesizeCloudSpeech(content,{config:cloud,lang:language,rate:speed,key:await getTTSKey(identity.provider),signal:session.abort.signal});
        }
        return synthesizeNeuralSpeech(content,{modelId:model.id,rate:speed,signal:session.abort.signal});
      },
    });
    await playBlob(result.blob,result.info);
  };
  const finalFallback = async () => {
    if (!active() || session.finalTried) return;
    session.finalTried=true;retireNative();
    try {
      const blob=await synthesizeSpeech(content,{lang:language,rate:speed,signal:session.abort.signal});
      await playBlob(blob,{engine:'offline',type:'fallback',name:'eSpeak',lang:language});
    } catch(error) { if(error?.name !== 'AbortError')fail(error); }
  };
  const attemptNative = selected => {
    if(!active() || !selected)return;
    retireNative();const epoch=session.nativeEpoch;
    session.attempted.add(selected.voiceURI || `${selected.name}|${selected.lang}`);
    const current = () => active() && session.nativeEpoch===epoch;
    const identity={engine:'system',...describeSpeechVoice(selected)};
    const next=()=>{if(!current())return;retireNative();void fallbackChain();};
    try {
      const utterance=session.utterance=new globalThis.SpeechSynthesisUtterance(content);
      utterance.voice=selected;utterance.lang=String(selected.lang || language).replace(/_/g,'-');utterance.rate=speed;utterance.pitch=1;utterance.volume=1;
      utterance.onstart=()=>{if(!current())return;clearTimeout(session.timer);session.timer=setTimeout(next,Math.min(90000,6000+content.length*150/speed));onStart?.(identity);};
      utterance.onend=()=>{if(current())session.finish({status:'ended',...identity});};
      utterance.onerror=next;
      setTimeout(()=>{
        if(!current())return;
        session.timer=setTimeout(()=>{onNotice?.(`Голос «${selected.name}» не начал говорить. Пробую следующий доступный голос.`);next();},selected.localService === false ? 6000 : 2000);
        globalThis.speechSynthesis.speak(utterance);
        if(globalThis.speechSynthesis.paused)globalThis.speechSynthesis.resume();
      },30);
    }catch{next();}
  };
  const fallbackChain = async () => {
    if(!active())return;
    const model=neuralModel(neuralId);
    if(!session.neuralTried && model.lang.split('-')[0]===language.split('-')[0]) {
      session.neuralTried=true;
      try { if(await neuralModelInstalled(model.id)){await generated('neural');return;} }
      catch(error){if(error?.name==='AbortError')return;onNotice?.(error.message);}
    }
    if(!active())return;
    const local=selectSpeechVoice(session.voices.filter(item=>!session.attempted.has(item.voiceURI || `${item.name}|${item.lang}`)),language,'auto',{localOnly:true});
    if(local && session.attempted.size < 3 && globalThis.SpeechSynthesisUtterance){attemptNative(local);return;}
    await finalFallback();
  };
  const start = async () => {
    const synthesis=globalThis.speechSynthesis;
    session.voices=await waitForVoices(synthesis,session.abort.signal);
    if(!active())return;
    // Legacy explicit eSpeak selection remains available to callers/tests;
    // the settings UI offers automatic, live cloud and local neural modes.
    if(voice === 'offline' || String(voice).startsWith('offline-')){await finalFallback();return;}
    if(voice === 'cloud') {
      try {await generated('cloud');return;}
      catch(error){if(error?.name==='AbortError')return;onNotice?.(error.message);}
    }
    if(voice === 'neural') {
      session.neuralTried=true;
      try {await generated('neural');return;}
      catch(error){if(error?.name==='AbortError')return;onNotice?.(error.message);}
    }
    if(!active())return;
    const requested=['auto','cloud','neural'].includes(voice) ? systemVoice : voice;
    const voices=globalThis.navigator?.onLine === false ? session.voices.filter(item=>item.localService !== false) : session.voices;
    const selected=selectSpeechVoice(voices,language,requested);
    if (selected && requested === 'auto' && voiceQuality(selected) < 0 && !session.neuralTried) {
      const model=neuralModel(neuralId);session.neuralTried=true;
      try { if (model.lang.split('-')[0]===language.split('-')[0] && await neuralModelInstalled(model.id)) { await generated('neural');return; } }
      catch(error) { if(error?.name==='AbortError')return;onNotice?.(error.message); }
    }
    if(selected && synthesis && globalThis.SpeechSynthesisUtterance){attemptNative(selected);return;}
    await fallbackChain();
  };
  void start().catch(fail);
  return {ok:true};
}

export function stopAudio() {
  // resume() may still be pending after a modal closes or sounds are muted.
  // Invalidate those requests before they can schedule new tones.
  audioEpoch += 1;
  stopSpeech();
  for (const oscillator of soundingNodes) {
    try { oscillator.stop(); } catch { /* An already-ended tone is harmless. */ }
  }
  soundingNodes.clear();
  pauseAttachmentAudio();
}

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

export async function storeAttachment(file, kind) {
  if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') throw new Error('Выбери файл для вложения.');
  if (kind !== 'image' && kind !== 'audio') throw new Error('Неизвестный вид вложения.');
  if (!file.size) throw new Error('Файл пустой. Выбери другой файл.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Максимальный размер вложения — 8 МБ.');
  const name = String(file.name || (kind === 'image' ? 'Картинка' : 'Аудио')).slice(0, 200);
  const mime = String(file.type || '').toLowerCase();
  let prepared;
  if (kind === 'image') {
    if (mime.includes('svg') || /\.svgz?$/i.test(name)) throw new Error('SVG не поддерживается. Выбери JPG, PNG или WebP.');
    if (!/^image\/(jpeg|png|webp|gif|bmp|avif|x-ms-bmp)$/.test(mime) && !(mime === '' && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name))) {
      throw new Error('Выбери картинку в формате JPG, PNG, WebP, GIF или AVIF.');
    }
    const head = await file.slice(0, 2048).text();
    if (/<svg(?:\s|>)/i.test(head)) throw new Error('SVG не поддерживается. Выбери JPG, PNG или WebP.');
    prepared = await prepareImage(file);
  } else {
    const extensionMime = {
      mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
      ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
    };
    const extension = name.split('.').pop().toLowerCase();
    const audioMime = mime || extensionMime[extension];
    if (!/^audio\//.test(audioMime || '')) throw new Error('Выбери аудиофайл: MP3, M4A, WAV, OGG или WebM.');
    if (globalThis.document) {
      const tester = document.createElement('audio');
      if (typeof tester.canPlayType === 'function' && !tester.canPlayType(audioMime)) throw new Error('Браузер не воспроизводит этот формат. Попробуй MP3, M4A или WAV.');
    }
    prepared = { blob: mime ? file : new Blob([file], { type: audioMime }) };
  }
  const id = globalThis.crypto?.randomUUID?.() || `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const record = { id, type: kind, name, size: prepared.blob.size, createdAt: Date.now(), ...prepared };
  await transact('readwrite', store => store.put(record));
  return { id, type: kind, name, size: record.size };
}

export async function loadAttachment(id) {
  if (!id || typeof id !== 'string') return undefined;
  return transact('readonly', store => store.get(id));
}

export async function removeAttachment(id) {
  if (!id || typeof id !== 'string') return;
  await transact('readwrite', store => store.delete(id));
}

export function attachmentMarkup(card, esc, { image = true, audio = true } = {}) {
  const media = card?.[2] || {};
  const parts = [];
  if (image && media.imageId) parts.push(`<img class="card-image" data-image-id="${esc(media.imageId)}" alt="${esc(media.imageName || 'Картинка к карточке')}" loading="lazy" decoding="async">`);
  if (audio && media.audioId) parts.push(`<audio class="card-audio" data-audio-id="${esc(media.audioId)}" controls preload="none" aria-label="${esc(media.audioName || 'Аудио к карточке')}"></audio>`);
  return parts.length ? `<div class="card-media">${parts.join('')}</div>` : '';
}

function revokeNodeUrl(node) {
  const url = mediaUrls.get(node);
  if (!url) return;
  if (node.tagName === 'AUDIO') {
    try { node.pause(); } catch { /* A detached node may already be stopped. */ }
  }
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
  const nodes = [...container.querySelectorAll('[data-image-id], [data-audio-id]')];
  if (container.matches?.('[data-image-id], [data-audio-id]')) nodes.unshift(container);
  await Promise.all(nodes.map(async node => {
    const id = node.dataset.imageId || node.dataset.audioId;
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
      if (node.tagName === 'AUDIO' && !mediaPlayNodes.has(node)) {
        mediaPlayNodes.add(node);
        node.addEventListener('play', () => {
          stopSpeech();
          pauseAttachmentAudio(node);
        });
      }
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
  stopAudio();
  for (const node of [...mediaUrls.keys()]) revokeNodeUrl(node);
}
