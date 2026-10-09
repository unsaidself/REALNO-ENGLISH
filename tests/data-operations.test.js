import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSet, resetSetProgress, resetAllProgress, rememberStudySet, lastStudySet, attachmentReferences, collectUnreferencedAttachments, attachmentGarbage } from '../src/data-operations.js';
import { ensureRankData, awardRankXP, rankProgress } from '../src/ranks.js';
import { ensurePracticeData, getDueCards } from '../src/practice.js';

function fixture() {
  return {
    sets: [
      { id: 1, title: 'Набор 1', category: 'Моя', cards: [
        ['one', 'один', { id: 'a-1', imageId: 'private-image', audioId: 'shared-audio', example: 'One example.' }],
        ['two', 'два', { id: 'a-2', imageId: 'future-image' }],
      ] },
      { id: '2', title: 'Набор 2', cards: [['three', 'три', { id: 'b-1', audioId: 'shared-audio', imageId: 'other-image' }]] },
    ],
    lastStudySetId: 1,
    answers: 23, learned: 19, days: ['2026-10-08'], daily: { '2026-10-08': { answers: 23, correct: 19 } },
    reviews: { 'a-1': { level: 5, due: 10 }, 'a-2': { level: 3, due: 20 }, 'b-1': { level: 4, due: 30 }, orphan: { level: 2, due: 40 } },
    cardStats: { 'a-1': { answers: 10, errors: 2 }, 'a-2': { answers: 4, errors: 1 }, 'b-1': { answers: 9, errors: 1 }, orphan: { answers: 3, errors: 0 } },
    settings: { name: 'Ученик', theme: 'dark', sounds: false, goal: 50 }, categories: ['Моя'],
    rank: { version: 1, xp: 190, daily: { '2026-10-08': { 'id:a-1': 3, 'id:b-1': 2 } }, optionalFutureRank: true },
    futureState: { recording: { referenceAudioId: 'future-image', recordingId: 'other-recording' }, nested: { value: true } },
    lastBackupAt: 123456,
  };
}

function freezeDeep(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeDeep(child); Object.freeze(value); }
  return value;
}

test('delete plans preserve shared/future-reference blobs, other card history, and historical XP', () => {
  const input = freezeDeep(fixture());
  const before = JSON.stringify(input), result = deleteSet(input, '1');
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.data.sets.length, 1);
  assert.equal(result.data.sets[0], input.sets[1]);
  assert.deepEqual(result.removedCardIds, ['a-1', 'a-2']);
  assert.deepEqual(result.removeAttachmentIds, ['private-image']);
  assert.deepEqual(Object.keys(result.data.reviews), ['b-1', 'orphan']);
  assert.deepEqual(Object.keys(result.data.cardStats), ['b-1', 'orphan']);
  assert.equal(result.data.answers, 23); assert.equal(result.data.learned, 19);
  assert.equal(result.data.rank, input.rank);
  assert.equal(result.data.daily, input.daily); assert.equal(result.data.days, input.days);
  assert.equal(result.data.settings, input.settings); assert.equal(result.data.futureState, input.futureState);
  assert.equal(Object.hasOwn(result.data, 'lastStudySetId'), false);
  assert.equal(lastStudySet(result.data), null);
});

test('deleting a different set preserves the last studied ID and never mutates removed card metadata', () => {
  const input = freezeDeep(fixture()), result = deleteSet(input, 2);
  assert.equal(result.data.lastStudySetId, 1);
  assert.deepEqual(result.removeAttachmentIds, ['other-image']);
  assert.equal(lastStudySet(result.data), input.sets[0]);
  assert.equal(input.sets[1].cards[0][2].audioId, 'shared-audio');
});

test('set reset clears exactly its schedule and accuracy, keeping global statistics and files', () => {
  const input = freezeDeep(fixture()), output = resetSetProgress(input, 1);
  assert.deepEqual(Object.keys(output.reviews), ['b-1', 'orphan']);
  assert.deepEqual(Object.keys(output.cardStats), ['b-1', 'orphan']);
  for (const key of ['sets', 'rank', 'days', 'daily', 'settings', 'futureState', 'categories']) assert.equal(output[key], input[key]);
  assert.equal(output.answers, 23); assert.equal(output.learned, 19); assert.equal(output.lastStudySetId, 1);
  assert.deepEqual(attachmentGarbage(input, output), []);
  // The real practice implementation treats these removed schedules as unseen.
  const runtime = structuredClone(output);
  assert.equal(getDueCards(runtime, 1, 1).length, 2);
  assert.equal(getDueCards(runtime, 2, 1).length, 0);
});

