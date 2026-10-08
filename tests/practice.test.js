import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePracticeData, scheduleReview, getDueCards } from '../src/practice.js';

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
