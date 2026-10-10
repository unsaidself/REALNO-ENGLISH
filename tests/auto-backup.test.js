import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoBackup } from '../src/auto-backup.js';
import { duplicateCards } from '../src/card-text.js';

test('auto backup writes a coherent real version 1 backup and retains the prior file when writing fails', async () => {
 const { indexedDB } = await import('fake-indexeddb'); const previousDB=globalThis.indexedDB;globalThis.indexedDB=indexedDB;
 const open = indexedDB.open('zhekandus-media',2);await new Promise((resolve,reject)=>{open.onupgradeneeded=()=>{open.result.createObjectStore('attachments',{keyPath:'id'});open.result.createObjectStore('state');};open.onsuccess=resolve;open.onerror=reject;});open.result.close();
 let disk='previous backup',fail=false,remembered,writingTime;
 const handle={name:'copy.json',queryPermission:async()=>'granted',createWritable:async()=>{let staged;return {write:async blob=>{if(fail)throw new Error('disk full');staged=await blob.text();},close:async()=>{disk=staged;},abort:async()=>{}};}};
 const data={sets:[{id:'s',title:'Фильм',cards:[['Hold the door','Держи дверь',{id:'c',film:'Сериал',episode:'S01E02',timecode:'00:01:03'}]]}],answers:0,learned:0};
 const backup=createAutoBackup({getData:()=>data,loadHandle:async()=>undefined,saveHandle:async h=>{remembered=h;},picker:async()=>handle,onWritten:t=>{writingTime=t;}});
 try {
  await backup.initialize();await backup.configure();assert.deepEqual(remembered,{filename:'copy.json'});assert.ok(writingTime);
  const saved=JSON.parse(disk);assert.equal(saved.format,'zhekandus-backup');assert.equal(saved.version,1);assert.deepEqual(saved.data.sets,data.sets);
  const good=disk;data.answers=1;fail=true;backup.request();await backup.flush();assert.equal(disk,good);assert.match(backup.status().error,/disk full/);
  fail=false;backup.request();await backup.flush();assert.equal(JSON.parse(disk).data.answers,1);
  await backup.disable();assert.equal(remembered,null);assert.equal(backup.status().enabled,false);
 }finally{await backup.disable();globalThis.indexedDB=previousDB;}
});
test('duplicate warnings catch existing terms and duplicates inside a pasted batch without deleting aliases',()=>{
 const existing=[['Hold the door','Держи дверь']];
 assert.equal(duplicateCards([[' hold THE door. ','Придержи дверь'],['Journey','Путешествие'],['Journey','Дорога']],existing).length,2);
});
