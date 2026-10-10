import { localDay } from './practice.js';
export function limitedNewCards(data, cards, now = new Date()) {
  const day = localDay(now), introduced = data.newCardDay?.day === day ? new Set(data.newCardDay.ids || []) : new Set();
  const limit = Number.isInteger(data.settings?.newCardsPerDay) ? Math.max(0, Math.min(500, data.settings.newCardsPerDay)) : 20;
  let available = Math.max(0, limit - introduced.size);
  return cards.filter(card => {
    const id = card[2]?.id;
    if (Object.hasOwn(data.reviews || {}, id) || introduced.has(id)) return true;
    return available-- > 0;
  });
}
export function introduceCard(data, card, now = new Date()) {
  const day = localDay(now), id = card?.[2]?.id;
  if (!id || Object.hasOwn(data.reviews || {}, id)) return false;
  if (data.newCardDay?.day !== day) data.newCardDay = { day, ids: [] };
  if (!data.newCardDay.ids.includes(id)) { data.newCardDay.ids.push(id); return true; }
  return false;
}
