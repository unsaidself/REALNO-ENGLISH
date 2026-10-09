import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkCards } from '../src/deck-editor.js';

test('bulk insertion accepts pasted Windows text, whitespace and blank lines', () => {
  assert.deepEqual(parseBulkCards('  Train ; Поезд  \r\n\r\n Ticket; Билет\r\n '), [
    ['Train', 'Поезд'], ['Ticket', 'Билет'],
  ]);
});

test('bulk insertion preserves punctuation, HTML-shaped text and semicolons in definitions', () => {
  assert.deepEqual(parseBulkCards('To take one’s time; Не торопиться / делать без спешки; пример\n<script>; <b>Текст</b>'), [
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
