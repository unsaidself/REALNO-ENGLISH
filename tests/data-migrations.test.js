import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { removeRetiredAudioCache } from '../src/data-migrations.js';

test('retiring voice models and keys leaves personal cards and legacy attachment bytes intact', async () => {
  const indexedDB = new IDBFactory();
  function open(name,store) { return new Promise((resolve,reject)=>{ const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{for(const name of (Array.isArray(store)?store:[store]))request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error); }); }
  async function put(db,store,key,value) { return new Promise((resolve,reject)=>{ const transaction=db.transaction(store,'readwrite');transaction.objectStore(store).put(value,key);transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error); }); }
  const retired=await open('zhekandus-tts',['assets','credentials']);await put(retired,'assets','model',new Uint8Array([1,2,3]));await put(retired,'credentials','openai','test-key');retired.close();
  const personal=await open('zhekandus-media',['state','attachments']),state={sets:[{id:'set-1',cards:[['Term','Значение',{id:'card-1',audioId:'legacy-recording'}]]}],answers:37};
  await put(personal,'state','main',state);
  await put(personal,'attachments','legacy-recording',new Blob([new Uint8Array([7,8,9])],{type:'audio/wav'}));
  assert.equal(await removeRetiredAudioCache(indexedDB),true);
  assert.ok(!(await indexedDB.databases()).some(db=>db.name==='zhekandus-tts'));
  const request=personal.transaction('state').objectStore('state').get('main');
  assert.deepEqual(await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}),state);
  const recording=personal.transaction('attachments').objectStore('attachments').get('legacy-recording');
  const blob=await new Promise((resolve,reject)=>{recording.onsuccess=()=>resolve(recording.result);recording.onerror=()=>reject(recording.error);});
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[7,8,9]);
  personal.close();
  assert.equal(await removeRetiredAudioCache(null),false);
});
