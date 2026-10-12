import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, createStudyQueue } from '../src/study-order.js';
import { getDueCards, getWeakCards, localDay } from '../src/practice.js';
import { buildCloze } from '../src/exercises.js';

const now = new Date(2026, 9, 12, 12);
const cards = Array.from({ length: 6 }, (_, index) => Object.freeze([
  `Term ${index}`, `Значение ${index}`, Object.freeze({ id: `c${index}`, example: `Remember Term ${index} today.` }),
]));
const ids = queue => queue.map(card => card[2].id);

test('shuffle can reach all six three-card orders without changing source cards or IDs', () => {
  const source = Object.freeze(cards.slice(0, 3)), orders = new Set();
  for (const last of [0, 0.34, 0.99]) for (const second of [0, 0.99]) {
    const draws = [last, second], result = shuffle(source, () => draws.shift());
    orders.add(ids(result).join(','));
    assert.deepEqual([...result].sort((a, b) => a[2].id.localeCompare(b[2].id)), source);
    assert.ok(result.every(card => source.includes(card)));
    assert.deepEqual(ids(source), ['c0', 'c1', 'c2']);
  }
  assert.equal(orders.size, 6);
});

test('daily cap chooses unseen cards after shuffle, keeping known and already introduced cards', () => {
  const data = { sets: [], reviews: { c0: { level: 2 } }, settings: { newCardsPerDay: 2 }, newCardDay: { day: localDay(now), ids: ['c1'] } };
  const before = structuredClone(data), queue = createStudyQueue(data, cards, now, () => 0);
  assert.deepEqual(ids(queue), ['c1', 'c2', 'c0']);
  assert.deepEqual(data, before);
  data.settings.newCardsPerDay = 0;
  assert.deepEqual(ids(createStudyQueue(data, cards, now, () => 0)), ['c1', 'c0']);
});

test('every new queue consumes fresh random choices instead of reusing a previous session', () => {
  const data = { reviews: {}, settings: { newCardsPerDay: 100 } }, source = Object.freeze([...cards]);
  const first = createStudyQueue(data, source, now, () => 0);
  const second = createStudyQueue(data, source, now, () => 0.99);
  assert.notDeepEqual(ids(first), ids(second));
  assert.deepEqual(new Set(first), new Set(second));
  first.pop();
  assert.equal(source.length, 6);
  assert.equal(second.length, 6);
});

test('random review and weak queues preserve eligibility, future due dates and accuracy selection', () => {
  const data = { sets: [{ id: 'mine', cards }], reviews: Object.fromEntries(cards.map((card, index) => [card[2].id, { level: 2, due: now.getTime() + (index === 5 ? 100000 : -100000) }])), cardStats: Object.fromEntries(cards.map((card, index) => [card[2].id, { answers: 10, errors: 6 - index }])), settings: { newCardsPerDay: 100 } };
  const before = structuredClone(data), due = getDueCards(data, 'mine', now.getTime()).map(entry => entry.card), weak = getWeakCards(data, 'mine').slice(0, 3).map(entry => entry.card);
  const reviewQueue = createStudyQueue(data, due, now, () => 0);
  assert.notDeepEqual(ids(reviewQueue), ids(due));
  assert.deepEqual(new Set(reviewQueue), new Set(due));
  assert.ok(!ids(reviewQueue).includes('c5'));
  assert.deepEqual(ids(createStudyQueue(data, weak, now, () => 0)), ['c1', 'c2', 'c0']);
  assert.deepEqual(data.reviews, before.reviews);
  assert.deepEqual(data.cardStats, before.cardStats);
});

test('cloze eligibility is applied before the new-card cap and empty/single queues remain usable', () => {
  const data = { reviews: {}, settings: { newCardsPerDay: 1 } }, source = [['No example', 'Без примера', { id: 'no-example' }], ...cards];
  const eligible = source.filter(card => buildCloze(card));
  assert.deepEqual(ids(createStudyQueue(data, eligible, now, () => 0)), ['c1']);
  assert.deepEqual(createStudyQueue(data, [], now), []);
  assert.deepEqual(createStudyQueue(data, [cards[0]], now), [cards[0]]);
});