test('full reset restarts XP/caps and activity, while retaining settings, media and optional fields', () => {
  const input = freezeDeep(fixture()), output = resetAllProgress(input);
  assert.equal(output.answers, 0); assert.equal(output.learned, 0);
  for (const key of ['daily', 'reviews', 'cardStats']) assert.deepEqual(output[key], {});
  assert.deepEqual(output.days, []);
  assert.equal(output.rank.xp, 0); assert.equal(output.rank.version, 1); assert.deepEqual(output.rank.daily, {});
  assert.equal(output.rank.optionalFutureRank, true);
  for (const key of ['sets', 'settings', 'categories', 'futureState']) assert.equal(output[key], input[key]);
  assert.equal(output.lastBackupAt, input.lastBackupAt);
  assert.deepEqual(attachmentGarbage(input, output), []);
  // Normalization must not rebuild XP from the former correct-answer total.
  const runtime = structuredClone(output);
  ensurePracticeData(runtime); ensureRankData(runtime);
  assert.equal(rankProgress(runtime).xp, 0);
  assert.equal(getDueCards(runtime, null, 1).length, 3);
  const award = awardRankXP(runtime, runtime.sets[0].cards[0], true, 'cards', new Date(2026, 9, 8));
  assert.equal(award.awarded, 10); assert.equal(runtime.rank.xp, 10);
});

test('last study lookup normalizes legacy ID types and does not invent an absent preference', () => {
  const input = freezeDeep(fixture()), output = rememberStudySet(input, 2);
  assert.equal(output.lastStudySetId, '2'); assert.equal(lastStudySet(output), input.sets[1]);
  assert.equal(rememberStudySet(output, '2'), output);
  assert.equal(lastStudySet({ ...input, lastStudySetId: '1' }), input.sets[0]);
  assert.equal(lastStudySet({ ...input, lastStudySetId: 'missing' }), null);
  const withoutPreference = { ...input }; delete withoutPreference.lastStudySetId;
  assert.equal(lastStudySet(withoutPreference), null);
  assert.throws(() => rememberStudySet(input, 'missing'), /Набор не найден/);
});

test('GC considers all four reference types and avoids duplicates and restored references', () => {
  const before = fixture();
  assert.deepEqual([...attachmentReferences(before)].sort(), ['future-image', 'other-image', 'other-recording', 'private-image', 'shared-audio']);
  const after = deleteSet(before, 1).data;
  assert.deepEqual(collectUnreferencedAttachments(after, ['private-image', 'private-image', 'shared-audio', 'other-recording', 'staged-unrelated']), ['private-image', 'staged-unrelated']);
  assert.deepEqual(attachmentGarbage(before, after), ['private-image']);
  // Recheck against current data after commit before invoking removeAttachment.
  after.futureState = { ...after.futureState, imageId: 'private-image' };
  assert.deepEqual(collectUnreferencedAttachments(after, ['private-image']), []);
});

test('deletion preserves progress for a surviving duplicate card ID in an old save', () => {
  const input = fixture(); input.sets[1].cards[0][2].id = 'a-1';
  const output = deleteSet(freezeDeep(input), 1);
  assert.deepEqual(output.removedCardIds, ['a-2']);
  assert.equal(output.data.reviews['a-1'].level, 5);
  assert.equal(output.data.cardStats['a-1'].answers, 10);
});

test('unknown-set operations fail without mutation and the last set can be deleted safely', () => {
  const input = freezeDeep(fixture());
  assert.throws(() => deleteSet(input, 'missing'), /Набор не найден/);
  assert.throws(() => resetSetProgress(input, 'missing'), /Набор не найден/);
  const first = deleteSet(input, 1).data, last = deleteSet(first, '2');
  assert.deepEqual(last.data.sets, []); assert.equal(lastStudySet(last.data), null);
  assert.deepEqual(last.removeAttachmentIds.sort(), ['other-image', 'shared-audio']);
  assert.equal(last.data.futureState.recording.referenceAudioId, 'future-image');
});
