import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePracticeData, scheduleReview, getDueCards, recordDaily, dailyProgress, activityCalendar, studyStreak, localDay, reclassifyAnswer, recordCardAnswer, getWeakCards, learnedCardCount } from '../src/practice.js';

const DAY = 86_400_000;
const started = Date.UTC(2026, 9, 7, 12);
function fixture() {
  const data = { sets: [{ id: 1, cards: [['remember', 'помнить']] }] };
  ensurePracticeData(data);
  return { data, card: data.sets[0].cards[0] };
}

test('correct drills before a scheduled review preserve its due date across calendar days', () => {
  const { data, card } = fixture();
  scheduleReview(data, card, true, started);
  const scheduled = scheduleReview(data, card, true, started + DAY);
  assert.equal(scheduled.interval, 3);
  assert.equal(scheduled.due, started + 4 * DAY);
  for (const now of [started + 2 * DAY, started + 3 * DAY, scheduled.due - 1]) {
    scheduleReview(data, card, true, now);
    assert.equal(data.reviews[card[2].id].due, scheduled.due);
    assert.equal(data.reviews[card[2].id].interval, 3);
    assert.equal(getDueCards(data, 1, now).length, 0);
  }
  assert.equal(getDueCards(data, 1, scheduled.due).length, 1);
  const next = scheduleReview(data, card, true, scheduled.due);
  assert.equal(next.interval, 7);
  assert.equal(next.due, scheduled.due + 7 * DAY);
});

test('a mistake during an early drill schedules a retry; correcting it restarts the interval', () => {
  const { data, card } = fixture();
  scheduleReview(data, card, true, started);
  const failed = scheduleReview(data, card, false, started + 1_000);
  assert.equal(failed.level, 0);
  assert.equal(failed.due, started + 601_000);
  const corrected = scheduleReview(data, card, true, started + 2_000);
  assert.equal(corrected.interval, 1);
  assert.equal(corrected.due, started + 2_000 + DAY);
});

test('explicit grades preserve, advance, or retreat the level even before a due date', () => {
  const { data, card } = fixture();
  const hard = scheduleReview(data, card, 'hard', started);
  assert.equal(hard.level, 0);
  assert.equal(hard.interval, 1);
  assert.equal(hard.due, started + DAY);
  const good = scheduleReview(data, card, 'good', started + 1_000);
  assert.equal(good.level, 1);
  const easy = scheduleReview(data, card, 'easy', started + 2_000);
  assert.equal(easy.level, 3);
  assert.equal(easy.interval, 7);
  assert.equal(easy.due, started + 2_000 + 7 * DAY);
  const stayed = scheduleReview(data, card, 'hard', started + 3_000);
  assert.equal(stayed.level, 3);
  assert.equal(stayed.interval, 7);
  const retry = scheduleReview(data, card, 'again', started + 4_000);
  assert.equal(retry.level, 1);
  assert.equal(retry.due, started + 604_000);
});

test('a lapse keeps earlier progress and an automatic correction can recover before the retry', () => {
  const { data, card } = fixture();
  for (let i = 0; i < 4; i++) scheduleReview(data, card, 'good', started + i);
  const retry = scheduleReview(data, card, false, started + 1_000);
  assert.equal(retry.level, 2);
  assert.equal(retry.interval, 10 / (24 * 60));
  const recovered = scheduleReview(data, card, true, started + 2_000);
  assert.equal(recovered.level, 3);
  assert.equal(recovered.due, started + 2_000 + 7 * DAY);
  assert.equal(scheduleReview(data, card, true, started + 3_000), recovered);
});

test('review levels are capped and repeated lapses cannot become negative', () => {
  const { data, card } = fixture();
  for (let i = 0; i < 5; i++) scheduleReview(data, card, 'easy', started + i);
  assert.equal(data.reviews[card[2].id].level, 6);
  assert.equal(data.reviews[card[2].id].interval, 90);
  assert.equal(scheduleReview(data, card, 'good', started + 6).level, 6);
  assert.equal(scheduleReview(data, card, 'hard', started + 7).level, 6);
  for (let i = 0; i < 5; i++) scheduleReview(data, card, 'again', started + 10 + i);
  assert.equal(data.reviews[card[2].id].level, 0);
  assert.throws(() => scheduleReview(data, card, 'unknown', started), /grade/);
});

test('runtime helpers preserve card metadata objects and legacy identities are upgraded once', () => {
  const { data, card } = fixture();
  const metadata = card[2];
  metadata.imageId = 'saved-picture';
  scheduleReview(data, card, 'good', started);
  recordDaily(data, true, started);
  dailyProgress(data, started);
  activityCalendar(data, 2026, 9);
  studyStreak(data, started);
  getDueCards(data, null, started);
  assert.equal(card[2], metadata);
  assert.equal(metadata.imageId, 'saved-picture');

  const old = { sets: [{ id: 2, cards: [['word', 'слово']] }] };
  assert.equal(getDueCards(old, 2, started).length, 1);
  const oldCard = old.sets[0].cards[0];
  const upgraded = oldCard[2];
  assert.ok(upgraded.id);
  scheduleReview(old, oldCard, true, started);
  assert.equal(oldCard[2], upgraded);
  assert.equal(getDueCards(old, 2, started).length, 0);
});

