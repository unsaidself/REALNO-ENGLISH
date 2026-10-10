# Полный код обновления озвучки zhekandus

Этот файл содержит полный текст изменённых модулей и функций без сокращений.
Это исходники ванильного приложения Vite, а не фрагменты для вставки прямо в
сжатую строку HTML. Готовый `zhekandus.html` уже пересобран; ручная правка
Base64 не требуется. Сборка: `npm ci`, `npm run build`, `npm run standalone`.

`...` в исходниках используется только как синтаксис spread/rest JavaScript,
а не как пропуск кода. Данные, вложения и формат копии версии 1 сохранены.
Ключи API из настроек не входят в копии. Модель Piper скачивается отдельно.

## src/speech-voices.js

```js
const voiceId = voice => voice.voiceURI || `${voice.name}|${voice.lang}`;

export function voiceQuality(voice) {
  const name = String(voice.name || '').toLowerCase();
  const weights = { natural: 120, neural: 110, online: 80, premium: 75, enhanced: 70, google: 65, samantha: 60, aria: 55, jenny: 55 };
  let score = Object.entries(weights).reduce((sum, [word, value]) => sum + (name.includes(word) ? value : 0), 0);
  if (/espeak|mbrola/.test(name)) score -= 300;
  if (/compact/.test(name)) score -= 150;
  return score;
}

export function rankSpeechVoices(voices, language = 'en-US') {
  const lang = String(language).replace(/_/g, '-').toLowerCase(), prefix = lang.split('-')[0];
  return [...voices].filter(voice => String(voice.lang).replace(/_/g, '-').toLowerCase().split('-')[0] === prefix)
    .sort((a,b) => {
      const exact = voice => String(voice.lang).replace(/_/g, '-').toLowerCase() === lang ? 1 : 0;
      return exact(b) - exact(a) || voiceQuality(b) - voiceQuality(a) || Number(Boolean(b.default)) - Number(Boolean(a.default)) || String(a.name).localeCompare(String(b.name));
    });
}

export function selectSpeechVoice(voices, language, requested = 'auto', { localOnly = false } = {}) {
  const ranked = rankSpeechVoices(voices, language).filter(voice => !localOnly || voice.localService !== false);
  return ranked.find(voice => voiceId(voice) === requested || voice.voiceURI === requested) || ranked[0] || null;
}

export function describeSpeechVoice(voice) {
  return { id: voiceId(voice), name: String(voice.name), lang: String(voice.lang), localService: voice.localService !== false, type: /espeak/i.test(voice.name) ? 'fallback' : voice.localService === false ? 'online' : 'local', quality: voiceQuality(voice) };
}

export function voiceSetupInstruction(platform = globalThis.navigator?.userAgent || '') {
  if (/iPhone|iPad|iPod/i.test(platform)) return { platform: 'iPhone / iPad', text: 'Настройки → Универсальный доступ → Устный контент → Голоса → Английский. Скачай улучшенный голос.', url: 'https://support.apple.com/guide/iphone/hear-whats-on-the-screen-or-typed-iph96b214f0/ios' };
  if (/Android/i.test(platform)) return { platform: 'Android', text: 'Настройки → Специальные возможности → Синтез речи. Выбери Google и установи английские голосовые данные.', url: 'https://support.google.com/accessibility/android/answer/6006983?hl=ru' };
  if (/Mac/i.test(platform)) return { platform: 'macOS', text: 'Системные настройки → Универсальный доступ → Устный контент → Голос. Скачай Samantha Enhanced или другой улучшенный английский голос.', url: 'https://support.apple.com/guide/mac-help/change-spoken-content-settings-mchlp2290/mac' };
  if (/Windows/i.test(platform)) return { platform: 'Windows', text: 'Установи английскую речь в параметрах языка и проверь голоса Edge. Если браузер не показывает хороший голос, скачай Piper в настройках zhekandus.', url: 'https://support.microsoft.com/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01' };
  return { platform: /Linux/i.test(platform) ? 'Linux' : 'браузер', text: 'В этом браузере может не быть естественных системных голосов. В настройках zhekandus выбери Piper, скачай английскую модель и нажми «Проверить Piper». После загрузки он работает без интернета.', url: 'https://github.com/rhasspy/piper#readme' };
}

export function speechDescription(info) {
  const type = { online: 'онлайн', local: 'локальный', fallback: 'запасной' }[info.type] || info.type;
  return `Голос: ${info.name} · ${type} · ${info.lang}${info.cached ? ' · аудио из кэша' : ''}`;
}

```

## src/tts-storage.js

```js
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

```

## src/cloud-speech.js

```js
export const cloudDefaults = {
  openai: { voice: 'coral', model: 'gpt-4o-mini-tts' },
  google: { voice: 'en-US-Neural2-F' },
  azure: { voice: 'en-US-JennyNeural', region: 'westeurope' },
};

export function cloudSpeechIdentity(config = {}, lang = 'en-US') {
  const provider = ['openai','google','azure'].includes(config.provider) ? config.provider : 'openai';
  const defaults = cloudDefaults[provider], voice = String(config.voice || defaults.voice).trim(), accent = voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0];
  return { engine: 'cloud', type: 'online', provider, voice, name: `${{openai:'OpenAI',google:'Google Cloud',azure:'Azure'}[provider]} · ${voice}`, model: String(config.model || defaults.model || ''), region: String(config.region || defaults.region || '').toLowerCase(), lang: provider === 'openai' ? lang : accent || lang };
}

function xmlEscape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }

export function cloudSpeechRequest(text, { config, lang = 'en-US', rate = .9, key } = {}) {
  const identity = cloudSpeechIdentity(config,lang);
  if (!key) throw new Error('Добавь API-ключ выбранного провайдера в настройках «Живого голоса».');
  const headers = { 'Content-Type': 'application/json' };
  let url, body;
  if (identity.provider === 'openai') {
    url = 'https://api.openai.com/v1/audio/speech'; headers.Authorization = `Bearer ${key}`;
    body = JSON.stringify({ model: identity.model, voice: identity.voice, input: text, response_format: 'mp3', speed: rate, ...(identity.model === 'gpt-4o-mini-tts' ? { instructions: lang === 'en-GB' ? 'Speak clearly in a natural British English accent.' : lang === 'en-US' ? 'Speak clearly in a natural American English accent.' : 'Speak clearly and naturally in the language of the text.' } : {}) });
  } else if (identity.provider === 'google') {
    url = 'https://texttospeech.googleapis.com/v1/text:synthesize'; headers['X-Goog-Api-Key'] = key;
    body = JSON.stringify({ input: { text }, voice: { languageCode: identity.lang, name: identity.voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } });
  } else {
    if (!/^[a-z0-9]{2,35}$/.test(identity.region)) throw new Error('Укажи регион Azure, например westeurope или eastus.');
    url = `https://${identity.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    headers['Content-Type'] = 'application/ssml+xml'; headers['Ocp-Apim-Subscription-Key'] = key; headers['X-Microsoft-OutputFormat'] = 'audio-24khz-48kbitrate-mono-mp3';
    const percent = Math.round((rate - 1) * 100);
    body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlEscape(identity.lang)}"><voice name="${xmlEscape(identity.voice)}"><prosody rate="${percent >= 0 ? '+' : ''}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`;
  }
  return { url, options: { method: 'POST', headers, body }, identity };
}

export async function synthesizeCloudSpeech(text, { config, lang, rate, key, signal, fetcher = globalThis.fetch } = {}) {
  const request = cloudSpeechRequest(text,{config,lang,rate,key}), controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort,30000);
  try {
    const response = await fetcher(request.url,{...request.options,signal:controller.signal});
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'Провайдер отклонил ключ или доступ к голосу. Проверь ключ и разрешение TTS.' : response.status === 429 ? 'Лимит запросов или средств у провайдера. Использую следующий доступный голос.' : `Провайдер озвучки вернул ошибку ${response.status}. Проверь голос и модель в настройках.`;
      throw new Error(message);
    }
    let blob;
    if (request.identity.provider === 'google') {
      try {
        const result = await response.json();
        if (typeof result.audioContent !== 'string' || result.audioContent.length > 12000000) throw new Error();
        const bytes = Uint8Array.from(atob(result.audioContent), c => c.charCodeAt(0)); blob = new Blob([bytes],{type:'audio/mpeg'});
      } catch { throw new Error('Google не вернул корректное аудио.'); }
    } else blob = new Blob([await response.arrayBuffer()],{type:'audio/mpeg'});
    if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Ответ TTS пустой или больше 8 МБ. Выбери более короткую фразу.');
    // Reject successful JSON/HTML error bodies before they poison the audio cache.
    const bytes = new Uint8Array(await blob.slice(0,12).arrayBuffer());
    const prefix = new TextDecoder().decode(bytes);
    const mp3 = prefix.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    const wav = prefix.startsWith('RIFF') && prefix.slice(8,12) === 'WAVE';
    if (!mp3 && !wav) throw new Error('Провайдер вернул данные без аудио. Запись не сохранена; проверь настройки голоса.');
    return { blob, info: request.identity };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
    if (controller.signal.aborted) throw new Error('Облачный голос не ответил за 30 секунд. Использую следующий доступный голос.');
    if (error instanceof TypeError) throw new Error('Облачный голос недоступен: проверь интернет и поддержку запросов из браузера.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
}

export async function speechCacheKey(text, { lang, rate, identity }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ text:String(text).trim(),lang,rate,identity }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

```

