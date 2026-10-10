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
