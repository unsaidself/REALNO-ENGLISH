/** Pure helpers for typed listening and sentence-gap practice. */
const readable = value => typeof value === 'string' ? value.trim() : '';
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Treat spelling, spacing and punctuation consistently without guessing synonyms. */
export function normalizeExerciseAnswer(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/[’‘ʼ`']/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function termPattern(term) {
  // A hyphenated word or phrase can be written with spaces in an example.
  // The matched substring remains exactly as written in the original sentence.
  return term.split(/[\s\-‐‑‒–—]+/u).filter(Boolean).map(part => {
    return [...part].map(letter => /['’‘ʼ]/u.test(letter) ? "['’‘ʼ]" : escapePattern(letter)).join('');
  }).join('[\\s\\-‐‑‒–—]+');
}

function findTerm(sentence, term) {
  const source = termPattern(term);
  if (!source) return null;
  // JavaScript's \b is ASCII-only, so use real Unicode word boundaries.
  const pattern = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])(${source})(?![\\p{L}\\p{M}\\p{N}_])`, 'iu');
  const found = pattern.exec(sentence);
  return found ? { index: found.index + found[1].length, answer: found[2] } : null;
}

/**
 * Use only a genuine occurrence of the term in its saved example. Infinitive
 * "to" may be absent in a sentence; inflections and invented examples are not
 * guessed. Missing/unsuitable examples return null so the UI can explain them.
 */
export function buildCloze(card) {
  if (!Array.isArray(card)) return null;
  const term = readable(card[0]);
  const sentence = readable(card[2]?.example);
  if (!term || !sentence) return null;
  const variants = [term];
  if (/^to\s+\S/iu.test(term)) variants.push(term.replace(/^to\s+/iu, ''));
  let occurrence = null;
  for (const variant of variants) {
    occurrence = findTerm(sentence, variant);
    if (occurrence) break;
  }
  if (!occurrence) return null;
  const { index, answer } = occurrence;
  const before = sentence.slice(0, index);
  const after = sentence.slice(index + answer.length);
  // A sample containing just the target gives no sentence context.
  if (!normalizeExerciseAnswer(before + after)) return null;
  return { sentence, before, after, answer, prompt: `${before}____${after}` };
}

/** The written answer is deliberately separate from the UI's listening prompt. */
export function buildListening(card) {
  if (!Array.isArray(card)) return null;
  const answer = readable(card[0]);
  return answer ? { prompt: answer, answer } : null;
}

function evaluate(answer, exercise) {
  const expected = normalizeExerciseAnswer(exercise?.answer);
  return Boolean(expected) && normalizeExerciseAnswer(answer) === expected;
}

export function evaluateCloze(answer, exerciseOrCard) {
  return evaluate(answer, Array.isArray(exerciseOrCard) ? buildCloze(exerciseOrCard) : exerciseOrCard);
}

export function evaluateListening(answer, exerciseOrCard) {
  return evaluate(answer, Array.isArray(exerciseOrCard) ? buildListening(exerciseOrCard) : exerciseOrCard);
}
