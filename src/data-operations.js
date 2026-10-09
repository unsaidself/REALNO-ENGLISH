/** Pure collection mutations. Persist returned data before deleting any blobs. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const mediaReference = /^(?:imageId|audioId|recordingId|referenceAudioId)$/;
const identity = value => ['string', 'number'].includes(typeof value) ? String(value) : '';

function collection(data) {
  if (!object(data) || !Array.isArray(data.sets)) throw new TypeError('Данные должны содержать список наборов.');
  return data.sets;
}

function existingSet(data, setId) {
  const sets = collection(data), key = identity(setId);
  const index = sets.findIndex(set => object(set) && identity(set.id) === key);
  if (!key || index < 0) throw new RangeError('Набор не найден. Обнови страницу и попробуй ещё раз.');
  return { set: sets[index], index };
}

function cardIdentities(set) {
  const result = new Set();
  for (const card of Array.isArray(set?.cards) ? set.cards : []) {
    const id = identity(card?.[2]?.id);
    if (id) result.add(id);
  }
  return result;
}

function withoutKeys(value, keys) {
  return Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([key]) => !keys.has(key)));
}

/** Scan the same media-reference fields understood by version 1 backups. */
export function attachmentReferences(value) {
  const result = new Set(), seen = new WeakSet();
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [key, item] of Object.entries(node)) {
      if (mediaReference.test(key) && typeof item === 'string' && item) result.add(item);
      else if (item && typeof item === 'object') visit(item);
    }
  }
  visit(value);
  return result;
}

/**
 * Return only candidate blobs no longer referenced anywhere in committed data.
 * Use disappearing references as candidates, rather than indiscriminately
 * deleting all orphans: an import may still be staging new attachments.
 */
export function collectUnreferencedAttachments(data, candidateIds) {
  const referenced = attachmentReferences(data), garbage = new Set();
  for (const id of candidateIds || []) {
    if (typeof id === 'string' && id && !referenced.has(id)) garbage.add(id);
  }
  return [...garbage];
}

/** Useful after editing/deleting cards as well as after deleting a collection. */
export function attachmentGarbage(before, after) {
  return collectUnreferencedAttachments(after, attachmentReferences(before));
}

/** Delete one set without rewriting another set or the historical XP ledger. */
export function deleteSet(data, setId) {
  const { set, index } = existingSet(data, setId);
  const remainingSets = data.sets.filter((_, currentIndex) => currentIndex !== index);
  const removedCardIds = cardIdentities(set);
  // IDs are normally unique after migration. If older/corrupt data shares one,
  // retain its progress as long as another surviving card still uses it.
  for (const remaining of remainingSets) for (const id of cardIdentities(remaining)) removedCardIds.delete(id);
  const next = {
    ...data,
    sets: remainingSets,
    reviews: withoutKeys(data.reviews, removedCardIds),
    cardStats: withoutKeys(data.cardStats, removedCardIds),
  };
  if (own(next, 'lastStudySetId') && identity(next.lastStudySetId) === identity(set.id)) delete next.lastStudySetId;
  return {
    data: next,
    removedCardIds: [...removedCardIds],
    removeAttachmentIds: collectUnreferencedAttachments(next, attachmentReferences(set)),
  };
}

/** Restart one set's scheduling/accuracy, preserving global activity and XP. */
export function resetSetProgress(data, setId) {
  const { set } = existingSet(data, setId), ids = cardIdentities(set);
  return { ...data, reviews: withoutKeys(data.reviews, ids), cardStats: withoutKeys(data.cardStats, ids) };
}

/** Restart all study progress without touching collections, files or settings. */
export function resetAllProgress(data) {
  collection(data);
  return {
    ...data,
    answers: 0, learned: 0, days: [], daily: {}, reviews: {}, cardStats: {},
    // Keep an explicit rank object so ensureRankData cannot remigrate old XP.
    rank: { ...(object(data.rank) ? data.rank : {}), version: 1, xp: 0, daily: {} },
  };
}

/** Preserve the set's actual ID type; string comparison supports old saves. */
export function rememberStudySet(data, setId) {
  const { set } = existingSet(data, setId);
  if (own(data, 'lastStudySetId') && data.lastStudySetId === set.id) return data;
  return { ...data, lastStudySetId: set.id };
}

/** Return null for missing/stale IDs; the caller can then choose its fallback. */
export function lastStudySet(data) {
  const sets = collection(data);
  if (!own(data, 'lastStudySetId')) return null;
  const id = identity(data.lastStudySetId);
  return id ? sets.find(set => object(set) && identity(set.id) === id) || null : null;
}
