/** Card rows keep their own identity and metadata throughout every draft edit. */
const PAGE_SIZE = 40;
const CARD_LIMIT = 100000;
let sequence = 0;

function freshId(reserved) {
  let id;
  do { id = globalThis.crypto?.randomUUID?.() || `card-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`; } while (reserved.has(id));
  reserved.add(id); return id;
}

export function parseBulkCards(value) {
  const cards = [];
  for (const [lineIndex, line] of String(value || '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const divider = line.indexOf(';');
    const term = divider < 0 ? '' : line.slice(0, divider).trim();
    const definition = divider < 0 ? '' : line.slice(divider + 1).trim();
    if (!term || !definition) throw new Error(`Строка ${lineIndex + 1}: нужны термин и определение через «;».`);
    cards.push([term, definition]);
  }
  if (!cards.length) throw new Error('Вставь хотя бы одну пару «термин; определение».');
  return cards;
}

/** Mount inside the existing modal/form; the app retains its focus trap. */
export function mountDeckEditor(root, originalCards = [], { esc, icon, countLabel } = {}) {
  if (!root || typeof esc !== 'function' || typeof icon !== 'function' || typeof countLabel !== 'function') throw new TypeError('Не удалось открыть редактор карточек.');
  const original = structuredClone(originalCards);
  const reserved = new Set(original.map(card => String(card[2]?.id || '')).filter(Boolean));
  const used = new Set();
  const copy = card => {
    const metadata = card[2] && typeof card[2] === 'object' && !Array.isArray(card[2]) ? structuredClone(card[2]) : {};
    const existing = String(metadata.id || '').trim();
    metadata.id = existing && !used.has(existing) ? existing : freshId(reserved);
    used.add(metadata.id);
    return [String(card[0] ?? ''), String(card[1] ?? ''), metadata];
  };
  let rows = original.length ? original.map(copy) : [copy(['', ''])];
  let page = 0;
  const prefix = `deck-${(++sequence).toString(36)}`;
  root.classList.add('deck-editor');
  root.innerHTML = `<div class="deck-editor-heading"><h3>Карточки</h3><span class="deck-editor-total" role="status"></span></div><p class="field-caption">Редактируй термин и определение отдельно. Картинка, аудио и прогресс остаются у своей карточки.</p><div class="deck-editor-rows"></div><div class="deck-editor-pagination"></div><button class="secondary deck-add-row" type="button" data-editor-action="add">${icon('plus')} Добавить карточку</button><details class="deck-bulk"><summary>Массовая вставка текстом</summary><label for="${prefix}-bulk">Карточки из текста<textarea id="${prefix}-bulk" rows="5" placeholder="Train; Поезд&#10;Ticket; Билет"></textarea><small>Одна пара «термин; определение» в каждой строке. Новые карточки добавятся в конец; существующие карточки и вложения сохранятся.</small></label><div class="form-error deck-bulk-error" role="alert"></div><button class="secondary" type="button" data-editor-action="append">${icon('plus')} Добавить из текста</button></details><p class="deck-editor-status" role="status" aria-live="polite"></p>`;
  const rowsRoot = root.querySelector('.deck-editor-rows');
  const pagination = root.querySelector('.deck-editor-pagination');
  const status = root.querySelector('.deck-editor-status');

  function renderRows() {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.max(0, Math.min(pages - 1, page));
    const start = page * PAGE_SIZE;
    root.querySelector('.deck-editor-total').textContent = countLabel(rows.length, ['карточка', 'карточки', 'карточек']);
    rowsRoot.innerHTML = rows.slice(start, start + PAGE_SIZE).map((card, offset) => {
      const index = start + offset;
      const attachments = [card[2]?.imageId && 'картинка', card[2]?.audioId && 'аудиозапись', card[2]?.example && 'пример'].filter(Boolean);
      return `<section class="deck-editor-row" data-row-index="${index}" data-card-id="${esc(card[2].id)}" aria-label="Карточка ${index + 1}"><div class="deck-row-heading"><b>Карточка ${index + 1}</b><div class="deck-row-actions"><button class="icon-button" type="button" data-editor-action="up" aria-label="Поднять карточку ${index + 1} выше" title="Вверх" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-editor-action="down" aria-label="Опустить карточку ${index + 1} ниже" title="Вниз" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button><button class="icon-button deck-remove-row" type="button" data-editor-action="remove" aria-label="Удалить карточку ${index + 1}" title="Удалить карточку">${icon('close')}</button></div></div><div class="deck-row-fields"><label for="${prefix}-term-${index}">Термин<textarea id="${prefix}-term-${index}" data-card-field="0" rows="2" required>${esc(card[0])}</textarea></label><label for="${prefix}-definition-${index}">Определение<textarea id="${prefix}-definition-${index}" data-card-field="1" rows="2" required>${esc(card[1])}</textarea></label></div>${attachments.length ? `<p class="deck-row-media">${icon('archive')} Есть: ${esc(attachments.join(', '))}</p>` : ''}</section>`;
    }).join('');
    pagination.innerHTML = pages > 1 ? `<button class="secondary" type="button" data-editor-action="previous" ${page === 0 ? 'disabled' : ''}>← Назад</button><span>Карточки ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} из ${rows.length}</span><button class="secondary" type="button" data-editor-action="next" ${page === pages - 1 ? 'disabled' : ''}>Далее →</button>` : '';
    root.querySelector('[data-editor-action="add"]').disabled = rows.length >= CARD_LIMIT;
  }

  function focusCard(index, field = 0, action = null) {
    index = Math.max(0, Math.min(rows.length - 1, index));
    page = Math.floor(index / PAGE_SIZE); renderRows();
    const row = rowsRoot.querySelector(`[data-row-index="${index}"]`);
    const actionButton = action ? row?.querySelector(`[data-editor-action="${action}"]:not(:disabled)`) : null;
    (actionButton || row?.querySelector(`[data-card-field="${field}"]`))?.focus({ preventScroll: false });
  }

  const input = event => {
    const field = event.target.closest('[data-card-field]');
    if (!field || !root.contains(field)) return;
    const index = Number(field.closest('[data-row-index]').dataset.rowIndex);
    if (rows[index]) rows[index][Number(field.dataset.cardField)] = field.value;
  };
  const click = event => {
    const button = event.target.closest('button[data-editor-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const action = button.dataset.editorAction;
    const index = Number(button.closest('[data-row-index]')?.dataset.rowIndex);
    if (action === 'add') { rows.push(copy(['', ''])); focusCard(rows.length - 1); status.textContent = 'Добавлена новая карточка.'; }
    else if (action === 'remove' && rows[index]) {
      rows.splice(index, 1);
      if (!rows.length) rows.push(copy(['', '']));
      focusCard(Math.min(index, rows.length - 1)); status.textContent = 'Карточка убрана из списка. Изменения применятся после сохранения набора.';
    } else if ((action === 'up' || action === 'down') && rows[index]) {
      const next = index + (action === 'up' ? -1 : 1);
      if (next < 0 || next >= rows.length) return;
      [rows[index], rows[next]] = [rows[next], rows[index]];
      focusCard(next, 0, action); status.textContent = `Карточка перемещена на место ${next + 1}.`;
    } else if (action === 'previous' || action === 'next') {
      page += action === 'previous' ? -1 : 1; renderRows();
      rowsRoot.querySelector('[data-card-field]')?.focus();
    } else if (action === 'append') {
      const error = root.querySelector('.deck-bulk-error'); error.textContent = '';
      try {
        const additions = parseBulkCards(root.querySelector(`#${prefix}-bulk`).value);
        // The untouched initial row is just a placeholder, not an existing card.
        const placeholder = !original.length && rows.length === 1 && !rows[0][0].trim() && !rows[0][1].trim();
        if ((placeholder ? 0 : rows.length) + additions.length > CARD_LIMIT) throw new Error('В одном наборе можно сохранить не больше 100 000 карточек.');
        if (placeholder) rows = [];
        const first = rows.length;
        for (const card of additions) rows.push(copy(card));
        root.querySelector(`#${prefix}-bulk`).value = '';
        focusCard(first); status.textContent = `Добавлено: ${countLabel(additions.length, ['карточка', 'карточки', 'карточек'])}.`;
      } catch (failure) { error.textContent = failure.message; }
    }
  };
  root.addEventListener('input', input);
  root.addEventListener('click', click);
  renderRows();
  return {
    getCards() {
      const cards = rows.map(card => [card[0].trim(), card[1].trim(), structuredClone(card[2])]);
      const invalid = cards.findIndex(card => !card[0] || !card[1]);
      if (invalid !== -1) {
        const error = new Error(`Карточка ${invalid + 1}: заполни термин и определение или удали карточку.`);
        error.cardIndex = invalid; throw error;
      }
      return cards;
    },
    getRemovedCards() {
      const remaining = new Set(rows.map(card => card[2].id));
      return original.filter(card => !remaining.has(String(card[2]?.id || '')));
    },
    focusCard,
    destroy() { root.removeEventListener('input', input); root.removeEventListener('click', click); },
  };
}
