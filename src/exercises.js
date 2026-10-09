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

function withoutAnnotations(value) {
  let text = String(value).normalize('NFKC'), previous;
  // Process nested grammatical notes from the inside out, without discarding
  // surrounding words or joining words on opposite sides of an annotation.
  do {
    previous = text;
    text = text.replace(/\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}/gu, ' ');
  } while (text !== previous);
  return text.trim().replace(/\s+/gu, ' ');
}

export function normalizeTypedAnswer(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return normalizeExerciseAnswer(withoutAnnotations(value)).replace(/^to\s+/u, '');
}

function rawAnswerVariants(value) {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    if (typeof item !== 'string' && typeof item !== 'number') return [];
    return withoutAnnotations(item).split('/').map(alias => alias.trim()).filter(Boolean);
  });
}

/** Exact normalized alternatives are also useful for filtering test distractors. */
export function answerVariants(value) {
  return [...new Set(rawAnswerVariants(value).map(normalizeTypedAnswer).filter(Boolean))];
}

/** Bounded Levenshtein: one insertion, deletion or substitution, in linear time. */
function withinOneEdit(first, second) {
  const a = [...first], b = [...second];
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (a.length <= b.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

/** Forgiving spelling belongs only to typed practice, never test choices. */
export function matchesTypedAnswer(input, expected) {
  const actual = normalizeTypedAnswer(input);
  if (!actual) return false;
  return answerVariants(expected).some(variant => actual === variant || [...variant].length > 5 && withinOneEdit(actual, variant));
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
  const aliases = rawAnswerVariants(term);
  const variants = aliases.flatMap(alias => /^to\s+\S/iu.test(alias) ? [alias, alias.replace(/^to\s+/iu, '')] : [alias]);
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
  return { sentence, before, after, answer, prompt: `${before}____${after}`, ...(aliases.length > 1 ? { alternatives: aliases } : {}) };
}

/** The written answer is deliberately separate from the UI's listening prompt. */
export function buildListening(card) {
  if (!Array.isArray(card)) return null;
  const answer = readable(card[0]);
  const prompt = rawAnswerVariants(answer)[0];
  return prompt ? { prompt, answer } : null;
}

function evaluate(answer, exercise) {
  return Boolean(exercise) && matchesTypedAnswer(answer, [exercise.answer, ...(exercise.alternatives || [])]);
}

export function evaluateCloze(answer, exerciseOrCard) {
  return evaluate(answer, Array.isArray(exerciseOrCard) ? buildCloze(exerciseOrCard) : exerciseOrCard);
}

export function evaluateListening(answer, exerciseOrCard) {
  return evaluate(answer, Array.isArray(exerciseOrCard) ? buildListening(exerciseOrCard) : exerciseOrCard);
}
