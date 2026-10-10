import test from 'node:test';
import assert from 'node:assert/strict';
import { exportAnki, parseImport } from '../src/portability.js';
test('Anki text export is compatible with text import and preserves literal HTML, source fields, examples and multiline text',async()=>{
 const data={sets:[{id:'s',title:'Мой сериал',cards:[["Hold <the> door\nnow","Держи & дверь",{id:'c',example:'Hold the door now.',film:'Фильм',episode:'S1E2',timecode:'00:12:34',starred:true}]]}]};
 const blob=exportAnki(data);const file=new File([blob],'anki.txt',{type:'text/plain'});const restored=await parseImport(file);
 assert.equal(restored.sets[0].title,'Мой сериал');assert.equal(restored.sets[0].cards[0][0],data.sets[0].cards[0][0]);assert.equal(restored.sets[0].cards[0][1],data.sets[0].cards[0][1]);
 assert.equal(restored.sets[0].cards[0][2].film,'Фильм');assert.equal(restored.sets[0].cards[0][2].timecode,'00:12:34');
 assert.match(await blob.text(),/zhekandus_hard/);
});
