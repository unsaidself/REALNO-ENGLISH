import { localDay } from './practice.js';

/** XP belongs to this browser's learning data and is included in local backups. */
export const rankCatalog = Object.freeze([
  { id: 'bronze', level: 1, name: 'Бронза', xp: 0 },
  { id: 'silver', level: 2, name: 'Серебро', xp: 250 },
  { id: 'gold', level: 3, name: 'Золото', xp: 750 },
  { id: 'platinum', level: 4, name: 'Платина', xp: 1800 },
  { id: 'diamond', level: 5, name: 'Алмаз', xp: 4000 },
  { id: 'master', level: 6, name: 'Мастер', xp: 8000 },
].map(rank => Object.freeze(rank)));

export const XP_PER_CORRECT = 10;
export const DAILY_CARD_REWARDS = 3;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const count = value => Number.isFinite(Number(value)) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(value)))) : 0;

/** Migrate the old correct-answer total once; never remigrate on later renders. */
export function ensureRankData(data) {
  if (!object(data)) throw new TypeError('Rank data must be an object.');
  if (!object(data.rank)) {
    data.rank = { version: 1, xp: Math.min(Number.MAX_SAFE_INTEGER, count(data.learned) * XP_PER_CORRECT), daily: {} };
  }
  data.rank.version = 1;
  data.rank.xp = count(data.rank.xp);
  if (!object(data.rank.daily)) data.rank.daily = {};
  return data;
}

export function rankProgress(data) {
  ensureRankData(data);
  const xp = data.rank.xp;
  const currentIndex = rankCatalog.findLastIndex(rank => xp >= rank.xp);
  const current = rankCatalog[currentIndex];
  const next = rankCatalog[currentIndex + 1] || null;
  const earned = xp - current.xp;
  return {
    id: current.id, xp, level: current.level, name: current.name,
    nextName: next?.name || null, nextXP: next?.xp ?? null,
    earned, remaining: next ? next.xp - xp : 0,
    progress: next ? Math.min(100, Math.floor(earned / (next.xp - current.xp) * 100)) : 100,
  };
}

function cardIdentity(card) {
  if (!Array.isArray(card) || typeof card[0] !== 'string' || !card[0].trim()) return null;
  const id = card[2]?.id;
  if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) return `id:${String(id).trim()}`;
  // Legacy cards can still receive XP before practice-data migration assigns IDs.
  return `card:${JSON.stringify([card[0], card[1] ?? ''])}`;
}

function put(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
}

/**
 * Every correct practice answer earns the same XP. A card can earn XP at most
 * three times per local day across all modes; further practice still counts in
 * the separate daily goal/review history. Wrong answers never remove XP.
 */
export function awardRankXP(data, card, correct, mode = 'practice', now = Date.now()) {
  ensureRankData(data);
  const previous = rankProgress(data);
  const key = cardIdentity(card);
  let awarded = 0, capped = false;
  if (correct === true && key) {
    const date = localDay(now);
    let day = own(data.rank.daily, date) && object(data.rank.daily[date]) ? data.rank.daily[date] : null;
    if (!day) { day = {}; put(data.rank.daily, date, day); }
    const rewards = own(day, key) ? count(day[key]) : 0;
    capped = rewards >= DAILY_CARD_REWARDS;
    if (!capped) {
      awarded = Math.min(XP_PER_CORRECT, Number.MAX_SAFE_INTEGER - data.rank.xp);
      data.rank.xp += awarded;
      put(day, key, rewards + 1);
    }
  }
  const current = rankProgress(data);
  return {
    awarded, capped, leveledUp: current.level > previous.level,
    previous, current, mode,
    unlocked: rankCatalog.filter(rank => rank.level > previous.level && rank.level <= current.level),
  };
}
