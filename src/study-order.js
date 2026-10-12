import { limitedNewCards } from './learning-plan.js';

/** Shuffle a copy so editing, exports and stable card IDs keep their order. */
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Eligible cards are shuffled before the daily cap picks new cards. */
export function createStudyQueue(data, cards, now = new Date(), random = Math.random) {
  return limitedNewCards(data, shuffle(cards, random), now);
}