## src/neural-assets.js

```js
import { ttsRecord } from './tts-storage.js';

export const neuralModels = [
  { id:'en_US-lessac-medium', name:'Piper Lessac · американский', lang:'en-US', path:'en/en_US/lessac/medium/en_US-lessac-medium.onnx' },
  { id:'en_GB-alba-medium', name:'Piper Alba · британский', lang:'en-GB', path:'en/en_GB/alba/medium/en_GB-alba-medium.onnx' },
];
export const neuralEngineAssets = [
  { key:'phonemizer-wasm', url:'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm', sha256:'b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6' },
  { key:'phonemizer-data', url:'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data', sha256:'29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c' },
  { key:'ort-simd', url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd.wasm', sha256:'f533b5f21790563d7556c611c3835ac65848ee326da2689aac54ed7d9cc8c6a4' },
  { key:'ort-basic', url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm.wasm', sha256:'ebe7ec327f83aabc07e3b58487522481ccff10941f24182ab0428d0123652ff2' },
];

export function neuralModel(id) { return neuralModels.find(model => model.id === id) || neuralModels[0]; }

export async function neuralModelInstalled(id) {
  const model = neuralModel(id);
  if (!await ttsRecord('assets',`ready:${model.id}`)) return false;
  for (const key of ['model','config',...neuralEngineAssets.map(asset=>asset.key)]) if (!await ttsRecord('assets',key === 'model' || key === 'config' ? `${model.id}:${key}` : key)) return false;
  return true;
}

async function downloadAsset(asset, {signal,onProgress,fetcher}) {
  const cached = await ttsRecord('assets',asset.key);
  if (cached) return cached;
  const response = await fetcher(asset.url,{signal});
  if (!response.ok) throw new Error(`Не удалось скачать голос (${response.status}). Проверь интернет и повтори загрузку.`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > 180 * 1024 * 1024) throw new Error('Файл модели слишком большой.');
  const chunks = []; let loaded = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        loaded += result.value.byteLength;
        if (loaded > 180 * 1024 * 1024) throw new Error('Файл модели слишком большой.');
        chunks.push(result.value); onProgress?.({part:asset.key,loaded,total});
      }
    } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  } else chunks.push(await response.arrayBuffer());
  const blob = new Blob(chunks,{type:asset.key.endsWith('config') ? 'application/json' : 'application/octet-stream'});
  if (!blob.size) throw new Error('Сервер вернул пустой файл модели.');
  if (asset.sha256) {
    const digest = await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    const checksum = [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if (checksum !== asset.sha256) throw new Error('Контрольная сумма движка не совпала. Файл не сохранён; повтори загрузку позже.');
  }
  if (asset.key.endsWith(':config')) {
    const config = JSON.parse(await blob.text());
    if (!config.phoneme_id_map || !config.espeak?.voice || !config.audio?.sample_rate) throw new Error('Скачана несовместимая конфигурация Piper.');
  }
  if (signal?.aborted) throw new DOMException('Загрузка отменена.','AbortError');
  await ttsRecord('assets',asset.key,blob);
  onProgress?.({part:asset.key,loaded:blob.size,total:blob.size});
  return blob;
}

export async function downloadNeuralModel(id, {signal,onProgress,fetcher = globalThis.fetch} = {}) {
  const model = neuralModel(id), base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
  const assets = [{key:`${model.id}:config`,url:base+model.path+'.json'}, {key:`${model.id}:model`,url:base+model.path}, ...neuralEngineAssets, {key:`${model.id}:license`,url:base+model.path.split('/').slice(0,-1).join('/')+'/MODEL_CARD'}];
  for (let index=0;index<assets.length;index++) await downloadAsset(assets[index],{signal,fetcher,onProgress:progress=>onProgress?.({...progress,index:index+1,count:assets.length})});
  if (signal?.aborted) throw new DOMException('Загрузка отменена.','AbortError');
  await ttsRecord('assets',`ready:${model.id}`,{installedAt:Date.now(),name:model.name,lang:model.lang});
  await navigator.storage?.persist?.().catch(()=>false);
  return model;
}

export async function loadNeuralAssets(id) {
  const model = neuralModel(id);
  if (!await neuralModelInstalled(id)) throw new Error('Сначала скачай модель Piper в настройках.');
  const config = JSON.parse(await (await ttsRecord('assets',`${model.id}:config`)).text());
  const modelBytes = await (await ttsRecord('assets',`${model.id}:model`)).arrayBuffer();
  const engine = {};
  for (const asset of neuralEngineAssets) engine[asset.key] = await (await ttsRecord('assets',asset.key)).arrayBuffer();
  return {model,config,modelBytes,engine};
}

export async function removeNeuralModel(id) {
  const model = neuralModel(id);
  for (const key of ['model','config','license']) await ttsRecord('assets',`${model.id}:${key}`,undefined,true);
  await ttsRecord('assets',`ready:${model.id}`,undefined,true);
  for (const other of neuralModels) if (await ttsRecord('assets',`ready:${other.id}`)) return;
  for (const asset of neuralEngineAssets) await ttsRecord('assets',asset.key,undefined,true);
}

```

## src/neural-worker.js

```js
import * as ort from 'onnxruntime-web/wasm';
import { createPiperPhonemize } from './voice/piper-phonemizer.js';

let runtime, modelConfig, phonemeAssets;
const urls = [];
let queue = Promise.resolve();

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44+samples.length*2), view = new DataView(buffer);
  const text = (offset,value) => { for(let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  text(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); text(8,'WAVE'); text(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++) { const sample = Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,sample<0 ? sample*32768 : sample*32767,true); }
  return buffer;
}

async function initialize(assets) {
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  const simd = URL.createObjectURL(new Blob([assets.engine['ort-simd']],{type:'application/wasm'}));
  const basic = URL.createObjectURL(new Blob([assets.engine['ort-basic']],{type:'application/wasm'})); urls.push(simd,basic);
  ort.env.wasm.wasmPaths = {'ort-wasm-simd.wasm':simd,'ort-wasm.wasm':basic};
  modelConfig = assets.config;
  phonemeAssets = {wasmBinary:new Uint8Array(assets.engine['phonemizer-wasm']),data:assets.engine['phonemizer-data']};
  runtime = await ort.InferenceSession.create(assets.modelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
}

async function phonemize(text) {
  let identifiers, failure;
  const module = await createPiperPhonemize({
    wasmBinary:phonemeAssets.wasmBinary, getPreloadedPackage:()=>phonemeAssets.data,
    noInitialRun:true,
    print: line => { try { const result=JSON.parse(line); if (Array.isArray(result.phoneme_ids)) identifiers=result.phoneme_ids; } catch { /* Ignore informational output. */ } },
    printErr: line => { failure=String(line); },
  });
  module.callMain(['-l',modelConfig.espeak.voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
  if (!identifiers?.length) throw new Error(failure || 'Piper не смог разобрать фразу.');
  return identifiers;
}

async function generate(request) {
  if (request.assets) await initialize(request.assets);
  if (!runtime) throw new Error('Модель Piper ещё не загружена.');
  const ids = await phonemize(request.text), config = modelConfig.inference;
  const inputs = {
    input:new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),
    input_lengths:new ort.Tensor('int64',BigInt64Array.from([BigInt(ids.length)]),[1]),
    scales:new ort.Tensor('float32',Float32Array.from([config.noise_scale,config.length_scale/request.rate,config.noise_w]),[3]),
  };
  if (runtime.inputNames.includes('sid')) inputs.sid = new ort.Tensor('int64',BigInt64Array.from([0n]),[1]);
  const output = await runtime.run(inputs), samples = output.output?.data || output[runtime.outputNames[0]]?.data;
  if (!samples?.length) throw new Error('Piper не вернул звук.');
  const wav = encodeWav(samples,modelConfig.audio.sample_rate);
  self.postMessage({id:request.id,wav},[wav]);
}

self.onmessage = event => { const request=event.data; queue=queue.then(()=>generate(request)).catch(error=>self.postMessage({id:request.id,error:error?.message || 'Ошибка Piper.'})); };

```

