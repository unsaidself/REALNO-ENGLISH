const escapeText = (value) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

const textKey = (value) => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function choosePairs(cards) {
  const byTerm = new Map();
  for (const card of shuffle(Array.isArray(cards) ? cards : [])) {
    if (!Array.isArray(card) || typeof card[0] !== 'string' || typeof card[1] !== 'string') continue;
    const term = textKey(card[0]);
    const definition = textKey(card[1]);
    if (!term || !definition) continue;
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term).push({ term, definition, card });
  }
  // Reassign earlier choices when necessary: a→1, a→2, b→1 can provide two
  // unique pairs (a→2 and b→1), rather than randomly shrinking to just one.
  const byDefinition = new Map();
  const assign = (term, visited) => {
    for (const candidate of byTerm.get(term)) {
      if (visited.has(candidate.definition)) continue;
      visited.add(candidate.definition);
      const previous = byDefinition.get(candidate.definition);
      if (!previous || assign(previous.term, visited)) {
        byDefinition.set(candidate.definition, candidate);
        return true;
      }
    }
    return false;
  };
  for (const term of byTerm.keys()) {
    assign(term, new Set());
    if (byDefinition.size === 6) break;
  }
  return [...byDefinition.values()].map(({ card }, index) => ({ id: String(index), card }));
}

function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const wholeSeconds = Math.floor(tenths / 10) % 60;
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${tenths % 10}`;
}

/** Mount an independent, timed matching round without modifying the source cards. */
export function mountMatching(container, cards, { esc = escapeText, icon = () => '', playSound = () => {}, onPair = () => {}, onMistake = () => {}, onFinish = () => {}, onExit = () => {}, sounds = true } = {}) {
  const pairs = choosePairs(cards);
  const selected = { term: null, definition: null };
  let startedAt = null;
  let seconds = 0;
  let matched = 0;
  let mistakes = 0;
  let destroyed = false;
  let finished = false;
  let resolving = false;
  let interval = null;
  let resetTimeout = null;

  const column = (side, label, cardIndex) => `<div class="match-column"><h4>${label}</h4>${shuffle(pairs).map(pair => `<button type="button" class="match-tile" data-side="${side}" data-match-id="${pair.id}" aria-pressed="false"><span class="match-tile-text">${esc(pair.card[cardIndex])}</span><span class="match-tile-check" aria-hidden="true">${icon('check')}</span></button>`).join('')}</div>`;
  container.innerHTML = `<section class="match-game" aria-label="Игра «Найди пару»">
    <div class="match-heading"><h3>Найди пару</h3><p>Соедини слово с его значением. Таймер начнёт отсчёт после первого нажатия.</p></div>
    ${pairs.length ? `<div class="match-meta"><div><span>Время</span><strong class="match-timer" role="timer" aria-label="Время раунда">0:00.0</strong></div><div><span>Найдено пар</span><strong class="match-count">0 / ${pairs.length}</strong></div><div><span>Ошибки</span><strong class="match-mistakes">0</strong></div></div>
      <div class="match-board">${column('term', 'Слово / вопрос', 0)}${column('definition', 'Значение / ответ', 1)}</div>
      <p class="match-message" role="status" aria-live="polite">Выбери карточку слева и её пару справа.</p>
      <div class="match-result" hidden></div>` : `<div class="empty-state"><b>Пока нет подходящих пар</b><p>Добавь карточки с непустыми словами и значениями.</p><button class="primary" type="button" data-match-exit>К набору</button></div>`}
  </section>`;

  const message = container.querySelector('.match-message');
  const result = container.querySelector('.match-result');
  const timer = container.querySelector('.match-timer');
  const clockNow = () => performance.now();
  const updateTime = () => {
    if (startedAt === null) return;
    seconds = (clockNow() - startedAt) / 1000;
    if (timer) timer.textContent = formatTime(seconds);
  };
  const stopTimer = () => {
    updateTime();
    if (interval !== null) clearInterval(interval);
    interval = null;
  };
  const startTimer = () => {
    if (startedAt !== null) return;
    startedAt = clockNow();
    interval = setInterval(updateTime, 100);
  };
  const clearSelection = () => {
    for (const side of ['term', 'definition']) {
      selected[side]?.classList.remove('is-selected', 'is-wrong');
      selected[side]?.setAttribute('aria-pressed', 'false');
      selected[side] = null;
    }
  };
  const complete = () => {
    if (finished || destroyed) return;
    finished = true;
    stopTimer();
    container.classList.add('match-complete');
    message.textContent = 'Все пары найдены!';
    result.hidden = false;
    result.innerHTML = `<div class="match-result-icon" aria-hidden="true">${icon('check')}</div><div class="eyebrow">Раунд завершён</div><h3>Все пары найдены!</h3><p>Твоё время: <strong>${formatTime(seconds)}</strong> · Ошибок: <strong>${mistakes}</strong></p><button class="primary" type="button" data-match-exit>К набору ${icon('arrow')}</button>`;
    result.querySelector('button')?.focus({ preventScroll: true });
    onFinish({ pairs: pairs.length, seconds: Math.round(seconds * 10) / 10, mistakes });
  };
  const resolvePair = () => {
    const term = selected.term;
    const definition = selected.definition;
    if (!term || !definition || destroyed || finished) return;
    if (term.dataset.matchId === definition.dataset.matchId) {
      const pair = pairs.find(item => item.id === term.dataset.matchId);
      term.classList.add('is-matched');
      definition.classList.add('is-matched');
      term.disabled = true;
      definition.disabled = true;
      clearSelection();
      matched++;
      container.querySelector('.match-count').textContent = `${matched} / ${pairs.length}`;
      message.textContent = matched === pairs.length ? 'Последняя пара найдена!' : 'Есть пара! Продолжай в том же духе.';
      playSound('match', sounds);
      onPair(pair.card);
      if (!destroyed && matched === pairs.length) complete();
      return;
    }
    resolving = true;
    mistakes++;
    container.querySelector('.match-mistakes').textContent = String(mistakes);
    term.classList.add('is-wrong');
    definition.classList.add('is-wrong');
    message.textContent = 'Эти карточки не подходят друг другу. Попробуй ещё раз.';
    playSound('wrong', sounds);
    onMistake(pairs.find(item => item.id === term.dataset.matchId).card);
    if (destroyed) return;
    resetTimeout = setTimeout(() => {
      resetTimeout = null;
      if (destroyed) return;
      clearSelection();
      resolving = false;
    }, 650);
  };
  const handleClick = (event) => {
    if (destroyed) return;
    const exitButton = event.target.closest?.('[data-match-exit]');
    if (exitButton && container.contains(exitButton)) { onExit(); return; }
    const tile = event.target.closest?.('.match-tile');
    if (!tile || !container.contains(tile) || tile.disabled || resolving || finished) return;
    const side = tile.dataset.side;
    if (side !== 'term' && side !== 'definition') return;
    startTimer();
    if (selected[side] === tile) {
      tile.classList.remove('is-selected');
      tile.setAttribute('aria-pressed', 'false');
      selected[side] = null;
      return;
    }
    selected[side]?.classList.remove('is-selected');
    selected[side]?.setAttribute('aria-pressed', 'false');
    selected[side] = tile;
    tile.classList.add('is-selected');
    tile.setAttribute('aria-pressed', 'true');
    resolvePair();
  };
  container.addEventListener('click', handleClick);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopTimer();
      if (resetTimeout !== null) clearTimeout(resetTimeout);
      resetTimeout = null;
      container.removeEventListener('click', handleClick);
    },
  };
}
