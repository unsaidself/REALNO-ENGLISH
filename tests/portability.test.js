import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { zstdCompressSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { indexedDB } from 'fake-indexeddb';
import { createBackup, inspectBackup, restoreBackup, parseImport, stageImport, discardStaged, commitStaged } from '../src/portability.js';

globalThis.indexedDB = indexedDB;
const SQL = await initSqlJs();
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode('RIFF')); wav.set(new TextEncoder().encode('WAVEfmt '), 8);
const view = new DataView(wav.buffer); view.setUint32(4,40,true); view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);wav.set(new TextEncoder().encode('data'),36);view.setUint32(40,4,true);

function sqliteFixture(modern = false, cloze = false) {
  const db = new SQL.Database();
  db.run('CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT); CREATE TABLE cards (nid INTEGER, did INTEGER, ord INTEGER);');
  if (modern) {
    db.run('CREATE TABLE decks (id INTEGER, name TEXT); CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT);');
    db.run('INSERT INTO decks VALUES (?, ?)', [1, 'Travel\x1fAirport']);
    db.run('INSERT INTO fields VALUES (?,?,?), (?,?,?), (?,?,?)', [100,0,'Front',100,1,'Back',100,2,'Example']);
  } else {
    db.run('CREATE TABLE col (decks TEXT, models TEXT)');
    db.run('INSERT INTO col VALUES (?, ?)', [JSON.stringify({1:{id:1,name:'Travel::Airport'}}), JSON.stringify({100:{id:100,flds:[{name:'Front'},{name:'Back'},{name:'Example'}]}})]);
  }
  db.run('INSERT INTO notes VALUES (?, ?, ?)', [1001,100,'<b>Boarding pass</b><img src="card.png">[sound:card.wav]\x1fПосадочный талон\x1fShow your boarding pass.']);
  db.run('INSERT INTO notes VALUES (?, ?, ?)', [1002,100,'Take your time\x1fНе торопись\x1fTake your time.']);
  // Two templates for one note should become one useful vocabulary card.
  db.run('INSERT INTO cards VALUES (?,?,?), (?,?,?), (?,?,?)', [1001,1,0,1001,1,1,1002,1,0]);
  if (cloze) {
    db.run('INSERT INTO notes VALUES (?, ?, ?)', [1003,100,'{{c1::Paris::город}} is the capital of {{c2::France::страна}}.\x1f\x1f']);
    db.run('INSERT INTO cards VALUES (?,?,?), (?,?,?)',[1003,1,0,1003,1,1]);
  }
  const bytes = db.export(); db.close(); return bytes;
}
function varint(number) { const result=[];do {const byte=number%128;number=Math.floor(number/128);result.push(byte|(number?128:0));} while(number);return Uint8Array.from(result); }
function concat(...parts) {const out=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}
function protobufManifest() {
  return concat(...[['card.png',png],['card.wav',wav]].map(([name,bytes])=>{
    const encoded=strToU8(name), entry=concat(Uint8Array.of(10),varint(encoded.length),encoded,Uint8Array.of(16),varint(bytes.length),Uint8Array.of(26,20),new Uint8Array(20));
    return concat(Uint8Array.of(10),varint(entry.length),entry);
  }));
}
export function apkgFixture(modern = false, cloze = false) {
  const content = modern ? {
    'collection.anki21b':new Uint8Array(zstdCompressSync(sqliteFixture(true, cloze))),
    media:new Uint8Array(zstdCompressSync(protobufManifest())),
    '0':new Uint8Array(zstdCompressSync(png)), '1':new Uint8Array(zstdCompressSync(wav)),
    meta:Uint8Array.of(8,3),
  } : {'collection.anki2':sqliteFixture(false, cloze),media:strToU8(JSON.stringify({'0':'card.png','1':'card.wav'})),'0':png,'1':wav};
  return new File([zipSync(content)], modern?'modern.apkg':'legacy.apkg');
}
async function dbRecords() {
  const db = await new Promise((resolve,reject)=>{const request=indexedDB.open('zhekandus-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('attachments',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
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
for(const modern of [false,true]) test(`${modern?'Modern zstd/protobuf':'Legacy JSON'} APKG SQLite cards and image/audio import`, async()=>{
  const result=await parseImport(apkgFixture(modern));
  assert.equal(result.summary.cards,2);assert.equal(result.summary.attachments,2);assert.equal(result.sets[0].title,'Travel / Airport');
  assert.deepEqual(result.sets[0].cards[0].slice(0,2),['Boarding pass','Посадочный талон']);assert.equal(result.sets[0].cards[0][2].example,'Show your boarding pass.');
  assert.deepEqual(new Uint8Array(await result.attachments.find(record=>record.type==='image').blob.arrayBuffer()),png);
  const sets=await stageImport(result);const mediaId=sets[0].cards[0][2].imageId;
  assert.notEqual(mediaId,result.sets[0].cards[0][2].imageId);
  const store=await dbRecords();assert.ok((await store.all()).some(record=>record.id===mediaId));store.db.close();
  await discardStaged(sets);const after=await dbRecords();assert.ok(!(await after.all()).some(record=>record.id===mediaId));after.db.close();
});
test('Bad ZIP and bad SQLite files reject clearly', async()=>{
  await assert.rejects(parseImport(new File(['fake'],'fake.apkg')), /Anki/);
  await assert.rejects(parseImport(new File([zipSync({'collection.anki2':strToU8('bad'),'media':strToU8('{}')})],'bad.apkg')), /база Anki/);
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

test('Cloze APKG preserves every deletion as an answer with its hint and completed example', async()=>{
  const result=await parseImport(apkgFixture(true,true));
  assert.equal(result.summary.cards,4);
  assert.deepEqual(result.sets[0].cards.slice(2).map(card=>card.slice(0,2)),[['Paris','город'],['France','страна']]);
  assert.ok(result.warnings.some(message=>message.includes('Cloze')));
  assert.equal(result.sets[0].cards[2][2].example,'Paris is the capital of France.');
});
test('CSV multiline content resembling an Anki directive is preserved', async()=>{
  const result=await parseImport(new File(['term,definition,example\nword,слово,"Line one\n#deck: literal example text\nLast line"'],'words.csv'));
  assert.equal(result.sets[0].cards[0][2].example,'Line one\n#deck: literal example text\nLast line');
});
test('Import commit retains existing attachments while repeated restore frees superseded blobs', async()=>{
  const backup=await inspectBackup(await createBackup(persistedData));
  for(let index=0;index<3;index++) {
    const restored=await restoreBackup(backup);await commitStaged(restored);persistedData=restored;
    const db=await dbRecords();assert.equal((await db.all()).length,2);db.db.close();
  }
  const imported=await stageImport(await parseImport(apkgFixture()));await commitStaged(imported);
  const db=await dbRecords();assert.equal((await db.all()).length,4);db.db.close();
});