## src/neural-speech.js

```js
import NeuralWorker from './neural-worker.js?worker&inline';
import { loadNeuralAssets, neuralModel } from './neural-assets.js';
let worker, activeModel, initialized = false, nextId = 0;
const pending = new Map();

export function stopNeuralSpeech() {
  worker?.terminate(); worker=undefined; activeModel=undefined; initialized=false;
  for (const request of pending.values()) { clearTimeout(request.timer); request.signal?.removeEventListener('abort',request.abort); request.reject(new DOMException('Озвучка отменена.','AbortError')); }
  pending.clear();
}

export async function synthesizeNeuralSpeech(text, {modelId,rate=.9,signal} = {}) {
  if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
  if (typeof WebAssembly !== 'object') throw new Error('Этот браузер не поддерживает WASM для Piper.');
  const model = neuralModel(modelId);
  if (worker && activeModel !== model.id) stopNeuralSpeech();
  const assets = initialized && activeModel === model.id ? null : await loadNeuralAssets(model.id);
  if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
  if (!worker) {
    worker=new NeuralWorker(); activeModel=model.id;
    worker.onmessage=event=>{
      const request=pending.get(event.data.id);if(!request)return;
      pending.delete(event.data.id); clearTimeout(request.timer); request.signal?.removeEventListener('abort',request.abort);
      if(event.data.error) request.reject(new Error('Не удалось подготовить Piper. Попробуй короткую фразу или голос браузера.'));
      else { initialized=true;request.resolve(new Blob([event.data.wav],{type:'audio/wav'})); }
    };
    worker.onerror=()=>{ for(const request of pending.values()) { clearTimeout(request.timer);request.signal?.removeEventListener('abort',request.abort);request.reject(new Error('Не удалось запустить Piper. Проверь поддержку WASM и свободную память.')); }pending.clear();worker?.terminate();worker=undefined;initialized=false; };
  }
  const blob=await new Promise((resolve,reject)=>{
    const id=++nextId,request={resolve,reject,signal};
    request.abort=()=>stopNeuralSpeech();
    request.timer=setTimeout(()=>{pending.delete(id);signal?.removeEventListener('abort',request.abort);reject(new Error('Piper готовится слишком долго. Попробуй более короткую фразу.'));stopNeuralSpeech();},120000);
    pending.set(id,request);signal?.addEventListener('abort',request.abort,{once:true});
    const transfer=assets ? [assets.modelBytes,...Object.values(assets.engine)] : [];
    worker.postMessage({id,text,rate,assets},transfer);
  });
  return {blob,info:{engine:'neural',type:'local',name:model.name,lang:model.lang,model:model.id}};
}

```

## src/speech-settings.js

```js
import { getSpeechVoices } from './media.js';
import { speechDescription, voiceSetupInstruction } from './speech-voices.js';
import { cloudDefaults } from './cloud-speech.js';
import { setTTSKey, getTTSKey, ttsKeyState, clearTTSKeys } from './tts-storage.js';
import { neuralModels, neuralModel, neuralModelInstalled, downloadNeuralModel, removeNeuralModel } from './neural-assets.js';
import { stopNeuralSpeech } from './neural-speech.js';

const demoText = 'Learning a little every day makes a difference.';

export function renderSpeechSettings(prefs, {esc,icon}) {
  const mode=['auto','cloud','neural'].includes(prefs.speechVoice) ? prefs.speechVoice : 'auto';
  const config=prefs.cloudSpeech || {},provider=['openai','google','azure'].includes(config.provider) ? config.provider : 'openai',defaults=cloudDefaults[provider];
  return `<div class="setting-group speech-settings"><h2>${icon('sound')} Озвучка слов</h2>
    <label for="speech-voice">Режим озвучки</label><select id="speech-voice">${[['auto','Голоса браузера — лучший доступный'],['cloud','Живой голос — облачный TTS'],['neural','Piper — нейросетевой голос без интернета']].map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${label}</option>`).join('')}</select>
    <p>Онлайн-голоса браузера могут использовать интернет. Голоса доступны только если браузер показывает их в списке. eSpeak включается последним, если остальные варианты недоступны.</p>
    <label for="speech-accent">Английский акцент</label><select id="speech-accent"><option value="en-US" ${prefs.speechAccent!=='en-GB'?'selected':''}>Американский (US)</option><option value="en-GB" ${prefs.speechAccent==='en-GB'?'selected':''}>Британский (UK)</option></select>
    <label for="speech-rate">Скорость <b id="speech-rate-label">${prefs.speechRate || .9}×</b></label><input type="range" id="speech-rate" min="0.5" max="1.5" step="0.1" value="${prefs.speechRate || .9}">
    <button class="secondary" id="speech-demo">${icon('sound')} Проверить озвучку</button><p id="speech-active-voice" role="status" aria-live="polite">После проверки здесь появятся название, язык и тип реально включённого голоса.</p><div id="speech-fallback-help" hidden></div>
    <details class="speech-voice-details" open><summary>Выбрать конкретный английский голос</summary><label for="system-voice-select">Голос браузера</label><select id="system-voice-select"><option value="auto">Выбирать автоматически</option></select><div id="speech-voice-list"></div></details>
    <section class="speech-provider-fields" id="speech-cloud-fields" ${mode!=='cloud'?'hidden':''}><h3>Живой голос</h3><p>Текст отправляется выбранному провайдеру по твоему API-ключу. Провайдер может брать плату за запросы. Готовое аудио сохраняется локально; повтор того же текста не требует нового запроса.</p>
      <label for="cloud-provider">Провайдер</label><select id="cloud-provider">${[['openai','OpenAI TTS'],['google','Google Cloud TTS'],['azure','Azure Speech']].map(([value,label])=>`<option value="${value}" ${provider===value?'selected':''}>${label}</option>`).join('')}</select>
      <label for="cloud-voice-name">Имя облачного голоса</label><input id="cloud-voice-name" maxlength="100" value="${esc(config.voice || defaults.voice)}" spellcheck="false"><p id="cloud-voice-hint"></p>
      <div id="openai-fields" ${provider!=='openai'?'hidden':''}><label for="cloud-openai-model">Модель OpenAI</label><input id="cloud-openai-model" value="${esc(config.model || 'gpt-4o-mini-tts')}" maxlength="100" spellcheck="false"></div>
      <div id="azure-fields" ${provider!=='azure'?'hidden':''}><label for="cloud-azure-region">Регион Azure</label><input id="cloud-azure-region" value="${esc(config.region || 'westeurope')}" maxlength="35" spellcheck="false"></div>
      <label for="cloud-api-key">API-ключ</label><input type="password" id="cloud-api-key" autocomplete="off" placeholder="Вставь свой ключ" spellcheck="false"><label class="remember-key-label" for="remember-tts-key"><input type="checkbox" id="remember-tts-key"> Запомнить ключ в этом браузере</label><p>Без отметки ключ действует в этой вкладке. Ключи не входят в резервные копии и экспорт.</p><div class="study-actions"><button class="secondary" id="save-tts-key">Сохранить ключ</button><button class="secondary" id="clear-tts-keys">Забыть API-ключи</button></div><p id="cloud-key-status" role="status"></p>
    </section>
    <section class="speech-provider-fields"><h3>Piper без интернета</h3><p>Скачай английскую модель и WASM один раз — около 100 МБ. Они останутся в IndexedDB этого браузера. Текст обрабатывается на устройстве; повторно скачивать модель для каждого слова не нужно.</p><label for="neural-model">Нейросетевой голос</label><select id="neural-model">${neuralModels.map(model=>`<option value="${model.id}" ${model.id===(prefs.neuralModelId || neuralModels[0].id)?'selected':''}>${model.name}</option>`).join('')}</select><div class="study-actions"><button class="secondary" id="download-neural-model">Скачать и использовать</button><button class="secondary" id="test-neural-model" disabled>Проверить Piper</button><button class="secondary" id="remove-neural-model" hidden>Удалить модель</button><button class="secondary" id="cancel-neural-download" hidden>Отменить загрузку</button></div><progress id="neural-download-progress" max="100" value="0" hidden aria-label="Загрузка модели Piper"></progress><p id="neural-model-status" role="status"></p><p><a id="neural-model-license" href="https://huggingface.co/rhasspy/piper-voices" target="_blank" rel="noopener noreferrer">Источник и условия использования модели</a></p>
    </section></div>`;
}

