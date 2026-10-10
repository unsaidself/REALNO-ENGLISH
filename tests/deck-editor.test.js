import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkCards } from '../src/deck-editor.js';

test('bulk insertion accepts pasted Windows text, whitespace and blank lines', () => {
  assert.deepEqual(parseBulkCards('  Train ; Поезд  \r\n\r\n Ticket; Билет\r\n '), [
    ['Train', 'Поезд'], ['Ticket', 'Билет'],
  ]);
});

test('bulk insertion preserves punctuation, HTML-shaped text and semicolons in definitions', () => {
  assert.deepEqual(parseBulkCards('To take one’s time; "Не торопиться / делать без спешки; пример"\n<script>; <b>Текст</b>'), [
    ['To take one’s time', 'Не торопиться / делать без спешки; пример'],
    ['<script>', '<b>Текст</b>'],
  ]);
});

test('an invalid pasted row identifies its source line before any cards are appended', () => {
  assert.throws(() => parseBulkCards('Train; Поезд\n\nMissing definition'), /Строка 3/);
  assert.throws(() => parseBulkCards('Train; Поезд\n; Билет'), /Строка 2/);
  assert.throws(() => parseBulkCards('Train; '), /Строка 1/);
});

test('empty pasted text produces actionable Russian guidance', () => {
  assert.throws(() => parseBulkCards(' \r\n '), /Вставь хотя бы одну пару/);
});

test('Quizlet tabs, comma CSV headers, BOM, quoted separators and multiline fields share the file parser', () => {
  assert.deepEqual(parseBulkCards('\uFEFFterm,definition\r\n"I\'ll be back; and you know it","Я вернусь"'), [["I'll be back; and you know it", 'Я вернусь']]);
  assert.deepEqual(parseBulkCards('Hold the door\tДержи дверь\nCome back\tВернись'), [['Hold the door','Держи дверь'],['Come back','Вернись']]);
  assert.deepEqual(parseBulkCards('term;definition;example\nTrain;Поезд;This train is here.'), [['Train','Поезд',{example:'This train is here.'}]]);
  assert.deepEqual(parseBulkCards('"one\ntwo","один, два"'), [['one\ntwo','один, два']]);
});
test('ambiguous separators are never silently guessed; explicit last/first boundaries are supported', () => {
  assert.throws(() => parseBulkCards("I'll be back; and you know it; Я вернусь"), /несколько разделителей/);
  assert.deepEqual(parseBulkCards("I'll be back; and you know it; Я вернусь", {separator:';',boundary:'last'}), [["I'll be back; and you know it",'Я вернусь']]);
  assert.deepEqual(parseBulkCards('Train - Поезд', {separator:'dash'}), [['Train','Поезд']]);
  assert.deepEqual(parseBulkCards('Train; Поезд; пример',{boundary:'first'}), [['Train','Поезд; пример']]);
});
