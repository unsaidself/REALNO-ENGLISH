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
