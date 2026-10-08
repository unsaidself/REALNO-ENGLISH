/** Local-only learning history. All interval values are expressed in days. */
const DAY = 24 * 60 * 60 * 1000;
const RETRY = 10 * 60 * 1000;
const INTERVALS = [1, 3, 7, 14, 30, 90];
const THEMES = new Set(['light', 'dark', 'system']);
const ACCENTS = new Set(['teal', 'blue', 'orange', 'rose', 'graphite']);
let idSequence = 0;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const timestamp = value => Number.isFinite(Number(value)) ? Number(value) : Date.now();
const identifier = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';

function newId(reserved) {
  let id;
  do {
    id = globalThis.crypto?.randomUUID?.() || `card-${Date.now().toString(36)}-${(++idSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (reserved.has(id));
  reserved.add(id);
  return id;
}

function dailyRecord(value) {
  const answers = count(value?.answers);
  return { answers, correct: Math.min(answers, count(value?.correct)) };
}

function reviewFor(data, id) {
  const value = own(data.reviews, id) ? data.reviews[id] : null;
  if (!object(value) || !Number.isFinite(Number(value.due))) return null;
  return value;
}

/** Preserve the existing collection and media metadata while upgrading older saves. */
export function ensurePracticeData(data) {
  if (!object(data)) throw new TypeError('Learning data must be an object.');
  if (!Array.isArray(data.sets)) data.sets = [];
  if (!Array.isArray(data.days)) data.days = [];
  data.answers = count(data.answers);
  data.learned = count(data.learned);
  if (!object(data.reviews)) data.reviews = {};
  if (!object(data.daily)) data.daily = {};
  if (!object(data.settings)) data.settings = {};

  const theme = String(data.settings.theme || '').toLowerCase();
  const accent = String(data.settings.accent || '').toLowerCase();
  data.settings.theme = THEMES.has(theme) ? theme : 'light';
  data.settings.accent = ACCENTS.has(accent) ? accent : 'teal';
  const sounds = data.settings.sounds;
  data.settings.sounds = sounds === undefined || sounds === null ? true : ![false, 0, '0', 'false', 'off'].includes(sounds);
  const goal = Number(data.settings.goal);
  data.settings.goal = Number.isFinite(goal) && goal > 0 ? Math.min(500, Math.max(1, Math.round(goal))) : 20;

  // Reserve all identities before generating any new one. Removed-card reviews are
  // retained so restoring an existing card can restore its learning history.
  const reserved = new Set(Object.keys(data.reviews));
  for (const set of data.sets) {
    if (!object(set)) continue;
    if (!Array.isArray(set.cards)) set.cards = [];
    for (const card of set.cards) {
      if (Array.isArray(card) && object(card[2])) {
        const id = identifier(card[2].id);
        if (id) reserved.add(id);
      }
    }
  }
  const used = new Set();
  for (const set of data.sets) {
    if (!object(set) || !Array.isArray(set.cards)) continue;
    for (const card of set.cards) {
      if (!Array.isArray(card) || card.length < 2) continue;
      // Copy metadata to detach accidental shared objects without losing media.
      const metadata = object(card[2]) ? { ...card[2] } : {};
      const existing = identifier(metadata.id);
      metadata.id = existing && !used.has(existing) ? existing : newId(reserved);
      used.add(metadata.id);
      card[2] = metadata;
    }
  }
  return data;
}

/** A calendar key in the learner's own timezone, never a UTC date slice. */
export function localDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Invalid calendar date.');
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Oldest overdue cards come first; unseen cards follow them in collection order. */
export function getDueCards(data, setId = null, now = Date.now()) {
  ensurePracticeData(data);
  const time = timestamp(now);
  const cards = [];
  for (const set of data.sets) {
    if (!object(set) || (setId !== null && String(set.id) !== String(setId))) continue;
    for (const card of set.cards) {
      if (!Array.isArray(card) || !object(card[2])) continue;
      const review = reviewFor(data, card[2].id);
      if (!review || Number(review.due) <= time) cards.push({ set, card, due: review ? Number(review.due) : Infinity });
    }
  }
  return cards.sort((a, b) => a.due - b.due).map(({ set, card }) => ({ set, card }));
}

/** A failed answer resets the interval; correcting it restarts at one day. */
export function scheduleReview(data, card, correct, now = Date.now()) {
  ensurePracticeData(data);
  if (!Array.isArray(card) || card.length < 2) throw new TypeError('A review needs a term and definition.');
  if (!object(card[2]) || !identifier(card[2].id)) {
    card[2] = { ...(object(card[2]) ? card[2] : {}), id: newId(new Set(Object.keys(data.reviews))) };
  }
  const id = identifier(card[2].id);
  card[2].id = id;
  const time = timestamp(now);
  const previous = reviewFor(data, id);
  const previousLevel = previous ? Math.min(INTERVALS.length, count(previous.level)) : 0;
  // Manual drills still count toward the daily goal, but successful repeat clicks
  // must not advance an interval before its scheduled review, even on another day.
  if (correct && previousLevel > 0 && Number(previous.due) > time) return previous;

  const level = correct ? Math.min(INTERVALS.length, previousLevel + 1) : 0;
  const interval = correct ? INTERVALS[level - 1] : RETRY / DAY;
  const review = { due: time + (correct ? interval * DAY : RETRY), interval, level, lastReviewed: time };
  Object.defineProperty(data.reviews, id, { value: review, enumerable: true, configurable: true, writable: true });
  return review;
}

/** Update daily activity only; callers own the existing cumulative answer totals. */
export function recordDaily(data, correct, now = Date.now()) {
  ensurePracticeData(data);
  const date = localDay(timestamp(now));
  const record = dailyRecord(own(data.daily, date) ? data.daily[date] : null);
  record.answers++;
  if (correct) record.correct++;
  data.daily[date] = record;
  if (!data.days.includes(date)) data.days.push(date);
  return record;
}

export function dailyProgress(data, now = Date.now()) {
  ensurePracticeData(data);
  const date = localDay(timestamp(now));
  const record = dailyRecord(own(data.daily, date) ? data.daily[date] : null);
  const goal = data.settings.goal;
  return { date, ...record, goal, percent: Math.min(100, Math.round(record.answers / goal * 100)), complete: record.answers >= goal };
}

/** Zero-based months can overflow, e.g. month 12 means January of the next year. */
export function activityCalendar(data, year, monthZeroBased) {
  ensurePracticeData(data);
  if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(monthZeroBased))) return [];
  const start = new Date(0);
  start.setHours(12, 0, 0, 0);
  start.setFullYear(Number(year), Number(monthZeroBased), 1);
  if (!Number.isFinite(start.getTime())) return [];
  const month = start.getMonth();
  const days = [];
  for (const date = new Date(start); date.getMonth() === month; date.setDate(date.getDate() + 1)) {
    const key = localDay(date);
    const record = dailyRecord(own(data.daily, key) ? data.daily[key] : null);
    days.push({ date: key, day: date.getDate(), ...record, goalMet: record.answers >= data.settings.goal });
  }
  return days;
}

/** A current streak includes yesterday when today's session has not started yet. */
export function studyStreak(data, now = Date.now()) {
  ensurePracticeData(data);
  const active = new Set(data.days.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)));
  for (const [date, record] of Object.entries(data.daily)) if (count(record?.answers) > 0) active.add(date);
  const date = new Date(timestamp(now));
  date.setHours(12, 0, 0, 0);
  if (!active.has(localDay(date))) date.setDate(date.getDate() - 1);
  let streak = 0;
  while (active.has(localDay(date))) {
    streak++;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}
