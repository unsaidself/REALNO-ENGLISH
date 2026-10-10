import test from 'node:test';
import assert from 'node:assert/strict';
import { limitedNewCards, introduceCard } from '../src/learning-plan.js';
const now = new Date(2026,9,10,12);
const cards = Array.from({length:6},(_,n)=>['Term '+n,'Definition '+n,{id:'c'+n}]);
test('daily limit keeps existing reviews, reserves only available unseen places and counts displayed cards once',()=>{
 const data={reviews:{c0:{level:1}},settings:{newCardsPerDay:2}};
 assert.deepEqual(limitedNewCards(data,cards,now).map(c=>c[2].id),['c0','c1','c2']);
 assert.equal(introduceCard(data,cards[1],now),true);assert.equal(introduceCard(data,cards[1],now),false);
 assert.deepEqual(limitedNewCards(data,cards,now).map(c=>c[2].id),['c0','c1','c2']);
 introduceCard(data,cards[2],now);assert.deepEqual(limitedNewCards(data,cards,now).map(c=>c[2].id),['c0','c1','c2']);
 const tomorrow=new Date(2026,9,11,12);assert.deepEqual(limitedNewCards(data,cards,tomorrow).map(c=>c[2].id),['c0','c1','c2']);
 data.settings.newCardsPerDay=0;assert.deepEqual(limitedNewCards(data,cards,tomorrow).map(c=>c[2].id),['c0']);
});
