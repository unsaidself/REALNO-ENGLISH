import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloze, buildListening, evaluateCloze, evaluateListening, normalizeExerciseAnswer } from '../src/exercises.js';

const card = (term, example) => [term, 'определение', { example }];

test('sentence gaps preserve original case, punctuation and surrounding text', () => {
  const exercise = buildCloze(card('Serendipity', 'Finding this book was pure serendipity.'));
  assert.deepEqual(exercise, {
    sentence: 'Finding this book was pure serendipity.',
    before: 'Finding this book was pure ', after: '.', answer: 'serendipity',
    prompt: 'Finding this book was pure ____.',
  });
  assert.equal(evaluateCloze(' SERENDIPITY! ', exercise), true);
  assert.equal(evaluateCloze('coincidence', exercise), false);
});

test('infinitive to is optional in real examples while longer exact phrases win', () => {
  const term = 'To make a difference';
  const normal = buildCloze(card(term, 'Small changes can make a difference.'));
  assert.equal(normal.answer, 'make a difference');
  assert.equal(normal.before, 'Small changes can ');
  assert.equal(evaluateCloze('make a difference', normal), true);
  assert.equal(evaluateCloze('to make a difference', normal), false);
  const full = buildCloze(card(term, 'To make a difference, listen carefully.'));
  assert.equal(full.answer, 'To make a difference');
});

test('real phrase gaps support hyphenated variants and curly apostrophes', () => {
  const roundTrip = buildCloze(card('Round trip', 'I would like a round-trip ticket to London.'));
  assert.equal(roundTrip.answer, 'round-trip');
  assert.equal(evaluateCloze('round trip', roundTrip), true);
  const contraction = buildCloze(card("Don't give up", 'Please don’t give up now.'));
  assert.equal(contraction.answer, 'don’t give up');
  assert.equal(evaluateCloze("DON'T GIVE UP", contraction), true);
});

test('word boundaries avoid fragments of longer words and work with Cyrillic', () => {
  assert.equal(buildCloze(card('cat', 'A category can be useful.')), null);
  assert.equal(buildCloze(card('cat', 'The cats are sleeping.')), null);
  assert.equal(buildCloze(card('cat', 'A wildcat is quiet.')), null);
  assert.equal(buildCloze(card('кот', 'Это котёнок.')), null);
  assert.equal(buildCloze(card('кот', 'Мой кот спит.')).answer, 'кот');
  assert.equal(buildCloze(card('cat', 'A (CAT) is waiting.')).answer, 'CAT');
});

test('unsuitable samples return null rather than inventing an exercise', () => {
  for (const value of [null, [], ['word'], card('', 'Some sentence.'), card('word', ''), card('word', 'word!'), card('To be on the same page', 'We are on the same page.')]) {
    assert.equal(buildCloze(value), null);
    assert.equal(evaluateCloze('', value), false);
  }
  assert.equal(buildCloze(card('word', 'Some other sentence.')), null);
});

test('regex metacharacters and repeated occurrences keep the right substring', () => {
  const special = buildCloze(card('C++', 'We write C++ today.'));
  assert.equal(special.before, 'We write ');
  assert.equal(special.answer, 'C++');
  const repeated = buildCloze(card('Take your time', 'Take your time. Really take your time.'));
  assert.equal(repeated.answer, 'Take your time');
  assert.equal(repeated.after, '. Really take your time.');
});

test('listening matches spelling independent of punctuation and spacing', () => {
  const listening = buildListening(card('Carry-on luggage', ''));
  assert.deepEqual(listening, { prompt: 'Carry-on luggage', answer: 'Carry-on luggage' });
  assert.equal(evaluateListening('carry on luggage!', listening), true);
  assert.equal(evaluateListening('carry on bags', listening), false);
  assert.equal(evaluateListening('', listening), false);
  assert.equal(evaluateListening('уже', ['Ужё', 'test']), true);
  assert.equal(buildListening(['', 'test']), null);
  assert.equal(evaluateListening('', null), false);
  assert.equal(normalizeExerciseAnswer('  “Don’t”    panic!  '), 'dont panic');
});