test('reclassifying a wrong answer preserves attempts and restores its original review and activity day', () => {
  const { data, card } = fixture();
  const id = card[2].id;
  const prior = scheduleReview(data, card, 'easy', started);
  const receipt = { reviewBefore: { ...prior }, now: started + 1_000 };
  data.answers = 1;
  data.cardStats = { [id]: { answers: 1, errors: 1, future: 'preserved' } };
  recordDaily(data, false, receipt.now);
  scheduleReview(data, card, false, receipt.now);
  assert.equal(data.reviews[id].level, 0);
  reclassifyAnswer(data, card, receipt);
  assert.equal(data.answers, 1);
  assert.equal(data.learned, 1);
  assert.deepEqual(data.reviews[id], prior);
  assert.deepEqual(data.daily[localDay(receipt.now)], { answers: 1, correct: 1 });
  assert.deepEqual(data.cardStats[id], { answers: 1, errors: 0, future: 'preserved' });
  assert.throws(() => reclassifyAnswer(data, card, receipt), /incorrect answer/);
});

test('correcting an unseen card creates a good review without inventing per-card counters', () => {
  const { data, card } = fixture();
  data.answers = 1;
  recordDaily(data, false, started);
  scheduleReview(data, card, false, started);
  const review = reclassifyAnswer(data, card, { now: started });
  assert.equal(review.level, 1);
  assert.equal(review.due, started + DAY);
  assert.equal(data.answers, 1);
  assert.equal(data.learned, 1);
  assert.equal(data.cardStats, undefined);
});
test('per-card attempts count successes and errors and correct reclassification removes one error', () => {
  const { data, card } = fixture();
  const id = card[2].id;
  assert.deepEqual(recordCardAnswer(data, card, true), { answers: 1, errors: 0 });
  assert.deepEqual(recordCardAnswer(data, card, false), { answers: 2, errors: 1 });
  data.answers = 2; data.learned = 1;
  recordDaily(data, true, started); recordDaily(data, false, started);
  scheduleReview(data, card, false, started);
  reclassifyAnswer(data, card, { now: started });
  assert.deepEqual(data.cardStats[id], { answers: 2, errors: 0 });
  assert.equal(data.answers, 2);
  assert.equal(data.learned, 2);
});

test('weak cards sort by observed accuracy, excluding unseen and removed cards', () => {
  const data = { sets: [{ id: 'deck', cards: [['high', 'a'], ['low', 'b'], ['middle', 'c'], ['unseen', 'd'], ['equal-low', 'e']] }] };
  ensurePracticeData(data);
  const [high, low, middle, unseen, equalLow] = data.sets[0].cards;
  data.cardStats = {
    [high[2].id]: { answers: 10, errors: 1 },
    [low[2].id]: { answers: 4, errors: 4 },
    [middle[2].id]: { answers: 2, errors: 1 },
    [equalLow[2].id]: { answers: 2, errors: 2 },
    orphan: { answers: 10, errors: 10 },
  };
  assert.deepEqual(getWeakCards(data, 'deck').map(entry => entry.card), [low, equalLow, middle, high]);
  assert.equal(getWeakCards(data, 'missing').length, 0);
  assert.equal(getWeakCards(data).some(entry => entry.card === unseen), false);
  assert.equal(getWeakCards({ sets: data.sets }).length, 0);
});

test('learned cards depend on current level and exclude orphan reviews', () => {
  const data = { sets: [{ id: 1, cards: [['a', 'a'], ['b', 'b'], ['c', 'c']] }] };
  ensurePracticeData(data);
  const [a, b, c] = data.sets[0].cards;
  for (let i = 0; i < 4; i++) scheduleReview(data, a, 'good', started + i);
  for (let i = 0; i < 3; i++) scheduleReview(data, b, 'good', started + i);
  for (let i = 0; i < 3; i++) scheduleReview(data, c, 'easy', started + i);
  data.reviews.orphan = { level: 6, due: started, interval: 90, lastReviewed: started };
  assert.equal(learnedCardCount(data), 2);
  scheduleReview(data, a, 'again', started + 10);
  assert.equal(learnedCardCount(data), 1);
  data.sets[0].cards.pop();
  assert.equal(learnedCardCount(data), 0);
});

test('hostile card identities cannot write object prototypes through per-card stats', () => {
  const data = { sets: [] }, card = ['x', 'y', { id: '__proto__' }];
  recordCardAnswer(data, card, false);
  assert.equal(Object.prototype.errors, undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptor(data.cardStats, '__proto__').value, { answers: 1, errors: 1 });
});

test('practice upgrades normalize only existing per-card histories and keep optional future fields', () => {
  const { data, card } = fixture();
  assert.equal(data.cardStats, undefined);
  const id = card[2].id;
  data.cardStats = { [id]: { answers: '5.9', errors: 12, future: { note: 'kept' } }, malformed: null };
  ensurePracticeData(data);
  assert.deepEqual(data.cardStats[id], { answers: 5, errors: 5, future: { note: 'kept' } });
  assert.deepEqual(data.cardStats.malformed, { answers: 0, errors: 0 });
  const existingStats = data.cardStats[id];
  dailyProgress(data, started);
  getDueCards(data, null, started);
  assert.equal(data.cardStats[id], existingStats);
});