export function showSpeechDiagnostics(container, info, {notice = ''} = {}) {
  const label=container?.querySelector('#speech-active-voice, .speech-identity'),help=container?.querySelector('#speech-fallback-help, .speech-fallback-help');
  if(label)label.textContent=speechDescription(info)+(notice ? ` · ${notice}` : '');
  if(!help)return;
  help.replaceChildren();help.hidden=info.type!=='fallback';
  if(info.type==='fallback') {
    const instruction=voiceSetupInstruction(),anchor=document.createElement('a');anchor.textContent='Установи нормальный голос';anchor.href=instruction.url;anchor.target='_blank';anchor.rel='noopener noreferrer';
    const text=document.createElement('p');text.textContent=instruction.text;help.append(anchor,text);
  }
}

export function mountSpeechSettings(root, {getSettings,save,pronounce,esc,notify}) {
  let destroyed=false,downloadController=null,voiceRefresh=0,keyRefresh=0;
  const node=id=>root.querySelector('#'+id);
  const settings=()=>getSettings();
  function updateCloudFields() {
    const provider=settings().cloudSpeech?.provider || 'openai';
    node('openai-fields').hidden=provider!=='openai';node('azure-fields').hidden=provider!=='azure';
    node('cloud-voice-hint').textContent={openai:'Например coral, alloy, nova. Для gpt-4o-mini-tts акцент задаётся отдельно.',google:'Например en-US-Neural2-F или en-GB-Neural2-A. Язык берётся из имени голоса.',azure:'Например en-US-JennyNeural или en-GB-SoniaNeural. Регион должен совпадать с твоим ресурсом Azure.'}[provider];
  }
  async function updateKeyStatus() {
    const sequence=++keyRefresh,provider=settings().cloudSpeech?.provider || 'openai';
    try {const status=await ttsKeyState(provider);if(destroyed || sequence!==keyRefresh)return;node('cloud-key-status').textContent=status.available ? `Ключ ${provider} готов · ${status.remembered?'сохранён в браузере':'только эта вкладка'}` : 'Ключ не добавлен. Сохранённое аудио можно слушать без ключа.';node('remember-tts-key').checked=status.remembered;}
    catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}
  }
  function refreshVoices() {
    if(destroyed)return;
    const voices=getSpeechVoices(settings().speechAccent || 'en-US'),selected=settings().systemVoice || 'auto';
    const options=voices.map(voice=>`<option value="${esc(voice.id)}" ${voice.id===selected?'selected':''}>${esc(voice.name)} · ${voice.lang} · ${voice.localService?'локальный':'онлайн'}</option>`).join('');
    node('system-voice-select').innerHTML=`<option value="auto" ${selected==='auto'?'selected':''}>Выбирать автоматически</option>${options}${selected!=='auto'&&!voices.some(v=>v.id===selected)?`<option value="${esc(selected)}" selected>Сохранённый голос сейчас недоступен</option>`:''}`;
    node('speech-voice-list').innerHTML=voices.length ? voices.map((voice,index)=>`<div class="speech-voice-row"><div><b>${esc(voice.name)}</b><small>${voice.lang} · ${voice.localService?'локальный':'онлайн'}</small></div><button class="secondary" type="button" data-voice-test="${index}" aria-label="Проверить голос ${esc(voice.name)}">Проверить</button></div>`).join('') : '<p>Браузер пока не показал английские голоса. Список обновится автоматически; Piper и запасная озвучка доступны отдельно.</p>';
    node('speech-voice-list').querySelectorAll('[data-voice-test]').forEach(button=>button.onclick=()=>pronounce(demoText,button,{voice:'auto',systemVoice:voices[Number(button.dataset.voiceTest)].id,lang:voices[Number(button.dataset.voiceTest)].lang}));
  }
  async function refreshNeuralStatus() {
    if(destroyed)return;
    const sequence=++voiceRefresh,id=settings().neuralModelId || neuralModels[0].id;
    const model=neuralModel(id);
    node('neural-model-license').href='https://huggingface.co/rhasspy/piper-voices/blob/main/'+model.path.split('/').slice(0,-1).join('/')+'/MODEL_CARD';
    try{const ready=await neuralModelInstalled(id);if(destroyed || sequence!==voiceRefresh || downloadController)return;node('neural-model-status').textContent=ready ? `${neuralModel(id).name}: модель сохранена, можно работать без сети.` : 'Модель ещё не скачана. Пока можно использовать голоса браузера.';node('test-neural-model').disabled=!ready;node('remove-neural-model').hidden=!ready;node('download-neural-model').textContent=ready?'Модель скачана':'Скачать и использовать';}
    catch(error){if(!destroyed)node('neural-model-status').textContent=error.message;}
  }
  node('speech-voice').onchange=event=>{settings().speechVoice=event.target.value;node('speech-cloud-fields').hidden=event.target.value!=='cloud';save();};
  node('system-voice-select').onchange=event=>{settings().systemVoice=event.target.value;settings().speechVoice='auto';node('speech-voice').value='auto';node('speech-cloud-fields').hidden=true;save();};
  node('speech-accent').onchange=event=>{settings().speechAccent=event.target.value;settings().systemVoice='auto';save();refreshVoices();};
  node('speech-rate').oninput=event=>{settings().speechRate=Number(event.target.value);node('speech-rate-label').textContent=`${event.target.value}×`;save();};
  node('speech-demo').onclick=event=>pronounce(demoText,event.currentTarget);
  node('cloud-provider').onchange=()=>{const provider=node('cloud-provider').value;settings().cloudSpeech={provider,...cloudDefaults[provider]};node('cloud-voice-name').value=cloudDefaults[provider].voice;node('cloud-api-key').value='';node('cloud-openai-model').value=cloudDefaults[provider].model || 'gpt-4o-mini-tts';node('cloud-azure-region').value=cloudDefaults[provider].region || 'westeurope';save();updateCloudFields();void updateKeyStatus();};
  for(const [id,key] of [['cloud-voice-name','voice'],['cloud-openai-model','model'],['cloud-azure-region','region']])node(id).oninput=event=>{settings().cloudSpeech={provider:node('cloud-provider').value,...settings().cloudSpeech,[key]:event.target.value.trim()};save();};
  node('save-tts-key').onclick=async()=>{const provider=node('cloud-provider').value,key=node('cloud-api-key').value;if(!key.trim()){node('cloud-key-status').textContent='Вставь API-ключ перед сохранением.';return;}try{await setTTSKey(provider,key,node('remember-tts-key').checked);if(destroyed)return;node('cloud-api-key').value='';await updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('remember-tts-key').onchange=async event=>{const provider=node('cloud-provider').value,remember=event.target.checked;try{const key=await getTTSKey(provider);if(!key)return;await setTTSKey(provider,key,remember);if(!destroyed)void updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('clear-tts-keys').onclick=async()=>{try{await clearTTSKeys();if(destroyed)return;node('cloud-api-key').value='';await updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('neural-model').onchange=event=>{settings().neuralModelId=event.target.value;save();void refreshNeuralStatus();};
  node('test-neural-model').onclick=event=>pronounce(demoText,event.currentTarget,{voice:'neural',neuralId:settings().neuralModelId});
  node('download-neural-model').onclick=async()=>{
    if(downloadController)return;
    const id=node('neural-model').value,controller=downloadController=new AbortController();
    node('download-neural-model').disabled=true;node('neural-model').disabled=true;node('remove-neural-model').disabled=true;node('cancel-neural-download').hidden=false;node('neural-download-progress').hidden=false;
    node('neural-model-status').textContent='Начинаю загрузку модели и WASM…';
    try{await downloadNeuralModel(id,{signal:controller.signal,onProgress:progress=>{if(destroyed)return;node('neural-download-progress').value=Math.min(100,(progress.index-1+(progress.total?progress.loaded/progress.total:0))/progress.count*100);node('neural-model-status').textContent=`Загрузка ${progress.index}/${progress.count} · ${(progress.loaded/1048576).toFixed(1)} МБ${progress.total?` / ${(progress.total/1048576).toFixed(1)} МБ`:''}`;}});settings().neuralModelId=id;settings().speechVoice='neural';save();if(!destroyed){node('speech-voice').value='neural';node('speech-cloud-fields').hidden=true;}notify('Piper скачан. Нейросетевой голос готов без интернета.');}
    catch(error){if(!destroyed)node('neural-model-status').textContent=error.name==='AbortError'?'Загрузка отменена. Уже скачанные файлы сохранены; можно продолжить позже.':`Не получилось скачать Piper. ${error.message}`;}
    finally{downloadController=null;if(!destroyed){node('download-neural-model').disabled=false;node('neural-model').disabled=false;node('remove-neural-model').disabled=false;node('cancel-neural-download').hidden=true;node('neural-download-progress').hidden=true;}}
    if(await neuralModelInstalled(id).catch(()=>false))void refreshNeuralStatus();
  };
  node('cancel-neural-download').onclick=()=>downloadController?.abort();
  node('remove-neural-model').onclick=async()=>{try{stopNeuralSpeech();await removeNeuralModel(node('neural-model').value);void refreshNeuralStatus();}catch(error){if(!destroyed)node('neural-model-status').textContent=error.message;}};
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged',refreshVoices);
  refreshVoices();updateCloudFields();void updateKeyStatus();void refreshNeuralStatus();
  return {destroy(){destroyed=true;globalThis.speechSynthesis?.removeEventListener?.('voiceschanged',refreshVoices);downloadController?.abort();}};
}

```

## src/media.js

```js
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

```

## src/main.js — подключение и полные изменённые функции

```js
import { renderSpeechSettings, mountSpeechSettings, showSpeechDiagnostics } from './speech-settings.js';
let toastTimer, matchController, pronunciationController, deckEditorController, speechSettingsController, modalReturnFocus = null, speechUIRequest = 0;
```

### prepareData

```js
function prepareData(value) {
  ensurePracticeData(value); ensureRankData(value);
  if (!Number.isFinite(value.backupReminderSince) || value.backupReminderSince <= 0) value.backupReminderSince = Date.now();
  if (value.settings.speechVoice === 'offline' || String(value.settings.speechVoice || '').startsWith('offline-')) value.settings.speechVoice = 'auto';
  value.settings.name = typeof value.settings.name === 'string' && value.settings.name.trim() ? value.settings.name.trim().slice(0, 40) : 'Ученик';
  value.categories = [...(Array.isArray(value.categories) ? value.categories : []), ...value.sets.map(s => s.category)].reduce((list, value) => {
  const name = cleanCategory(value);
  if (name && !list.some(c => categoryKey(c) === categoryKey(name))) list.push(name);
  return list;
}
```

### render

```js
function render() {
  speechSettingsController?.destroy(); speechSettingsController = null;
  cleanupSession(); session = null;
  document.body.classList.remove('has-modal');
  applyTheme(data.settings);
  const username = profileName(), avatar = [...username][0].toLocaleUpperCase('ru');
  const titles = { home: `Привет, ${esc(username)}`, sets: 'Мои наборы', stats: 'Твой прогресс', ranks: 'Твои ранги', storage: 'Копии и импорт', settings: 'Настройки' };
  const descriptions = { home: 'Карточки, игры и небольшая практика каждый день.', sets: 'Свои категории, слова, картинки и аудио.', stats: 'Смотри, как занятия складываются в привычку.', ranks: 'Набирай опыт, открывай ранги и замечай свой рост.', storage: 'Сохрани всё на устройстве или перенеси карточки из других приложений.', settings: 'Выбери оформление, звуки и удобную ежедневную цель.' };
  const title = titles[page];
  document.querySelector('#app').innerHTML = `
    <aside><a class="logo" href="#" aria-label="zhekandus, главная">zhekandus</a><div class="workspace">Твоё обучение</div>
      <nav>${[['home', 'Главная', 'home'], ['sets', 'Мои наборы', 'layers'], ['stats', 'Прогресс', 'chart'], ['ranks', 'Ранги', 'trophy'], ['storage', 'Копии и импорт', 'archive'], ['settings', 'Настройки', 'settings']].map(([p, label, glyph]) => `<button class="nav ${page === p ? 'active' : ''}" data-page="${p}" aria-label="${label}" title="${label}" ${page === p ? 'aria-current="page"' : ''}>${icon(glyph)}<span class="nav-label">${label}</span><span class="nav-label-mobile" aria-hidden="true">${({home:'Домой',sets:'Наборы',stats:'Рост',ranks:'Ранги',storage:'Копии',settings:'Опции'})[p]}</span>${p === 'sets' ? `<small>${data.sets.length}</small>` : ''}</button>`).join('')}</nav>
      <div class="side-note"><b>Свой ритм, своя цель</b><p>${countLabel(data.settings.goal, ['ответ', 'ответа', 'ответов'])} в день. Сложные карточки вернутся раньше, знакомые — позже.</p><button class="text-button" id="sidebar-review">Повторить сегодня ${icon('arrow')}</button></div>
      <div class="profile"><div class="avatar">${esc(avatar)}</div><div><b>${esc(username)}</b><small>Моя коллекция</small></div></div></aside>
    <main><header><div class="breadcrumb">zhekandus <span>/</span> ${page === 'home' ? 'Главная' : titles[page]}</div><div class="header-right"><button class="icon-button quick-add" id="quick-add" aria-label="Быстро добавить карточку" title="Добавить карточку">${icon('plus')}</button><button class="icon-button ${data.settings.sounds ? 'is-on' : ''}" id="sound-toggle" aria-pressed="${data.settings.sounds}" title="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки" aria-label="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки">${icon(data.settings.sounds ? 'sound' : 'mute')}</button><button class="icon-button" id="settings" aria-label="Открыть настройки" title="Тема и настройки">${icon('settings')}</button><div class="avatar small" title="${esc(username)}">${esc(avatar)}</div></div></header>
      <div class="content"><div class="welcome"><div><h1>${title}</h1><p>${descriptions[page]}</p></div>${['home', 'sets'].includes(page) ? `<button class="primary" id="create">${icon('plus')} Создать набор</button>` : ''}</div><section id="storage-state" class="storage-state" role="alert" hidden><p></p><button class="secondary" id="retry-storage">Повторить сохранение</button><button class="text-button" id="storage-backup">Сделать резервную копию</button></section>
      ${page === 'settings' ? settingsPage() : page === 'ranks' ? ranksPage(data, icon, esc) : page === 'storage' ? storagePage(icon, data) : page === 'stats' ? statsCards() + calendarPanel() + statsPanel() : `${['home','sets'].includes(page) ? trashReminder() : ''}${page === 'home' ? draftReminder() + hero() + backupReminder() + dashboard() + statsCards() : ''}<section class="collection"><div class="section-heading"><h2>Твои наборы <span>${data.sets.length}</span></h2><label class="search" for="search">${icon('search')}<input id="search" aria-label="Найти набор" placeholder="Найти набор…" value="${esc(query)}"></label></div><div class="tabs" aria-label="Категории"><button data-filter="*" data-all="true" class="${filter === null ? 'selected' : ''}">Все наборы</button>${data.categories.map(c => `<button data-filter="${esc(c)}" class="${c === filter ? 'selected' : ''}">${esc(c)}</button>`).join('')}</div><label class="film-filter" for="film-filter">Фильм / сериал<select id="film-filter"><option value="">Все источники</option>${[...new Set(data.sets.flatMap(set => set.cards.map(card => card[2]?.film).filter(Boolean)))].map(film => `<option value="${esc(film)}" ${film === movieFilter ? 'selected' : ''}>${esc(film)}</option>`).join('')}</select></label><div class="grid" id="sets-grid">${setCards()}</div></section>`}</div>
    </main><div id="modal-root"></div>`;
  bind();
  updateStorageStatus(); updateAutoBackupUI();
}
```

### settingsPage

```js
function settingsPage() {
  const prefs = data.settings;
  return `<section class="settings-panel"><div class="setting-group"><h2>Профиль</h2><label for="profile-name">Имя</label><input id="profile-name" name="name" type="text" maxlength="40" value="${esc(prefs.name || 'Ученик')}" placeholder="Ученик" autocomplete="nickname"></div><div class="setting-group"><h2>${icon('moon')} Тема</h2><p>Светлая, тёмная или как на устройстве.</p><div class="theme-options">${[['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon'], ['system', 'Системная', 'settings']].map(([value, label, glyph]) => `<button class="secondary ${prefs.theme === value ? 'selected' : ''}" data-theme-choice="${value}" aria-pressed="${prefs.theme === value}">${icon(glyph)}${label}</button>`).join('')}</div></div><div class="setting-group"><h2>Акцентный цвет</h2><div class="accent-options">${[['teal', 'Зелёный'], ['blue', 'Синий'], ['orange', 'Терракота'], ['rose', 'Розовый'], ['graphite', 'Графит']].map(([value, label]) => `<button class="accent-swatch ${prefs.accent === value ? 'selected' : ''}" data-accent-choice="${value}" aria-label="${label}" aria-pressed="${prefs.accent === value}"><span></span>${label}</button>`).join('')}</div></div><div class="setting-group"><h2>${icon('target')} Ежедневная цель</h2><label class="goal-label" for="daily-goal">Ответов в день</label><input id="daily-goal" type="number" min="1" max="500" step="1" value="${prefs.goal}"><p>Считаются ответы в карточках, тестах, запоминании и игре.</p></div><div class="setting-row"><div><h2>${icon('sound')} Звуки</h2><p>Ответы, переворот карточек, совпадения и серии.</p></div><label class="toggle" for="setting-sounds"><input type="checkbox" id="setting-sounds" aria-label="Звуковые эффекты" ${prefs.sounds ? 'checked' : ''}><span></span><b>${prefs.sounds ? 'Включены' : 'Выключены'}</b></label></div><div class="setting-group"><h2>Ритм обучения</h2><label for="daily-new-limit">Новых карточек в день</label><input id="daily-new-limit" type="number" min="0" max="500" value="${Number.isInteger(prefs.newCardsPerDay) ? prefs.newCardsPerDay : 20}"><p>Знакомые карточки продолжают повторяться. 0 — только знакомые.</p><label for="reminder-time">Время напоминания</label><input type="time" id="reminder-time" value="${esc(prefs.reminderTime || '19:00')}"><button class="secondary" id="enable-reminders">${prefs.remindersOn ? 'Выключить напоминания' : 'Включить напоминания'}</button><p id="reminder-status" role="status">Напоминание работает, пока приложение открыто; закрытый браузер не поддерживает гарантированное офлайн-расписание.</p><button class="secondary" id="install-app">Установить на телефон</button><p id="install-status" role="status"></p></div>${renderSpeechSettings(prefs,{esc,icon})}<div id="settings-error" class="form-error" role="alert"></div><p class="settings-autosave">Изменения сохраняются автоматически.</p><section class="danger-zone"><h2>Сброс обучения</h2><p>Начни заново: статистика, расписание повторений и опыт рангов будут обнулены.</p><button class="secondary danger-text" id="reset-all-progress">Сбросить весь прогресс</button></section></section>`;
}
```

### bindSettings

```js
function bindSettings() {
  speechSettingsController = mountSpeechSettings(document.querySelector('.speech-settings'),{getSettings:()=>data.settings,save,pronounce,esc,notify});
  const updateProfile = () => {
    const name = profileName(), avatar = [...name][0].toLocaleUpperCase('ru');
    document.querySelector('.profile b').textContent = name;
    document.querySelectorAll('.avatar').forEach(node => { node.textContent = avatar; if (node.classList.contains('small')) node.title = name; });
  };
  document.querySelector('#profile-name').oninput = e => { data.settings.name = e.target.value.trim() || 'Ученик'; save(); updateProfile(); };
  document.querySelector('#profile-name').onblur = e => { e.target.value = profileName(); };
  document.querySelector('#daily-goal').oninput = e => {
    const goal = Number(e.target.value), valid = Number.isInteger(goal) && goal >= 1 && goal <= 500;
    e.target.setAttribute('aria-invalid', String(!valid));
    document.querySelector('#settings-error').textContent = valid ? '' : 'Выбери цель от 1 до 500 ответов. Пока действует предыдущая цель.';
    if (valid) { data.settings.goal = goal; save(); }
  };
  const choose = (key, value, selector) => { data.settings[key] = value; save(); render(); document.querySelector(selector)?.focus({ preventScroll: true }); };
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => choose('theme', button.dataset.themeChoice, `[data-theme-choice="${button.dataset.themeChoice}"]`));
  document.querySelectorAll('[data-accent-choice]').forEach(button => button.onclick = () => choose('accent', button.dataset.accentChoice, `[data-accent-choice="${button.dataset.accentChoice}"]`));
  document.querySelector('#setting-sounds').onchange = e => {
    data.settings.sounds = e.target.checked; save();
    e.target.parentElement.querySelector('b').textContent = e.target.checked ? 'Включены' : 'Выключены';
    const toggle = document.querySelector('#sound-toggle');
    toggle.classList.toggle('is-on', e.target.checked); toggle.setAttribute('aria-pressed', String(e.target.checked));
    toggle.title = `${e.target.checked ? 'Выключить' : 'Включить'} звуки`; toggle.setAttribute('aria-label', toggle.title); toggle.innerHTML = icon(e.target.checked ? 'sound' : 'mute');
    if (e.target.checked) playSound('click', true); else stopAudio();
  };
  document.querySelector('#daily-new-limit').oninput = e => { const limit = Number(e.target.value); const valid = Number.isInteger(limit) && limit >= 0 && limit <= 500; e.target.setAttribute('aria-invalid', String(!valid)); if (valid) { data.settings.newCardsPerDay = limit; save(); } };
  document.querySelector('#reminder-time').onchange = e => { if (/^\d{2}:\d{2}$/.test(e.target.value)) { data.settings.reminderTime = e.target.value; save(); } };
  document.querySelector('#enable-reminders').onclick = async e => {
    const status = document.querySelector('#reminder-status');
    if (data.settings.remindersOn) { data.settings.remindersOn = false; save(); e.currentTarget.textContent = 'Включить напоминания'; return; }
    if (!globalThis.Notification) { status.textContent = 'Браузер не поддерживает уведомления. Оставь приложение открытым: напоминание появится здесь.'; data.settings.remindersOn = true; save(); e.currentTarget.textContent = 'Выключить напоминания'; return; }
    const button = e.currentTarget; const permission = await Notification.requestPermission();
    data.settings.remindersOn = true; save(); button.textContent = 'Выключить напоминания';
    status.textContent = permission === 'granted' ? 'Напоминания включены, пока приложение открыто.' : 'Уведомления браузера не разрешены. Напоминание появится внутри открытого приложения.';
  };
  document.querySelector('#install-app').onclick = () => installApplication();
  document.querySelector('#reset-all-progress').onclick = () => confirmDataAction({ title: 'Сбросить весь прогресс?', description: 'Будут обнулены ответы, календарь занятий, расписание повторений, результаты карточек и опыт рангов. Наборы, вложения и настройки сохранятся.', label: 'Сбросить прогресс', cancel: () => goPage('settings'), confirm: async () => { await commitReplacement(resetAllProgress(data)); goPage('settings'); notify('Весь прогресс сброшен'); } });
}
```

### startPronunciation

```js
function startPronunciation(set, index = 0) {
  const cards = limitedCards(set.cards);
  if (!cards.length) { notify('Лимит новых карточек на сегодня достигнут.'); return; }
  index = Math.max(0, Math.min(index, cards.length - 1));
  if (introduceCard(data, cards[index])) save();
  rememberStudy(set);
  session = null;
  modal(`<div class="eyebrow">Произношение · ${esc(set.title)}</div><div id="pronunciation-root"></div><div class="study-actions pronunciation-navigation"><button class="secondary" id="pronunciation-prev" ${!index ? 'disabled' : ''}>← Предыдущее слово</button><span>${index + 1} / ${cards.length}</span><button class="secondary" id="pronunciation-next" ${index === cards.length - 1 ? 'disabled' : ''}>Следующее слово →</button></div>`, () => openSet(set.id));
  modalExitGuard = protectModal({ isDirty: () => Boolean(pronunciationController?.hasRecording()), message: 'Запись произношения хранится только в этом занятии. Скачай её перед выходом.' });
  pronunciationController = mountPronunciation(document.querySelector('#pronunciation-root'), cards[index], { esc, icon, pronounce: (text,button,options) => pronounce(text,button,{...options,card:cards[index]}), sound, notify, onExit: () => document.querySelector('.close').click() });
  document.querySelector('#pronunciation-prev').onclick = () => { if (index > 0) modalExitGuard(() => startPronunciation(set, index - 1)); };
  document.querySelector('#pronunciation-next').onclick = () => { if (index < cards.length - 1) modalExitGuard(() => startPronunciation(set, index + 1)); };
}
```

### pronounce

```js
async function pronounce(text, button, options = {}) {
  const request = String(++speechUIRequest);
  document.querySelectorAll('.is-speaking').forEach(node => node.classList.remove('is-speaking'));
  document.querySelectorAll('.speech-status').forEach(node => { node.textContent = ''; });
  const parent = button?.closest('.modal, .speech-settings, .hero-preview');
  let status = parent?.querySelector('.speech-status');
  if (parent && !status) {
    status = document.createElement('p'); status.className = 'speech-status'; status.setAttribute('role', 'status');
    const tools = button.closest('.study-tools, .pronunciation-controls');
    if (tools) tools.after(status); else button.after(status);
  }
  if (status) { status.dataset.request = request; status.textContent = 'Готовлю озвучку…'; }
  button?.classList.add('is-speaking');
  button?.setAttribute('aria-busy', 'true');
  if (button) button.dataset.speechRequest = request;
  const cleanup = () => {
    if (button?.dataset.speechRequest === request) { button.classList.remove('is-speaking'); button.setAttribute('aria-busy', 'false'); }
    if (status?.dataset.request === request) status.textContent = '';
  };
  const card = options.card, settings = data.settings;
  const engine = options.voice || settings.speechVoice || 'auto';
  const result = await speakText(text, {
    voice: engine, systemVoice: options.systemVoice || settings.systemVoice || 'auto', cloud: settings.cloudSpeech || {}, neuralId: options.neuralId || settings.neuralModelId,
    cacheEntries: card?.[2]?.ttsClips,
    onCache: (key,entry) => {
      const id=card?.[2]?.id;
      if(!id)return;
      const live = data.sets.flatMap(set=>set.cards).find(item=>item[2]?.id===id);
      if(!live)return;
      live[2].ttsClips ||= {};live[2].ttsClips[key]=entry;save();
    },
    rate: options.rate ?? settings.speechRate ?? .9,
    lang: options.lang || (/[а-яё]/i.test(String(text)) ? 'ru-RU' : settings.speechAccent || 'en-US'),
    onStart: info => {
      if(status?.dataset.request !== request)return;
      status.textContent='';
      if(parent && !parent.querySelector('#speech-active-voice, .speech-identity')) {
        const identity=document.createElement('p');identity.className='speech-identity';identity.setAttribute('role','status');
        const help=document.createElement('div');help.className='speech-fallback-help';help.hidden=true;status.after(identity,help);
      }
      showSpeechDiagnostics(parent,info);
    },
    onNotice: message => { if(status?.dataset.request===request)status.textContent=message; },
    onEnd: event => { cleanup(); if (!event?.cancelled && !event?.error && (!event?.status || event.status === 'ended')) options.onEnd?.(); },
    onError: message => { options.onError?.(message); notify(message); },
  });
  if (!result.ok) { cleanup(); options.onError?.(result.message); notify(result.message || 'Не удалось включить озвучку.'); }
  return result;
}
```

### study

```js
function study() {
  const s = session; if (!s || s.index >= s.queue.length) { finish(); return; }
  const card = s.queue[s.index], reverse = s.direction === 'reverse';
  if (introduceCard(data, card)) save();
  const cloze = s.mode === 'cloze' ? buildCloze(card) : null;
  const listening = s.mode === 'listening' ? buildListening(card) : null;
  const prompt = card[reverse ? 1 : 0], expected = cloze?.answer || listening?.answer || card[reverse ? 0 : 1];
  s.expected = expected;
  const isCard = ['flash', 'review', 'weak', 'starred'].includes(s.mode);
  if (s.mode === 'test' && !s.options) s.options = choices(s.set, card, s.direction);
  const daily = dailyProgress(data), rank = rankProgress(data);
  let exercise;
  if (isCard) {
    exercise = `<button class="flashcard" id="flip" aria-label="${esc(prompt)}. Перевернуть карточку" aria-pressed="false"><div class="flashcard-inner"><div class="flash-face flash-front" aria-hidden="false"><span>${reverse ? 'Значение' : 'Термин'}</span><h2>${esc(prompt)}</h2></div><div class="flash-face flash-back" aria-hidden="true"><span>${reverse ? 'Термин' : 'Значение'}</span><h2>${esc(expected)}</h2></div></div><small class="flip-caption">${icon('rotate')} Нажми, чтобы перевернуть</small></button>${studyTools(card, true)}<div class="study-actions rating-actions"><button class="secondary" id="again">${icon('rotate')} Ещё повторить</button><button class="secondary" id="hard">${icon('wave')} Трудно</button><button class="primary" id="known">${icon('check')} Знаю</button><button class="secondary" id="easy">${icon('bolt')} Легко</button></div><p class="keyboard-hint"><kbd>Пробел</kbd> переворачивает · <kbd>1</kbd> ещё повторить · <kbd>2</kbd> знаю · <kbd>3</kbd> легко · <kbd>4</kbd> трудно</p>`;
  } else {
    let question;
    if (cloze) question = `<div class="question"><span>Впиши пропущенное слово или выражение</span><p class="cloze-sentence">${esc(cloze.before)}<span class="cloze-blank" aria-label="Пропущенные слова">••••</span>${esc(cloze.after)}</p></div><div class="study-tools"><button class="secondary" id="speak-term">${icon('sound')} Послушать предложение ${icon('wave')}</button></div>`;
    else if (listening) question = `<div class="listening-card"><div class="listening-icon">${icon('sound')}</div><h2>Слушай и пиши</h2><p class="listening-prompt">Послушай слово или выражение и напиши то, что услышал.</p><button class="primary" id="speak-term">${icon('sound')} Прослушать ${icon('wave')}</button></div>`;
    else question = `<div class="question"><span>${s.mode === 'test' ? 'Выбери правильный ответ' : 'Вспомни ответ'}</span><h2>${esc(prompt)}</h2></div>${studyTools(card, !reverse)}`;
    const answer = s.mode === 'test' ? `<div class="answer-options" aria-label="Варианты ответа">${s.options.map((option, index) => `<button class="answer-option" data-choice="${index}"><span class="option-key">${index + 1}</span><span class="option-text">${esc(option)}</span><span class="option-status"></span></button>`).join('')}</div><p class="test-caption">Один правильный ответ · можно нажать цифру варианта</p><div id="feedback" role="status" aria-live="polite"></div><button class="primary" id="next-question" disabled>Выбери ответ ${icon('arrow')}</button>` : `<form id="answer-form"><input id="answer" aria-label="Твой ответ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${listening ? 'Напиши услышанное…' : cloze ? 'Пропущенное слово или выражение…' : 'Твой ответ…'}" required><div id="feedback" role="status" aria-live="polite"></div><button class="primary" type="submit">Проверить ${icon('arrow')}</button></form><button class="hint" id="hint">Нужна подсказка?</button>`;
    exercise = question + answer;
  }
  const labels = { starred: 'По звёздочкам', weak: 'Слабые карточки', flash: 'Карточки', review: 'Интервальное повторение', test: 'Тест', learn: 'Запоминание', cloze: 'Пропуски', listening: 'Аудирование' };
  const directionLabel = cloze ? 'Предложение → слово' : listening ? 'Слушаю → пишу' : reverse ? 'Значение → термин' : 'Термин → значение';
  modal(`<div class="eyebrow">${labels[s.mode]} · ${esc(s.set.title)}</div><div class="study-meta"><span>${s.index + 1} / ${s.queue.length}</span><span class="direction-badge">${directionLabel}</span><span class="streak ${s.streak >= 3 ? 'is-hot' : ''}">${icon('bolt')} <span>${s.streak} подряд</span></span></div><div class="progress-track"><i style="width:${s.index / s.queue.length * 100}%"></i></div>${studyCardActions(card)}${exercise}<p class="study-daily">Сегодня: ${daily.answers} / ${daily.goal} ответов</p><p class="study-xp">${rank.name} · ${rank.xp} XP</p>`);
  modalExitGuard = protectModal({ isDirty: () => true, message: 'Ответы и прогресс уже сохранены. Закончить это занятие?' });
  document.querySelector('#star-card')?.addEventListener('click', e => { card[2].starred = !card[2].starred; save(); e.currentTarget.setAttribute('aria-pressed', String(card[2].starred)); e.currentTarget.innerHTML = `${icon('star')} ${card[2].starred ? 'Убрать звёздочку' : 'Сложная'}`; });
  document.querySelector('#edit-study-card')?.addEventListener('click', () => quickCard({ card, studySession: s }));
  hydrateAttachments(document.querySelector('.modal'));
  document.querySelector('#speak-term').onclick = e => pronounce(cloze?.sentence || listening?.prompt || (isCard ? card[0] : prompt), e.currentTarget,{card});
  document.querySelector('#speak-example')?.addEventListener('click', e => pronounce(card[2].example, e.currentTarget,{card}));
  if (isCard) {
    document.querySelector('#flip').onclick = e => {
      s.flipped = !s.flipped; e.currentTarget.classList.toggle('is-flipped', s.flipped); e.currentTarget.setAttribute('aria-pressed', String(s.flipped));
      e.currentTarget.setAttribute('aria-label', `${s.flipped ? expected : prompt}. Перевернуть карточку`);
      e.currentTarget.querySelector('.flash-front').setAttribute('aria-hidden', String(s.flipped));
      e.currentTarget.querySelector('.flash-back').setAttribute('aria-hidden', String(!s.flipped)); sound('flip');
    };
    document.querySelector('#again').onclick = () => { record(false, card, 'again'); s.queue.push(card); sound('wrong'); nextCard(); };
    for (const [id, grade] of [['hard', 'hard'], ['known', 'good'], ['easy', 'easy']]) {
      document.querySelector(`#${id}`).onclick = () => { record(true, card, grade); sound('correct'); if (s.streak % 3 === 0) celebrate(); nextCard(); };
    }
  } else if (s.mode === 'test') {
    document.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => chooseAnswer(Number(button.dataset.choice)));
    document.querySelector('#next-question').onclick = () => { if (s.answered) nextCard(); };
  } else {
    document.querySelector('#answer').focus();
    document.querySelector('#hint').onclick = e => { e.currentTarget.textContent = `Начинается с «${expected.slice(0, 2)}…»`; };
    document.querySelector('#answer-form').onsubmit = e => {
      e.preventDefault(); if (s.answered) { nextCard(); return; }
      const answer = document.querySelector('#answer').value; if (!answer.trim()) return;
      const ok = cloze ? evaluateCloze(answer, cloze) : listening ? evaluateListening(answer, listening) : matchesTypedAnswer(answer, [...validAnswers(s.set, card, s.direction)]);
      const variants = cloze ? [cloze.answer, ...(cloze.alternatives || [])] : listening ? listening.answer : [...validAnswers(s.set, card, s.direction)];
      s.acceptedTypo = ok && !answerVariants(variants).includes(normalizeTypedAnswer(answer));
      if (!ok) s.queue.push(card);
      acceptAnswer(answer, ok); document.querySelector('#answer').disabled = true;
      document.querySelector('#answer-form button[type="submit"]').innerHTML = `${nextLabel()} ${icon('arrow')}`; document.querySelector('#hint').remove(); document.querySelector('#answer-form button[type="submit"]').focus();
    };
  }
}
```

## scripts/standalone.mjs — полный генератор HTML

```js
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(process.argv[2] || resolve(root, 'dist/zhekandus.html'));
// Bundle local modules before embedding: the downloadable file needs no server.
const result = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, cssCodeSplit: false, rollupOptions: { input: resolve(root, 'index.html') },
} });
const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
const entries = output.filter(item => item.type === 'chunk' && item.isEntry);
if (entries.length !== 1 || entries[0].imports.length || entries[0].dynamicImports.length) {
  throw new Error('Standalone build must contain one self-contained JavaScript entry.');
}
// Compress the complete JavaScript bundle, including voice data. The browser
// expands it locally; no URL, CDN, fetch, or additional file is needed.
const moduleBytes = Buffer.from(entries[0].code, 'utf8');
const compressedBytes = gzipSync(moduleBytes, { level: 9 });
const script = compressedBytes.toString('base64');
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
const speechNotice = await readFile(resolve(root, 'src/voice/NOTICE'), 'utf8');
const speechLicense = await readFile(resolve(root, 'src/voice/LICENSE'), 'utf8');
const licenseComment = `${speechNotice}\n${speechLicense}`;
if (/-->|--!>/.test(licenseComment)) throw new Error('Speech license must be embedded as a safe, verbatim HTML comment.');
const neuralComment = (await Promise.all(['src/voice/PIPER-NOTICE','licenses/DIFFUSIONSTUDIO-MIT.txt','licenses/PIPER-MIT.txt','licenses/ONNX-RUNTIME-MIT.txt'].map(name=>readFile(resolve(root,name),'utf8')))).join('\n');
if (/-->|--!>/.test(neuralComment)) throw new Error('Neural speech notice must be embedded as a safe, verbatim HTML comment.');
const html = `<!doctype html>
<!-- Local speech engine license and source information:\n${licenseComment}\n-->
<!-- Optional neural speech licenses and source information:\n${neuralComment}\n-->
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f5f7f3">
<title>zhekandus — карточки, игры и повторение</title>
<style>${css}</style></head><body><div id="app"><p data-zhekandus-startup role="status" style="padding:32px;font:20px Arial,sans-serif">Запускаю zhekandus…</p></div>
<script>
// This small, uncompressed watchdog also runs when the module is truncated or
// cannot be parsed. It never replaces the app's own storage recovery panel.
(() => {
  let finished = false;
  const app = document.getElementById('app');
  const showFailure = reason => {
    if (!app || app.querySelector('.startup-error')) return;
    const panel = document.createElement('section');
    panel.className = 'startup-error loader-startup-error';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'max-width:760px;margin:32px auto;padding:24px;font:20px/1.5 Arial,sans-serif;overflow-wrap:anywhere';
    const heading = document.createElement('h1');
    heading.textContent = 'Не удалось запустить zhekandus';
    heading.style.cssText = 'font-size:28px;line-height:1.25';
    const message = document.createElement('p');
    message.textContent = reason;
    const help = document.createElement('p');
    help.textContent = 'Перезагрузи страницу. Если ошибка повторяется, скачай проверенный архив, распакуй его и открой zhekandus.html в браузере.';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'primary';
    reload.textContent = 'Перезагрузить';
    reload.addEventListener('click', () => location.reload());
    const download = document.createElement('a');
    download.className = 'secondary';
    download.href = 'https://github.com/unsaidself/REALNO-ENGLISH/raw/f24b2240bc1c5b4b5a0838a6893e805a6e1ff030/zhekandus.zip';
    download.textContent = 'Скачать проверенную версию';
    actions.append(reload, download);
    panel.append(heading, message, help, actions);
    app.replaceChildren(panel);
  };
  const watchdog = setTimeout(() => {
    if (!finished && app?.querySelector('[data-zhekandus-startup]')) {
      finished = true;
      showFailure('Запуск не завершился. HTML-файл мог повредиться или загрузиться не полностью.');
    }
  }, 12000);
  globalThis.__zhekandusBoot = {
    fail(reason) { finished = true; clearTimeout(watchdog); showFailure(reason); },
    done() { finished = true; clearTimeout(watchdog); },
  };
})();
</script>
<script type="module">
let source;
let phase = 'decode';
const startup = globalThis.__zhekandusBoot;
try {
  if (!globalThis.DecompressionStream) throw new Error('Этот браузер не поддерживает распаковку приложения. Открой файл в актуальной версии Chrome, Edge, Firefox или Safari.');
  const encoded = '${script}';
  if (encoded.length !== ${script.length} || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Данные приложения в HTML-файле повреждены или обрезаны (Base64).');
  }
  let binary;
  try { binary = atob(encoded); } catch { throw new Error('Не удалось декодировать данные приложения (Base64).'); }
  if (btoa(binary) !== encoded) throw new Error('Данные приложения содержат некорректную строку Base64.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length !== ${compressedBytes.length} || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) {
    throw new Error('Сжатые данные приложения повреждены. Нужен полный HTML-файл с корректным архивом gzip.');
  }
  phase = 'decompress';
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const module = await new Response(stream).arrayBuffer();
  if (module.byteLength !== ${moduleBytes.length}) throw new Error('Распакованный код приложения обрезан.');
  phase = 'module';
  source = URL.createObjectURL(new Blob([module], { type: 'text/javascript' }));
  await import(source);
} catch (error) {
  const reason = phase === 'decompress'
    ? 'Не удалось распаковать приложение. Сжатые данные HTML-файла повреждены или обрезаны.'
    : phase === 'module'
      ? 'Не удалось выполнить код приложения. ' + String(error?.message || 'Неизвестная ошибка.').slice(0, 500)
      : String(error?.message || 'Не удалось прочитать данные приложения.').slice(0, 500);
  startup.fail(reason);
} finally {
  if (source) URL.revokeObjectURL(source);
  startup.done();
  delete globalThis.__zhekandusBoot;
}
</script></body></html>`;
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html, 'utf8');
await chmod(destination, 0o644);
console.log(`Standalone app: ${destination} (${Buffer.byteLength(html)} bytes)`);

```

Неизменённая фабрика фонемизатора находится в `src/voice/piper-phonemizer.js`.
Её источник, версия, контрольные суммы и лицензии: `src/voice/PIPER-NOTICE`
и `licenses/`. Все эти файлы включены в архив с приложением.
