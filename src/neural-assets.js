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
