import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSpeechVoices, selectSpeechVoice, voiceQuality, speechDescription, voiceSetupInstruction } from '../src/speech-voices.js';
import { cloudSpeechRequest, cloudSpeechIdentity, synthesizeCloudSpeech, speechCacheKey } from '../src/cloud-speech.js';
import { setTTSKey, getTTSKey, ttsKeyState, clearTTSKeys } from '../src/tts-storage.js';
import { createBackup } from '../src/portability.js';

const voices=[
 {name:'eSpeak English',lang:'en-US',voiceURI:'espeak',localService:true},
 {name:'Samantha compact',lang:'en-US',voiceURI:'compact',localService:true},
 {name:'Google US English',lang:'en-US',voiceURI:'google',localService:false},
 {name:'Microsoft Aria Online Natural',lang:'en-US',voiceURI:'aria',localService:false},
 {name:'Microsoft Sonia Natural',lang:'en-GB',voiceURI:'sonia',localService:false},
 {name:'Русский',lang:'ru-RU',voiceURI:'ru',localService:true},
];
test('native selection keeps remote voices and ranks accent before quality',()=>{
 assert.deepEqual(rankSpeechVoices(voices,'en-US').map(v=>v.voiceURI),['aria','google','compact','espeak','sonia']);
 assert.equal(selectSpeechVoice(voices,'en-GB').voiceURI,'sonia');
 assert.equal(selectSpeechVoice(voices,'en-US','google').voiceURI,'google');
 assert.equal(selectSpeechVoice(voices,'ru-RU','aria').voiceURI,'ru');
 assert.equal(selectSpeechVoice(voices,'en-US','auto',{localOnly:true}).voiceURI,'compact');
 assert.ok(voiceQuality(voices[3])>voiceQuality(voices[0]));
 assert.equal(speechDescription({name:'Aria',type:'online',lang:'en-US'}),'Голос: Aria · онлайн · en-US');
 assert.match(voiceSetupInstruction('iPhone').url,/support.apple.com/);
 assert.equal(voiceSetupInstruction('Linux').platform,'Linux');
});
test('provider requests use fixed hosts, keep credentials out of metadata and escape Azure SSML',()=>{
 const openai=cloudSpeechRequest('Hello',{key:'fixture-key',lang:'en-GB',rate:.9,config:{provider:'openai'}});
 assert.equal(openai.url,'https://api.openai.com/v1/audio/speech');assert.equal(openai.options.headers.Authorization,'Bearer fixture-key');assert.match(JSON.parse(openai.options.body).instructions,/British/);assert.ok(!JSON.stringify(openai.identity).includes('fixture-key'));
 const google=cloudSpeechRequest('Hello',{key:'fixture-key',rate:1,config:{provider:'google',voice:'en-GB-Neural2-A'}});
 assert.equal(JSON.parse(google.options.body).voice.languageCode,'en-GB');assert.ok(!google.url.includes('fixture-key'));
 const azure=cloudSpeechRequest('A & B < C',{key:'fixture-key',rate:1,config:{provider:'azure',voice:'en-US-JennyNeural',region:'eastus'}});
 assert.match(azure.options.body,/A &amp; B &lt; C/);assert.match(azure.url,/^https:\/\/eastus\.tts\.speech\.microsoft\.com\//);
 assert.throws(()=>cloudSpeechRequest('Hello',{key:'fixture-key',config:{provider:'azure',region:'evil.example/path'}}),/регион/);
});
test('cloud audio results are decoded, status errors are actionable, and cancellation aborts fetch',async()=>{
 const wav=Uint8Array.from([82,73,70,70,0,0,0,0,87,65,86,69]);
 const result=await synthesizeCloudSpeech('Hello',{key:'fixture-key',config:{provider:'google'},fetcher:async()=>new Response(JSON.stringify({audioContent:btoa(String.fromCharCode(...wav))}),{headers:{'Content-Type':'application/json'}})});
 assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[...wav]);
 await assert.rejects(()=>synthesizeCloudSpeech('Hello',{key:'fixture-key',fetcher:async()=>new Response('{"error":"not audio"}')}),/без аудио/);
 await assert.rejects(()=>synthesizeCloudSpeech('Hello',{key:'fixture-key',config:{provider:'google'},fetcher:async()=>new Response('{broken json')}),/Google не вернул корректное аудио/);
 await assert.rejects(()=>synthesizeCloudSpeech('Hello',{key:'fixture-key',fetcher:async()=>new Response('',{status:401})}),/отклонил ключ/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>synthesizeCloudSpeech('Hello',{key:'fixture-key',signal:controller.signal,fetcher:async(_url,{signal})=>{if(signal.aborted)throw new DOMException('aborted','AbortError');return new Response();}}),error=>error.name==='AbortError');
});
test('audio cache identity changes with text, provider, voice, accent and speed',async()=>{
 const identity=cloudSpeechIdentity({provider:'openai',voice:'coral'}),base={identity,lang:'en-US',rate:.9};
 const key=await speechCacheKey('Hello',base);assert.equal(key,await speechCacheKey(' Hello ',base));
 for(const changed of [{...base,rate:1},{...base,lang:'en-GB'},{...base,identity:cloudSpeechIdentity({provider:'google'})}])assert.notEqual(key,await speechCacheKey('Hello',changed));
 assert.notEqual(key,await speechCacheKey('World',base));
});
test('API keys are stored separately and never appear in a version 1 backup',async()=>{
 const previous=globalThis.indexedDB;globalThis.indexedDB=(await import('fake-indexeddb')).indexedDB;
 try{
  const request=indexedDB.open('zhekandus-media',2);await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('attachments'))request.result.createObjectStore('attachments',{keyPath:'id'});if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state');};request.onsuccess=resolve;request.onerror=reject;});request.result.close();
  await setTTSKey('openai','fixture-secret-key',true);assert.equal(await getTTSKey('openai'),'fixture-secret-key');assert.equal((await ttsKeyState('openai')).remembered,true);
  await setTTSKey('google','fixture-session-key',false);assert.equal((await ttsKeyState('google')).remembered,false);
  const backup=await createBackup({sets:[],settings:{cloudSpeech:{provider:'openai',voice:'coral'}}});const text=await backup.text();assert.ok(!text.includes('fixture-secret-key'));assert.ok(!text.includes('fixture-session-key'));
  await clearTTSKeys();assert.equal(await getTTSKey('openai'),'');assert.equal(await getTTSKey('google'),'');
 }finally{globalThis.indexedDB=previous;}
});
