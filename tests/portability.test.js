import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { indexedDB, IDBObjectStore, IDBFactory } from 'fake-indexeddb';
import { createBackup, inspectBackup, restoreBackup, parseImport, stageImport, discardStaged, commitStaged, exportCSV } from '../src/portability.js';

globalThis.indexedDB = indexedDB;
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode('RIFF')); wav.set(new TextEncoder().encode('WAVEfmt '), 8);
const view = new DataView(wav.buffer); view.setUint32(4,40,true); view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);wav.set(new TextEncoder().encode('data'),36);view.setUint32(40,4,true);

async function dbRecords() {
  const db = await new Promise((resolve,reject)=>{const request=globalThis.indexedDB.open('zhekandus-media',2);request.onupgradeneeded=()=>{request.result.createObjectStore('attachments',{keyPath:'id'});request.result.createObjectStore('state');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return {db,all:()=>new Promise((resolve,reject)=>{const req=db.transaction('attachments','readonly').objectStore('attachments').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}),put:record=>new Promise((resolve,reject)=>{const tx=db.transaction('attachments','readwrite');tx.objectStore('attachments').put(record);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);})};
}
let persistedData;
const sampleData = { sets:[{id:1,title:'Тест',category:'Своя',desc:'backup',cards:[['picture-id','Не меняй термин',{id:'card-1',example:'picture-id',imageId:'picture-id',imageName:'pixel.png',audioId:'audio-id',audioName:'voice.wav'}]]}],categories:['Своя'],learned:7,answers:11,days:['2026-10-08'],daily:{'2026-10-08':{answers:11,correct:7}},reviews:{'card-1':{level:2,due:199990000,interval:3,lastReviewed:190000000}},settings:{goal:20,theme:'dark',accent:'blue',sounds:false},ranks:{xp:1200,streakBonus:5},customFutureState:{enabled:true} };

persistedData = sampleData;

test('CSV accepts BOM, quoted delimiters, escaped quotes, multiline, title/category/example and rejects malformed', async()=>{
  const file=new File(['\uFEFFterm;definition;example;category;title\r\n"keep; calm";"Спокойствие";"He said ""hello"".\nNext line.";"Моя категория";"Набор 1"\r\nword;слово;;Другое;Набор 2'], 'words.csv');
  const result=await parseImport(file);
  assert.equal(result.sets.length,2);assert.equal(result.sets[0].title,'Набор 1');assert.equal(result.sets[0].category,'Моя категория');assert.equal(result.sets[0].cards[0][0],'keep; calm');assert.equal(result.sets[0].cards[0][2].example,'He said "hello".\nNext line.');
  await assert.rejects(parseImport(new File(['word,"bad'], 'broken.csv')), /кавычк/);
  await assert.rejects(parseImport(new File([Uint8Array.of(255,254)],'bad.csv')), /UTF-8/);
});
test('Anki text directives skip structural columns and decode HTML', async()=>{
  const result=await parseImport(new File(['#separator:tab\n#html:true\n#guidcolumn:1\n#notetypecolumn:2\n#deckcolumn:3\n#tagscolumn:6\nguid\tBasic\tАнглийский\t<b>cat</b>\tкот &amp; кошка\ttag'], 'anki.txt'));
  assert.equal(result.sets[0].title,'Английский');assert.deepEqual(result.sets[0].cards[0],['cat','кот & кошка',{}]);
});
test('Removed APKG and ZIP imports reject with a Russian explanation', async()=>{
  for(const name of ['legacy.apkg','modern.colpkg','archive.zip']) await assert.rejects(parseImport(new File(['fake'],name)), /Импорт архивов Anki \(\.apkg\) удалён/);
  await assert.rejects(parseImport(new File([Uint8Array.of(0x50,0x4b,0x03,0x04)],'archive.txt')), /Экспортируй колоду из Anki/);
  await assert.rejects(parseImport(new File(['word\0definition'],'binary.txt')), /двоичный файл/);
});
test('Full backup restores unknown future data, progress, raw blob bytes; stages new IDs and rolls back without deleting originals', async()=>{
  const store=await dbRecords();
  await store.put({id:'picture-id',type:'image',name:'pixel.png',size:png.length,blob:new Blob([png],{type:'image/png'}),createdAt:1});
  await store.put({id:'audio-id',type:'audio',name:'voice.wav',size:wav.length,blob:new Blob([wav],{type:'audio/wav'}),createdAt:1});
  store.db.close();
  const blob=await createBackup(sampleData),snapshot=await inspectBackup(blob);
  assert.equal(snapshot.summary.cards,1);assert.equal(snapshot.summary.attachments,2);assert.equal(snapshot.summary.answers,11);
  const restored=await restoreBackup(snapshot);
  assert.deepEqual(restored.reviews,sampleData.reviews);assert.deepEqual(restored.daily,sampleData.daily);assert.deepEqual(restored.ranks,sampleData.ranks);assert.deepEqual(restored.customFutureState,sampleData.customFutureState);
  assert.equal(restored.sets[0].cards[0][0],'picture-id');assert.equal(restored.sets[0].cards[0][2].example,'picture-id');
  assert.notEqual(restored.sets[0].cards[0][2].imageId,'picture-id');
  let db=await dbRecords();let records=await db.all();db.db.close();assert.equal(records.length,4);
  assert.deepEqual(new Uint8Array(await records.find(record=>record.id===restored.sets[0].cards[0][2].audioId).blob.arrayBuffer()),wav);
  await discardStaged(restored);db=await dbRecords();records=await db.all();db.db.close();assert.deepEqual(records.map(record=>record.id).sort(),['audio-id','picture-id']);
  const committed=await restoreBackup(snapshot);assert.equal(await commitStaged(committed),true);await discardStaged(committed);db=await dbRecords();records=await db.all();assert.equal(records.length,2);assert.ok(!records.some(record=>record.id==='picture-id'||record.id==='audio-id'));db.db.close();persistedData=committed;
});
test('Invalid backup/reference/base64/prototype rejects before any storage writes', async()=>{
  const before=await dbRecords(), ids=(await before.all()).map(record=>record.id);before.db.close();
  const good=JSON.parse(await (await createBackup(persistedData)).text());
  for(const edit of [value=>value.version=999,value=>value.data.sets[0].cards[0][1]='',value=>value.attachments[0].base64='$$bad',value=>value.attachments.pop(),value=>value.data.sets[0].cards[0][2].id='']) {
    const copy=JSON.parse(JSON.stringify(good));edit(copy);await assert.rejects(inspectBackup(new Blob([JSON.stringify(copy)])));
    await assert.rejects(restoreBackup(copy));
  }
  await assert.rejects(inspectBackup(new Blob(['{"format":"zhekandus-backup","version":1,"data":{"__proto__":{"polluted":1}},"attachments":[]}'])), /недопустимые/);
  const after=await dbRecords();assert.deepEqual((await after.all()).map(record=>record.id),ids);after.db.close();assert.equal({}.polluted,undefined);
});

test('CSV multiline content resembling an Anki directive is preserved', async()=>{
  const result=await parseImport(new File(['term,definition,example\nword,слово,"Line one\n#deck: literal example text\nLast line"'],'words.csv'));
  assert.equal(result.sets[0].cards[0][2].example,'Line one\n#deck: literal example text\nLast line');
});
test('CSV export round-trips Russian decks, blank categories, aliases, quotes and multiline examples', async()=>{
  const data={sets:[
    {id:'set-1',title:'Первый, "набор"',category:'Моя; категория',cards:[
      ['keep; calm / stay calm','Сохраняй спокойствие / не паникуй',{id:'first',example:'He said "hello".\nNext line, then; again.'}],
      ['café','кафе',{id:'second',example:'#deck: this is literal example text'}]]},
    {id:'set-2',title:'Второй набор',category:'',cards:[['naïve','наивный',{id:'third'}]]}]};
  const blob=exportCSV(data);
  assert.equal(blob.type,'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0,3)],[0xef,0xbb,0xbf]);
  const exported=await parseImport(new File([blob],'zhekandus.csv'));
  assert.equal(exported.sets.length,2);assert.equal(exported.summary.cards,3);
  assert.deepEqual(exported.sets.map(set=>({title:set.title,category:set.category,cards:set.cards.map(card=>[card[0],card[1],card[2].example||''])})),data.sets.map(set=>({title:set.title,category:set.category,cards:set.cards.map(card=>[card[0],card[1],card[2]?.example||''])})));
  assert.ok(exported.sets.every(set=>!('color' in set)));assert.equal(exported.sets[1].category,'');
});
test('Unclassified CSV and Anki text do not invent a category', async()=>{
  for(const file of [new File(['term,definition\ncat,кот'],'words.csv'),new File(['#separator:tab\ncat\tкот'],'anki.txt')]) {
    const imported=await parseImport(file);assert.equal(imported.sets[0].category,'');assert.ok(!('color' in imported.sets[0]));
  }
});
test('Version 1 backups need no newly added fields and preserve optional state', async()=>{
  const plain={sets:[{id:'old',title:'Старый набор',cards:[['cat','кот']]}]};
  const snapshot=await inspectBackup(new Blob([JSON.stringify({format:'zhekandus-backup',version:1,data:plain,attachments:[]})]));
  assert.deepEqual(snapshot.data,plain);
  const copy=JSON.parse(JSON.stringify(persistedData));copy.settings.name='Анна';copy.lastStudySetId=copy.sets[0].id;copy.lastBackupAt=123456;
  copy.cardStats={'card-1':{answers:8,errors:2,optionalMetadata:{source:'future'}}};copy.createdAt=42;
  const future=await inspectBackup(await createBackup(copy));assert.equal(future.version,1);
  assert.equal(future.data.lastStudySetId,copy.sets[0].id);assert.equal(future.data.settings.name,'Анна');
  assert.equal(future.data.cardStats['card-1'].answers,8);assert.equal(future.data.cardStats['card-1'].errors,2);assert.deepEqual(future.data.cardStats['card-1'].optionalMetadata,{source:'future'});assert.equal(future.data.lastBackupAt,123456);assert.equal(future.data.createdAt,42);
  const unrestricted=structuredClone(future);unrestricted.data.createdAt={futureSchema:'kept'};const accepted=await inspectBackup(new Blob([JSON.stringify(unrestricted)]));assert.deepEqual(accepted.data.createdAt,{futureSchema:'kept'});
});
test('Quota failure rolls back staged blobs and preserves existing data and attachments', async()=>{
  const snapshot=await inspectBackup(await createBackup(persistedData));
  const before=await dbRecords();const initial=(await before.all()).map(record=>record.id).sort();before.db.close();
  const previous=JSON.stringify(persistedData),originalAdd=IDBObjectStore.prototype.add;
  let additions=0;
  IDBObjectStore.prototype.add=function(...args){if(this.name==='attachments'&&++additions===2)throw new DOMException('No room','QuotaExceededError');return originalAdd.apply(this,args);};
  try {await assert.rejects(restoreBackup(snapshot),/Не хватает места.*Старые данные сохранены/);}
  finally {IDBObjectStore.prototype.add=originalAdd;}
  const after=await dbRecords();assert.deepEqual((await after.all()).map(record=>record.id).sort(),initial);after.db.close();assert.equal(JSON.stringify(persistedData),previous);
});
test('Plain-text import retains existing attachments while repeated restore frees superseded blobs', async()=>{
  const backup=await inspectBackup(await createBackup(persistedData));
  for(let index=0;index<3;index++) {
    const restored=await restoreBackup(backup);await commitStaged(restored);persistedData=restored;
    const db=await dbRecords();assert.equal((await db.all()).length,2);db.db.close();
  }
  const original=await dbRecords();const ids=(await original.all()).map(record=>record.id).sort();original.db.close();
  const imported=await stageImport(await parseImport(new File(['term,definition\ncat,кот'],'words.csv')));await commitStaged(imported);
  const db=await dbRecords();assert.deepEqual((await db.all()).map(record=>record.id).sort(),ids);db.db.close();
});

test('Malformed optional statistics, last-study identity and timestamps reject without changing stored blobs', async()=>{
  const valid=JSON.parse(await (await createBackup(persistedData)).text());
  const before=await dbRecords();const ids=(await before.all()).map(record=>record.id).sort();before.db.close();
  for(const edit of [
    value=>value.data.cardStats=[],value=>value.data.cardStats={broken:null},
    value=>value.data.cardStats={broken:{answers:1,errors:2}},value=>value.data.cardStats={broken:{answers:1.5,errors:0}},
    value=>value.data.cardStats={broken:{answers:1,errors:-1}},value=>value.data.cardStats={broken:{answers:'2',errors:1}},
    value=>value.data.lastStudySetId={},value=>value.data.lastStudySetId=null,
    value=>value.data.lastBackupAt=-1,value=>value.data.lastBackupAt='2026-10-08',
  ]) {
    const copy=structuredClone(valid);edit(copy);
    await assert.rejects(inspectBackup(new Blob([JSON.stringify(copy)])));
    await assert.rejects(restoreBackup(copy));
  }
  for(const key of ['lastBackupAt'])for(const number of [NaN,Infinity]) {
    const copy=structuredClone(valid);copy.data[key]=number;await assert.rejects(restoreBackup(copy));
  }
  const after=await dbRecords();assert.deepEqual((await after.all()).map(record=>record.id).sort(),ids);after.db.close();
  for(const id of [123,'set-id']) {
    const copy=structuredClone(valid);copy.data.lastStudySetId=id;copy.data.lastBackupAt=0;copy.data.createdAt=0;copy.data.cardStats={};
    const inspected=await inspectBackup(new Blob([JSON.stringify(copy)]));assert.equal(inspected.data.lastStudySetId,id);
  }
});
test('Media schema upgrades v1 to shared v2 without losing attachments or overwriting the state store', async()=>{
  const fresh=new IDBFactory(),previous=globalThis.indexedDB;globalThis.indexedDB=fresh;
  try {
    const legacy=await new Promise((resolve,reject)=>{const request=fresh.open('zhekandus-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('attachments',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=legacy.transaction('attachments','readwrite');tx.objectStore('attachments').put({id:'legacy-image',type:'image',name:'pixel.png',blob:new Blob([png],{type:'image/png'})});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});legacy.close();
    const data={sets:[{id:'old',title:'Старый набор',cards:[['cat','кот',{imageId:'legacy-image'}]]}]};
    const backup=await inspectBackup(await createBackup(data));assert.equal(backup.attachments.length,1);
    const store=await dbRecords();assert.equal(store.db.version,2);assert.deepEqual([...store.db.objectStoreNames],['attachments','state']);
    await new Promise((resolve,reject)=>{const tx=store.db.transaction('state','readwrite');tx.objectStore('state').put({keep:'application-state'},'main');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});store.db.close();
    const restored=await restoreBackup(backup);await commitStaged(restored);
    const current=await dbRecords();assert.equal((await current.all()).length,1);
    const state=await new Promise((resolve,reject)=>{const request=current.db.transaction('state','readonly').objectStore('state').get('main');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    assert.deepEqual(state,{keep:'application-state'});current.db.close();
  }finally {globalThis.indexedDB=previous;}
});
