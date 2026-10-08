import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCatalog, ensureRankData, rankProgress, awardRankXP, DAILY_CARD_REWARDS } from '../src/ranks.js';
import { localDay } from '../src/practice.js';

const now = new Date(2026, 9, 8, 12).getTime();
const card = id => ['remember', 'помнить', { id }];

test('old correct answers become experience once and survive repeated migration', () => {
  const data = { learned: 80, sets: [] };
  ensureRankData(data);
  assert.equal(data.rank.xp, 800);
  assert.equal(rankProgress(data).name, 'Золото');
  data.learned += 200;
  ensureRankData(data);
  assert.equal(data.rank.xp, 800);
  const restored = JSON.parse(JSON.stringify(data));
  assert.equal(rankProgress(restored).xp, 800);
  assert.deepEqual(data.sets, []);
});

test('incorrect answers give zero XP and never demote the current rank', () => {
  const data = { learned: 75 };
  const answer = awardRankXP(data, card('a'), false, 'test', now);
  assert.equal(answer.awarded, 0);
  assert.equal(answer.current.name, 'Золото');
  assert.equal(answer.current.xp, 750);
  assert.equal(answer.leveledUp, false);
  assert.deepEqual(data.rank.daily, {});
});

test('a shared cap prevents the same card earning unlimited XP in different modes', () => {
  const data = {};
  const modes = ['test', 'learn', 'match', 'cloze', 'listening'];
  for (let i = 0; i < modes.length; i++) {
    const answer = awardRankXP(data, card('a'), true, modes[i], now);
    assert.equal(answer.awarded, i < DAILY_CARD_REWARDS ? 10 : 0);
    assert.equal(answer.capped, i >= DAILY_CARD_REWARDS);
  }
  assert.equal(data.rank.xp, 30);
  const restored = JSON.parse(JSON.stringify(data));
  assert.equal(awardRankXP(restored, card('a'), true, 'listening', now).capped, true);
  assert.equal(awardRankXP(restored, card('b'), true, 'test', now).awarded, 10);
});

test('the cap resets on a local calendar day without resetting rank experience', () => {
  const data = {};
  for (let i = 0; i < 3; i++) awardRankXP(data, card('a'), true, 'test', now);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(awardRankXP(data, card('a'), true, 'review', tomorrow).awarded, 10);
  assert.equal(data.rank.xp, 40);
  assert.equal(data.rank.daily[localDay(now)]['id:a'], 3);
  assert.equal(data.rank.daily[localDay(tomorrow)]['id:a'], 1);
});

test('rank thresholds, next-rank progress and final-rank values are explicit', () => {
  for (const tier of rankCatalog) {
    const data = { rank: { xp: tier.xp } };
    const progress = rankProgress(data);
    assert.equal(progress.level, tier.level);
    assert.equal(progress.id, tier.id);
    assert.equal(progress.earned, 0);
    if (tier.level < rankCatalog.length) {
      assert.equal(progress.progress, 0);
      assert.equal(progress.nextXP, rankCatalog[tier.level].xp);
    } else {
      assert.equal(progress.progress, 100);
      assert.equal(progress.nextXP, null);
      assert.equal(progress.nextName, null);
      assert.equal(progress.remaining, 0);
    }
  }
  const data = { rank: { xp: 240, daily: {} } };
  const answer = awardRankXP(data, card('fresh'), true, 'listening', now);
  assert.equal(answer.leveledUp, true);
  assert.equal(answer.previous.name, 'Бронза');
  assert.equal(answer.current.name, 'Серебро');
  assert.deepEqual(answer.unlocked.map(tier => tier.id), ['silver']);
  assert.equal(rankProgress({ rank: { xp: 500 } }).progress, 50);
});

test('malformed rank values and hostile card IDs do not corrupt object prototypes', () => {
  const data = { rank: { xp: -200, daily: [] } };
  ensureRankData(data);
  assert.equal(data.rank.xp, 0);
  assert.deepEqual(data.rank.daily, {});
  awardRankXP(data, card('__proto__'), true, 'test', now);
  assert.equal(data.rank.xp, 10);
  assert.equal(Object.getPrototypeOf(data.rank.daily[localDay(now)]), Object.prototype);
  assert.equal(data.rank.daily[localDay(now)]['id:__proto__'], 1);
  assert.equal(awardRankXP(data, null, true, 'test', now).awarded, 0);
  assert.equal(awardRankXP(data, ['', 'blank'], true, 'test', now).awarded, 0);
});
