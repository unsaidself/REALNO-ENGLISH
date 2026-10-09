import { ensurePracticeData, localDay, getDueCards, scheduleReview, recordDaily, dailyProgress, activityCalendar, studyStreak, reclassifyAnswer, recordCardAnswer, getWeakCards, learnedCardCount } from './practice.js';
import { unlockAudio, playSound, speakText, stopAudio, storeAttachment, removeAttachment, attachmentMarkup, hydrateAttachments, releaseMediaUrls } from './media.js';
import { mountMatching } from './matching.js';
import { buildCloze, buildListening, evaluateCloze, evaluateListening, answerVariants, normalizeTypedAnswer, matchesTypedAnswer } from './exercises.js';
import { ensureRankData, rankProgress, awardRankXP } from './ranks.js';
import { ranksPage, storagePage, bindStorage } from './pages.js';
import { mountPronunciation } from './pronunciation.js';
import { createStateStore } from './state-store.js';
import { mountDeckEditor } from './deck-editor.js';
import { attachmentReferences, collectUnreferencedAttachments, deleteSet as deleteSetData, resetSetProgress, resetAllProgress } from './data-operations.js';
let storageProblem = null;
const stateStore = createStateStore({ onError: error => { storageProblem = error; updateStorageStatus(); } });
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  layers: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chart: '<path d="M4 3v18h18M8 16v-5m5 5V6m5 10V9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  book: '<path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
  trophy: '<path d="M7 3h10v5a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4M12 13v6M8 21h8M9 19h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  rotate: '<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2m4 0h2m-8 4h2"/>',
  pencil: '<path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5M4 15l5 5"/>',
};
Object.assign(icons, {
  sound: '<path d="m11 4-6 5H2v6h3l6 5zM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5zM16 9l5 6m-5 0 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-2 2 2 3 3 1 1 3h6l1-3 3-1 2-3-2-2 2-2-2-3-3-1-1-3z"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  game: '<rect x="2" y="3" width="8" height="18" rx="2"/><rect x="14" y="3" width="8" height="18" rx="2"/><path d="m5 12 2 2 2-4m8 2h2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 5-5 4 4 4-7 5 8"/>',
  wave: '<path d="M6 8v8M12 4v16M18 7v10"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  import: '<path d="M14 3h6v18H4v-6M3 8h11m-4-4 4 4-4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
});
const icon = (name) => `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const symbols = [
  { name: 'letters', label: 'Слова', glyph: 'Aa' },
  { name: 'numbers', label: 'Факты', glyph: '01' },
  { name: 'book', label: 'Книга' },
  { name: 'globe', label: 'Мир' },
  { name: 'calendar', label: 'Даты' },
  { name: 'target', label: 'Цель' },
];
const symbolIcon = (item) => item.glyph ? `<span class="symbol-glyph">${item.glyph}</span>` : icon(item.name);
const profileName = () => String(data.settings.name || 'Ученик').trim() || 'Ученик';
let data;
try { data = await stateStore.load({ sets: [], categories: [], learned: 0, answers: 0, days: [] }); }
catch (error) {
  const panel = document.createElement('section'); panel.className = 'startup-error';
  const title = document.createElement('h1'); title.textContent = 'Не удалось открыть хранилище';
  const message = document.createElement('p'); message.textContent = error.message;
  const retry = document.createElement('button'); retry.className = 'primary'; retry.textContent = 'Повторить запуск'; retry.onclick = () => location.reload();
  panel.append(title, message, retry); document.getElementById('app').replaceChildren(panel);
  throw error;
}
ensurePracticeData(data);
data.learned = Number(data.learned) || 0;
data.answers = Number(data.answers) || 0;
const cleanCategory = value => String(value || '').trim().replace(/\s+/g, ' ');
const categoryKey = value => cleanCategory(value).toLocaleLowerCase('ru');
function prepareData(value) {
  ensurePracticeData(value); ensureRankData(value);
  if (!Number.isFinite(value.backupReminderSince) || value.backupReminderSince <= 0) value.backupReminderSince = Date.now();
  value.settings.name = typeof value.settings.name === 'string' && value.settings.name.trim() ? value.settings.name.trim().slice(0, 40) : 'Ученик';
  value.categories = [...(Array.isArray(value.categories) ? value.categories : []), ...value.sets.map(s => s.category)].reduce((list, value) => {
  const name = cleanCategory(value);
  if (name && !list.some(c => categoryKey(c) === categoryKey(name))) list.push(name);
  return list;
}, []);
  value.sets.forEach(s => { s.category = value.categories.find(c => categoryKey(c) === categoryKey(s.category)) || ''; if (s.color === 'neutral') delete s.color; });
  return value;
}
prepareData(data);
let page = 'home', filter = null, query = '', session = null, direction = 'normal';
let toastTimer, matchController, pronunciationController, deckEditorController, modalReturnFocus = null, speechUIRequest = 0;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => String(value).toLowerCase().replace(/ё/g, 'е').replace(/[.,!?]/g, '').trim().replace(/\s+/g, ' ');
const shuffle = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};
const word = (n, forms) => forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
const countLabel = (n, forms) => `${n} ${word(n, forms)}`;
const sound = kind => playSound(kind, data.settings.sounds);
function save() { return stateStore.save(data); }
async function saveNow() { await stateStore.commit(data); return true; }
async function commitReplacement(next) {
  try { await stateStore.commit(next); }
  catch (error) { stateStore.save(data); throw error; }
  data = next;
}
function updateStorageStatus() {
  const notice = document.querySelector('#storage-state');
  if (notice) { notice.hidden = !storageProblem; notice.querySelector('p').textContent = storageProblem?.message || ''; }
  const dialog = document.querySelector('.modal');
  let alert = dialog?.querySelector('.modal-storage-error');
  if (dialog && storageProblem) {
    if (!alert) { alert = document.createElement('p'); alert.className = 'storage-state modal-storage-error'; alert.setAttribute('role', 'alert'); dialog.prepend(alert); }
    alert.textContent = storageProblem.message;
  } else alert?.remove();
}
stateStore.subscribe(status => { storageProblem = status.error; updateStorageStatus(); });
function notify(message) {
  document.querySelector('.toast')?.remove(); clearTimeout(toastTimer);
  const toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status');
  toast.innerHTML = `${icon('check')}<span>${esc(message)}</span>`; document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 3500);
}
function cleanupSession() { deckEditorController?.destroy(); deckEditorController = null; matchController?.destroy(); matchController = null; pronunciationController?.destroy(); pronunciationController = null; stopAudio(); releaseMediaUrls(); }
function applyTheme(settings = data.settings) {
  const theme = settings.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = settings.accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14211f' : '#f5f7f3');
}
function visual(set) {
  const fallback = 'letters';
  const symbol = symbols.find(item => item.name === set.symbol) || symbols.find(item => item.name === fallback);
  return `<div class="set-symbol neutral">${symbolIcon(symbol)}</div>`;
}
function goPage(next) { cleanupSession(); session = null; page = next; render(); }
function findSet(id) { return data.sets.find(set => String(set.id) === String(id)); }
function lastStudySet() { return findSet(data.lastStudySetId) || data.sets.find(set => set.cards.length) || data.sets[0]; }
function rememberStudy(set, card = null) {
  const realSet = set.id === null && card ? data.sets.find(item => item.cards.some(entry => entry[2].id === card[2].id)) : findSet(set.id);
  if (realSet && data.lastStudySetId !== realSet.id) { data.lastStudySetId = realSet.id; save(); }
}
function resumeStudy() { if (getDueCards(data).length) startReview(); else { const set = lastStudySet(); set ? openSet(set.id) : editor(); } }
function render() {
  cleanupSession(); session = null;
  document.body.classList.remove('has-modal');
  applyTheme(data.settings);
  const username = profileName(), avatar = [...username][0].toLocaleUpperCase('ru');
  const titles = { home: `Привет, ${esc(username)}`, sets: 'Мои наборы', stats: 'Твой прогресс', ranks: 'Твои ранги', storage: 'Копии и импорт', settings: 'Настройки' };
  const descriptions = { home: 'Карточки, игры и небольшая практика каждый день.', sets: 'Свои категории, слова, картинки и аудио.', stats: 'Смотри, как занятия складываются в привычку.', ranks: 'Набирай опыт, открывай ранги и замечай свой рост.', storage: 'Сохрани всё на устройстве или перенеси карточки из других приложений.', settings: 'Выбери оформление, звуки и удобную ежедневную цель.' };
  const title = titles[page];
  document.querySelector('#app').innerHTML = `
    <aside><a class="logo" href="#" aria-label="zhekandus, главная">zhekandus</a><div class="workspace">Твоё обучение</div>
      <nav>${[['home', 'Главная', 'home'], ['sets', 'Мои наборы', 'layers'], ['stats', 'Прогресс', 'chart'], ['ranks', 'Ранги', 'trophy'], ['storage', 'Копии и импорт', 'archive'], ['settings', 'Настройки', 'settings']].map(([p, label, glyph]) => `<button class="nav ${page === p ? 'active' : ''}" data-page="${p}" aria-label="${label}" title="${label}" ${page === p ? 'aria-current="page"' : ''}>${icon(glyph)}${label}${p === 'sets' ? `<small>${data.sets.length}</small>` : ''}</button>`).join('')}</nav>
      <div class="side-note"><b>Свой ритм, своя цель</b><p>${countLabel(data.settings.goal, ['ответ', 'ответа', 'ответов'])} в день. Сложные карточки вернутся раньше, знакомые — позже.</p><button class="text-button" id="sidebar-review">Повторить сегодня ${icon('arrow')}</button></div>
      <div class="profile"><div class="avatar">${esc(avatar)}</div><div><b>${esc(username)}</b><small>Моя коллекция</small></div></div></aside>
    <main><header><div class="breadcrumb">zhekandus <span>/</span> ${page === 'home' ? 'Главная' : titles[page]}</div><div class="header-right"><button class="icon-button ${data.settings.sounds ? 'is-on' : ''}" id="sound-toggle" aria-pressed="${data.settings.sounds}" title="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки" aria-label="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки">${icon(data.settings.sounds ? 'sound' : 'mute')}</button><button class="icon-button" id="settings" aria-label="Открыть настройки" title="Тема и настройки">${icon('settings')}</button><div class="avatar small" title="${esc(username)}">${esc(avatar)}</div></div></header>
      <div class="content"><div class="welcome"><div><h1>${title}</h1><p>${descriptions[page]}</p></div>${['home', 'sets'].includes(page) ? `<button class="primary" id="create">${icon('plus')} Создать набор</button>` : ''}</div><section id="storage-state" class="storage-state" role="alert" hidden><p></p><button class="secondary" id="retry-storage">Повторить сохранение</button><button class="text-button" id="storage-backup">Сделать резервную копию</button></section>
      ${page === 'settings' ? settingsPage() : page === 'ranks' ? ranksPage(data, icon, esc) : page === 'storage' ? storagePage(icon, data) : page === 'stats' ? statsCards() + calendarPanel() + statsPanel() : `${page === 'home' ? hero() + backupReminder() + dashboard() + statsCards() : ''}<section class="collection"><div class="section-heading"><h2>Твои наборы <span>${data.sets.length}</span></h2><label class="search">${icon('search')}<input id="search" aria-label="Найти набор" placeholder="Найти набор…" value="${esc(query)}"></label></div><div class="tabs" aria-label="Категории"><button data-filter="*" data-all="true" class="${filter === null ? 'selected' : ''}">Все наборы</button>${data.categories.map(c => `<button data-filter="${esc(c)}" class="${c === filter ? 'selected' : ''}">${esc(c)}</button>`).join('')}</div><div class="grid" id="sets-grid">${setCards()}</div></section>`}</div>
    </main><div id="modal-root"></div>`;
  bind();
  updateStorageStatus();
}
function hero() {
  const set = lastStudySet(), due = getDueCards(data);
  if (!set) return `<section class="continue-panel empty-collection"><span class="panel-label">Твоя коллекция</span><h2>Начни с первого набора</h2><p>Добавь слова, выражения или факты, которые хочешь запомнить.</p><div class="study-actions"><button class="primary" id="quick">${icon('plus')} Создать набор</button><button class="secondary" id="empty-import">${icon('import')} Импорт</button></div></section>`;
  return `<section class="continue-panel"><div><span class="panel-label">Продолжить</span><h2>${esc(set.title)}</h2><p>${countLabel(due.length, ['карточка', 'карточки', 'карточек'])} на сегодня · ${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])} в последнем наборе</p></div><button class="primary" id="quick">${due.length ? 'Повторить сегодня' : 'Продолжить'} ${icon('arrow')}</button></section>`;
}
function backupReminder() {
  const last = Number.isFinite(data.lastBackupAt) && data.lastBackupAt > 0 ? data.lastBackupAt : data.backupReminderSince;
  if (!data.sets.length || Date.now() - last <= 7 * 86400000) return '';
  return `<section class="backup-reminder" id="backup-reminder" role="note"><div>${icon('archive')}<b>Пора сделать резервную копию</b><p>${data.lastBackupAt ? 'С последней копии прошло больше недели.' : 'Сохрани наборы, прогресс и вложения отдельным файлом.'}</p></div><button class="secondary" id="backup-reminder-open">Сделать копию ${icon('arrow')}</button></section>`;
}
function dashboard() {
  const due = getDueCards(data), daily = dailyProgress(data);
  return `<div class="dashboard-row"><section class="review-panel"><span class="panel-label">${icon('rotate')} Интервальное повторение</span><h2>${due.length ? `${due.length} ${word(due.length, ['карточка', 'карточки', 'карточек'])} на сегодня` : 'Всё повторено'}</h2><p>${due.length ? 'Новые и забытые карточки — первыми. Следующий повтор зависит от твоего ответа.' : 'Следующие карточки появятся, когда подойдёт время повторения.'}</p><button class="primary" id="start-review" ${!due.length ? 'disabled' : ''}>Повторить ${icon('arrow')}</button></section><section class="goal-panel"><div><span class="panel-label">${icon('target')} Ежедневная цель</span><h2>${daily.complete ? 'Цель выполнена!' : 'Немного каждый день'}</h2><p>${daily.answers} из ${countLabel(daily.goal, ['ответ', 'ответа', 'ответов'])} сегодня</p><button class="text-button" id="change-goal">Изменить цель</button></div><div class="goal-ring" style="--progress:${Math.min(daily.percent, 100)}%"><span><b>${Math.round(daily.percent)}%</b><small>сегодня</small></span></div></section></div>`;
}
function statsCards() {
  const streak = studyStreak(data), learnedCards = learnedCardCount(data);
  return `<div class="stats-row"><div><span class="stat-icon neutral">${icon('layers')}</span><section><strong>${data.sets.length}</strong><p>${word(data.sets.length, ['набор', 'набора', 'наборов'])} в коллекции</p></section></div><div><span class="stat-icon green">${icon('book')}</span><section><strong id="learned-cards">${learnedCards}</strong><p>Выучено карточек</p></section></div><div><span class="stat-icon green">${icon('check')}</span><section><strong id="correct-answers">${data.learned}</strong><p>${word(data.learned, ['правильный ответ', 'правильных ответа', 'правильных ответов'])}</p></section></div><div><span class="stat-icon orange">${icon('bolt')}</span><section><strong>${streak} <small>${word(streak, ['день', 'дня', 'дней'])}</small></strong><p>серия занятий</p></section></div></div>`;
}
function statsPanel() {
  const accuracy = data.answers ? Math.round(data.learned / data.answers * 100) : 0;
  return `<section class="progress-panel"><span class="panel-label">Результаты всех занятий</span><h2>Точность ответов</h2><strong>${accuracy}%</strong><div class="progress-track"><i style="width:${accuracy}%"></i></div><p>${data.answers} ответов · ${countLabel(data.days.length, ['день', 'дня', 'дней'])} с занятиями</p><button class="primary" id="quick">Продолжить ${icon('arrow')}</button></section>`;
}
function calendarPanel() {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  const days = activityCalendar(data, year, month), blanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const today = localDay();
  return `<section class="calendar-panel"><div class="calendar-header"><div><span class="panel-label">Твои занятия</span><h2>${calendarMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2></div><div><button class="icon-button" id="calendar-prev" aria-label="Предыдущий месяц">‹</button><button class="icon-button" id="calendar-next" aria-label="Следующий месяц">›</button></div></div><div class="calendar-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="calendar-weekday">${d}</div>`).join('')}${Array.from({ length: blanks }, () => '<div class="calendar-blank"></div>').join('')}${days.map(day => `<div class="calendar-day ${day.answers ? 'is-active' : ''} ${day.date === today ? 'is-today' : ''} ${day.goalMet ? 'goal-met' : ''} ${day.date > today ? 'is-future' : ''}" data-date="${day.date}" title="${day.date}: ${countLabel(day.answers, ['ответ', 'ответа', 'ответов'])}${day.goalMet ? ', цель выполнена' : ''}"><b>${day.day}</b><span aria-label="${countLabel(day.answers, ['ответ', 'ответа', 'ответов'])}">${day.answers ? `${day.answers} <span class="calendar-answer-label">${word(day.answers, ['ответ', 'ответа', 'ответов'])}</span>` : '—'}</span>${day.goalMet ? icon('check') : ''}</div>`).join('')}</div><p class="calendar-caption">В ячейке — число ответов за день. Галочка — выполненная дневная цель.</p></section>`;
}
function settingsPage() {
  const prefs = data.settings;
  return `<section class="settings-panel"><div class="setting-group"><h2>Профиль</h2><label for="profile-name">Имя</label><input id="profile-name" name="name" type="text" maxlength="40" value="${esc(prefs.name || 'Ученик')}" placeholder="Ученик" autocomplete="nickname"></div><div class="setting-group"><h2>${icon('moon')} Тема</h2><p>Светлая, тёмная или как на устройстве.</p><div class="theme-options">${[['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon'], ['system', 'Системная', 'settings']].map(([value, label, glyph]) => `<button class="secondary ${prefs.theme === value ? 'selected' : ''}" data-theme-choice="${value}" aria-pressed="${prefs.theme === value}">${icon(glyph)}${label}</button>`).join('')}</div></div><div class="setting-group"><h2>Акцентный цвет</h2><div class="accent-options">${[['teal', 'Зелёный'], ['blue', 'Синий'], ['orange', 'Терракота'], ['rose', 'Розовый'], ['graphite', 'Графит']].map(([value, label]) => `<button class="accent-swatch ${prefs.accent === value ? 'selected' : ''}" data-accent-choice="${value}" aria-label="${label}" aria-pressed="${prefs.accent === value}"><span></span>${label}</button>`).join('')}</div></div><div class="setting-group"><h2>${icon('target')} Ежедневная цель</h2><label class="goal-label" for="daily-goal">Ответов в день</label><input id="daily-goal" type="number" min="1" max="500" step="1" value="${prefs.goal}"><p>Считаются ответы в карточках, тестах, запоминании и игре.</p></div><div class="setting-row"><div><h2>${icon('sound')} Звуки</h2><p>Ответы, переворот карточек, совпадения и серии.</p></div><label class="toggle"><input type="checkbox" id="setting-sounds" ${prefs.sounds ? 'checked' : ''}><span></span><b>${prefs.sounds ? 'Включены' : 'Выключены'}</b></label></div><div class="setting-group speech-settings"><h2>${icon('sound')} Озвучка слов</h2><label for="speech-voice">Голосовой движок</label><select id="speech-voice"><option value="auto" ${(prefs.speechVoice || 'auto') === 'auto' ? 'selected' : ''}>Автоматически — голос устройства и локальный запасной</option><option value="offline" ${prefs.speechVoice === 'offline' ? 'selected' : ''}>Встроенный локальный голос</option></select><label for="speech-rate">Скорость <b id="speech-rate-label">${prefs.speechRate || .9}×</b></label><input type="range" id="speech-rate" min="0.5" max="1.5" step="0.1" value="${prefs.speechRate || .9}"><p>Английский и русский работают без скачивания системных голосов. Встроенный голос звучит более механически.</p><button class="secondary" id="speech-demo">${icon('sound')} Проверить озвучку</button></div><div id="settings-error" class="form-error" role="alert"></div><p class="settings-autosave">Изменения сохраняются автоматически.</p><section class="danger-zone"><h2>Сброс обучения</h2><p>Начни заново: статистика, расписание повторений и опыт рангов будут обнулены.</p><button class="secondary danger-text" id="reset-all-progress">Сбросить весь прогресс</button></section></section>`;
}
function setCards() {
  const needle = normalize(query);
  const sets = data.sets.filter(s => (filter === null || s.category === filter) && (normalize(`${s.title} ${s.desc}`).includes(needle) || s.cards.some(card => normalize(`${card[0]} ${card[1]}`).includes(needle))));
  return `${!sets.length ? data.sets.length ? '<div class="empty-state"><b>Ничего не найдено</b><p>Измени поиск или создай новый набор.</p></div>' : '<div class="empty-state"><b>Здесь появятся твои наборы</b><p>Создай набор или перенеси карточки через импорт.</p><button class="secondary" id="empty-grid-import">Импорт</button></div>' : ''}${sets.map(s => `<article class="set-card" data-set="${esc(s.id)}" tabindex="0" aria-label="Открыть ${esc(s.title)}"><div class="set-top">${visual(s)}<span class="category">${esc(s.category)}</span><button class="more" data-edit="${esc(s.id)}" aria-label="Редактировать набор">${icon('pencil')}</button></div><h3>${esc(s.title)}</h3><p>${esc(s.desc)}</p><div class="set-footer"><span>${icon('layers')} ${countLabel(s.cards.length, ['карточка', 'карточки', 'карточек'])}</span><span class="open-arrow">${icon('arrow')}</span></div></article>`).join('')}<button class="new-set" id="create-card"><span>${icon('plus')}</span><b>Новый набор</b><p>Слова, факты и свои категории</p></button>`;
}
function bind() {
  document.querySelector('#retry-storage').onclick = async () => { try { await saveNow(); } catch {} };
  document.querySelector('#storage-backup').onclick = () => goPage('storage');
  document.querySelector('#backup-reminder-open')?.addEventListener('click', () => goPage('storage'));
  document.querySelector('.logo').onclick = e => { e.preventDefault(); goPage('home'); };
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => goPage(button.dataset.page));
  document.querySelector('#settings').onclick = () => goPage('settings');
  document.querySelector('#sound-toggle').onclick = () => {
    data.settings.sounds = !data.settings.sounds;
    if (!data.settings.sounds) stopAudio(); else sound('click');
    save(); render(); notify(`Звуки ${data.settings.sounds ? 'включены' : 'выключены'}`);
  };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.hasAttribute('data-all') ? null : button.dataset.filter; render(); });
  document.querySelector('#search')?.addEventListener('input', e => { query = e.target.value; document.querySelector('#sets-grid').innerHTML = setCards(); bindSets(); });
  document.querySelector('#create')?.addEventListener('click', () => editor());
  document.querySelector('#quick')?.addEventListener('click', resumeStudy);
  document.querySelector('#empty-import')?.addEventListener('click', () => goPage('storage'));
  document.querySelector('#start-review')?.addEventListener('click', () => startReview());
  document.querySelector('#sidebar-review').onclick = () => startReview();
  document.querySelector('#change-goal')?.addEventListener('click', () => { goPage('settings'); document.querySelector('#daily-goal').focus(); });
  document.querySelector('#calendar-prev')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); render(); });
  document.querySelector('#calendar-next')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); render(); });
  if (page === 'settings') bindSettings();
  document.querySelector('#ranks-practice')?.addEventListener('click', resumeStudy);
  if (page === 'storage') bindStorage({ getData: () => data, esc, notify, countLabel, onBackup: timestamp => { data.lastBackupAt = timestamp; save(); },
    onRestore: async restored => {
      const next = prepareData(restored);
      await commitReplacement(next);
      filter = null; query = ''; return true;
    },
    onImport: async sets => {
      const next = structuredClone(data);
      let id = Math.max(Date.now(), ...next.sets.map(set => Number(set.id) + 1).filter(Number.isFinite));
      next.sets.push(...sets.map(set => ({ ...set, id: id++, desc: set.desc || '', category: set.category || '', symbol: set.symbol || 'letters' })));
      prepareData(next); await commitReplacement(next);
      filter = null; query = ''; return true;
    }, onSuccess: () => goPage('sets'),
  });
  bindSets();
}
function bindSettings() {
  const updateProfile = () => {
    const name = profileName(), avatar = [...name][0].toLocaleUpperCase('ru');
    document.querySelector('.profile b').textContent = name;
    document.querySelectorAll('.avatar').forEach(node => { node.textContent = avatar; if (node.classList.contains('small')) node.title = name; });
  };
  document.querySelector('#profile-name').oninput = e => { data.settings.name = e.target.value.trim() || 'Ученик'; save(); updateProfile(); };
  document.querySelector('#profile-name').onblur = e => { e.target.value = profileName(); };
  document.querySelector('#daily-goal').oninput = e => {
    const goal = Number(e.target.value), valid = Number.isInteger(goal) && goal >= 1 && goal <= 500;
    e.target.setAttribute('aria-invalid', String(!valid));
    document.querySelector('#settings-error').textContent = valid ? '' : 'Выбери цель от 1 до 500 ответов. Пока действует предыдущая цель.';
    if (valid) { data.settings.goal = goal; save(); }
  };
  const choose = (key, value, selector) => { data.settings[key] = value; save(); render(); document.querySelector(selector)?.focus({ preventScroll: true }); };
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => choose('theme', button.dataset.themeChoice, `[data-theme-choice="${button.dataset.themeChoice}"]`));
  document.querySelectorAll('[data-accent-choice]').forEach(button => button.onclick = () => choose('accent', button.dataset.accentChoice, `[data-accent-choice="${button.dataset.accentChoice}"]`));
  document.querySelector('#setting-sounds').onchange = e => {
    data.settings.sounds = e.target.checked; save();
    e.target.parentElement.querySelector('b').textContent = e.target.checked ? 'Включены' : 'Выключены';
    const toggle = document.querySelector('#sound-toggle');
    toggle.classList.toggle('is-on', e.target.checked); toggle.setAttribute('aria-pressed', String(e.target.checked));
    toggle.title = `${e.target.checked ? 'Выключить' : 'Включить'} звуки`; toggle.setAttribute('aria-label', toggle.title); toggle.innerHTML = icon(e.target.checked ? 'sound' : 'mute');
    if (e.target.checked) playSound('click', true); else stopAudio();
  };
  document.querySelector('#speech-rate').oninput = e => { data.settings.speechRate = Number(e.target.value); document.querySelector('#speech-rate-label').textContent = `${data.settings.speechRate}×`; save(); };
  document.querySelector('#speech-voice').onchange = e => { data.settings.speechVoice = e.target.value; save(); };
  document.querySelector('#speech-demo').onclick = e => pronounce('Learning a little every day makes a difference.', e.currentTarget);
  document.querySelector('#reset-all-progress').onclick = () => confirmDataAction({ title: 'Сбросить весь прогресс?', description: 'Будут обнулены ответы, календарь занятий, расписание повторений, результаты карточек и опыт рангов. Наборы, вложения и настройки сохранятся.', label: 'Сбросить прогресс', cancel: () => goPage('settings'), confirm: async () => { await commitReplacement(resetAllProgress(data)); goPage('settings'); notify('Весь прогресс сброшен'); } });
}
function bindSets() {
  document.querySelectorAll('[data-set]').forEach(card => { card.onclick = () => openSet(card.dataset.set); card.onkeydown = e => { if (e.target === card && ['Enter', ' '].includes(e.key)) { e.preventDefault(); card.click(); } }; });
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = e => { e.stopPropagation(); editor(findSet(button.dataset.edit)); });
  document.querySelector('#empty-grid-import')?.addEventListener('click', () => goPage('storage'));
  if (document.querySelector('#create-card')) document.querySelector('#create-card').onclick = () => editor();
}
function modal(html) {
  cleanupSession();
  const origin = document.activeElement;
  if (!origin.closest('.modal')) modalReturnFocus = origin.id ? `#${CSS.escape(origin.id)}` : origin.dataset.edit ? `[data-edit="${CSS.escape(origin.dataset.edit)}"]` : origin.dataset.set ? `[data-set="${CSS.escape(origin.dataset.set)}"]` : null;
  document.querySelector('#modal-root').innerHTML = `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-label="${session ? 'Занятие' : 'Набор карточек'}"><button class="close" aria-label="Закрыть">${icon('close')}</button>${html}</div></div>`;
  document.querySelectorAll('#app > aside, #app > main').forEach(node => { node.inert = true; });
  document.body.classList.add('has-modal');
  document.querySelector('.close').onclick = () => { cleanupSession(); session = null; render(); if (modalReturnFocus) document.querySelector(modalReturnFocus)?.focus({ preventScroll: true }); modalReturnFocus = null; };
  document.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) document.querySelector('.close').click(); };
  document.querySelector('.close').focus({ preventScroll: true });
  updateStorageStatus();
}
function editor(set) {
  session = null; const selectedSymbol = symbols.some(s => s.name === set?.symbol) ? set.symbol : 'letters';
  modal(`<div class="eyebrow">Мои наборы</div><h2>${set ? 'Редактировать набор' : 'Новый набор'}</h2><p>Меняй карточки по отдельности или добавляй сразу из текста.</p><form id="editor"><label>Название<input name="title" required maxlength="80" value="${esc(set?.title || '')}" placeholder="Например, английский для поездок"></label><label>Описание<input name="desc" maxlength="120" value="${esc(set?.desc || '')}" placeholder="О чём этот набор?"></label><label>Категория<input name="category" list="category-suggestions" maxlength="40" value="${esc(set?.category || filter || '')}" placeholder="Придумай свою категорию"><small>Название категории необязательно. Новая категория появится после сохранения.</small></label><datalist id="category-suggestions">${data.categories.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist><fieldset class="symbol-field"><legend>Иконка набора</legend><div class="symbol-options">${symbols.map(item => `<label class="symbol-choice"><input type="radio" name="symbol" value="${item.name}" ${item.name === selectedSymbol ? 'checked' : ''}><span>${symbolIcon(item)}<small>${item.label}</small></span></label>`).join('')}</div></fieldset><div id="deck-editor-root"></div><div class="form-error" id="form-error" role="alert"></div><button class="primary" type="submit">${icon('check')} Сохранить набор</button></form>`);
  const controller = mountDeckEditor(document.querySelector('#deck-editor-root'), set?.cards || [], { esc, icon, countLabel });
  deckEditorController = controller;
  document.querySelector('#editor').onsubmit = async e => {
    e.preventDefault(); const form = new FormData(e.target), errorBox = document.querySelector('#form-error');
    let cards;
    try { cards = controller.getCards(); } catch (error) { errorBox.textContent = error.message; if (Number.isInteger(error.cardIndex)) controller.focusCard(error.cardIndex); return; }
    const title = form.get('title').trim(), name = cleanCategory(form.get('category'));
    if (!title) { errorBox.textContent = 'Название не может быть пустым.'; return; }
    const category = data.categories.find(c => categoryKey(c) === categoryKey(name)) || name;
    const symbol = symbols.find(s => s.name === form.get('symbol')) || symbols[0];
    const next = structuredClone(data);
    const item = { ...set, id: set?.id ?? crypto.randomUUID(), title, desc: form.get('desc').trim(), category, cards, symbol: symbol.name };
    if (category && !next.categories.includes(category)) next.categories.push(category);
    if (set) next.sets = next.sets.map(s => String(s.id) === String(set.id) ? item : s); else next.sets.push(item);
    const removed = controller.getRemovedCards();
    for (const card of removed) { delete next.reviews[card[2].id]; if (next.cardStats) delete next.cardStats[card[2].id]; }
    prepareData(next);
    const controls = [...document.querySelector('.modal').querySelectorAll('button,input,textarea')];
    const disabled = controls.map(node => node.disabled); controls.forEach(node => { node.disabled = true; });
    try { await commitReplacement(next); }
    catch (error) { controls.forEach((node, i) => { node.disabled = disabled[i]; }); errorBox.textContent = error.message; return; }
    const obsolete = collectUnreferencedAttachments(data, attachmentReferences(removed));
    let cleanupFailed = false;
    for (const id of obsolete) try { await removeAttachment(id); } catch { cleanupFailed = true; }
    if (filter !== null) filter = category || null; query = '';
    render(); document.querySelector(`[data-set="${CSS.escape(String(item.id))}"]`)?.focus({ preventScroll: true }); sound('correct'); notify(cleanupFailed ? 'Набор сохранён. Часть удалённых вложений пока осталась в хранилище.' : 'Набор сохранён');
  };
}
function confirmDataAction({ title, description, label, cancel, confirm }) {
  session = null;
  modal(`<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="form-error" id="action-error" role="alert"></div><div class="study-actions"><button class="secondary" id="cancel-action">Отмена</button><button class="primary danger-button" id="confirm-action">${esc(label)}</button></div>`);
  document.querySelector('.modal').setAttribute('aria-label', title);
  document.querySelector('#cancel-action').onclick = cancel;
  document.querySelector('#cancel-action').focus({ preventScroll: true });
  document.querySelector('#confirm-action').onclick = async () => {
    const controls = [...document.querySelector('.modal').querySelectorAll('button')]; controls.forEach(button => { button.disabled = true; });
    try { await confirm(); }
    catch (error) { controls.forEach(button => { button.disabled = false; }); document.querySelector('#action-error').textContent = error.message; }
  };
}
function confirmSetDeletion(set) {
  confirmDataAction({ title: `Удалить «${set.title}»?`, description: `${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])}, их расписание и вложения будут удалены. Общие файлы, используемые другими карточками, сохранятся.`, label: 'Удалить набор', cancel: () => openSet(set.id), confirm: async () => {
    const result = deleteSetData(data, set.id); await commitReplacement(result.data);
    let cleanupFailed = false;
    for (const id of result.removeAttachmentIds) try { await removeAttachment(id); } catch { cleanupFailed = true; }
    filter = null; query = ''; goPage('sets'); document.querySelector('#create')?.focus({ preventScroll: true });
    notify(cleanupFailed ? 'Набор удалён. Часть его файлов пока осталась в хранилище.' : 'Набор удалён');
  } });
}
function confirmSetReset(set) {
  confirmDataAction({ title: `Сбросить прогресс «${set.title}»?`, description: 'Будут сброшены расписание и результаты этих карточек. Набор и вложения сохранятся. Общая история ответов, календарь и опыт рангов останутся.', label: 'Сбросить прогресс набора', cancel: () => openSet(set.id), confirm: async () => { await commitReplacement(resetSetProgress(data, set.id)); openSet(set.id); notify('Прогресс набора сброшен'); } });
}
const answerIndices = new WeakMap();
function answerIndex(set, currentDirection) {
  const side = currentDirection === 'reverse' ? 0 : 1;
  let cached = answerIndices.get(set);
  if (!cached || cached.cards !== set.cards) { cached = { cards: set.cards }; answerIndices.set(set, cached); }
  if (cached[side]) return cached[side];
  const options = [], seen = new Set(), groups = new Map();
  for (const card of set.cards) {
    const key = normalize(card[1 - side]);
    if (!groups.has(key)) groups.set(key, new Set());
    for (const alias of answerVariants(card[side])) groups.get(key).add(alias);
    const optionKey = normalize(card[side]);
    if (!seen.has(optionKey)) { seen.add(optionKey); options.push(card[side]); }
  }
  return cached[side] = { options, groups, variants: new Map(options.map(value => [value, answerVariants(value)])) };
}
function validAnswers(set, card, currentDirection) {
  const side = currentDirection === 'reverse' ? 0 : 1;
  return answerIndex(set, currentDirection).groups.get(normalize(card[1 - side])) || new Set(answerVariants(card[side]));
}
function distractors(set, card, currentDirection) {
  const valid = validAnswers(set, card, currentDirection), index = answerIndex(set, currentDirection);
  return index.options.filter(value => index.variants.get(value).length && !index.variants.get(value).some(alias => valid.has(alias)));
}
function cardPagination(pageIndex, total, name) {
  if (total <= 40) return '';
  return `<nav class="card-pagination" aria-label="Страницы карточек"><button class="secondary" data-${name}-page="${pageIndex - 1}" ${pageIndex === 0 ? 'disabled' : ''}>← Назад</button><span>${pageIndex * 40 + 1}–${Math.min((pageIndex + 1) * 40, total)} из ${total}</span><button class="secondary" data-${name}-page="${pageIndex + 1}" ${(pageIndex + 1) * 40 >= total ? 'disabled' : ''}>Далее →</button></nav>`;
}
function openSet(id, termsPage = 0) {
  session = null; const set = findSet(id); if (!set) return;
  const index = answerIndex(set, direction);
  const canTest = set.cards.length > 0 && [...index.groups.values()].every(valid => valid.size && index.options.some(value => index.variants.get(value).length && !index.variants.get(value).some(alias => valid.has(alias))));
  termsPage = Math.max(0, Math.min(termsPage, Math.ceil(set.cards.length / 40) - 1));
  const due = getDueCards(data, set.id), clozeCards = set.cards.filter(card => buildCloze(card)), weakCards = getWeakCards(data, set.id).slice(0, 20).map(entry => entry.card);
  modal(`${visual(set)}<h2>${esc(set.title)}</h2><p>${esc(set.desc)} · ${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])}</p><div class="direction-switch" aria-label="Направление обучения"><button data-direction="normal" class="${direction === 'normal' ? 'selected' : ''}">Термин → значение</button><button data-direction="reverse" class="${direction === 'reverse' ? 'selected' : ''}">Значение → термин</button></div><div class="mode-grid">${[['flash', 'layers', 'Карточки', 'Переворот, озвучка и повторение'], ['learn', 'book', 'Запоминание', 'Вводи ответ, ошибки вернутся'], ['test', 'target', 'Тест', 'Выбирай из 2–4 вариантов'], ['match', 'game', 'Найди пару', 'Сопоставь карточки на время'], ['review', 'rotate', 'Повторить', `${countLabel(due.length, ['карточка', 'карточки', 'карточек'])} по расписанию`], ['weak', 'target', 'Слабые карточки', `${countLabel(weakCards.length, ['карточка', 'карточки', 'карточек'])} с низкой точностью`], ['cloze', 'pencil', 'Пропуски', 'Вспоминай слова в предложениях'], ['listening', 'sound', 'Аудирование', 'Послушай и напиши слово'], ['pronunciation', 'mic', 'Произношение', 'Запиши и сравни с образцом']].map(([mode, glyph, label, desc]) => `<button data-mode="${mode}" ${mode === 'test' && !canTest || mode === 'review' && !due.length || mode === 'cloze' && !clozeCards.length || mode === 'weak' && !weakCards.length ? 'disabled' : ''}>${icon(glyph)}<div><b>${label}</b><span>${desc}</span></div>${icon('arrow')}</button>`).join('')}</div>${!canTest ? '<div class="study-banner">Для каждого вопроса нужен хотя бы один вариант, который не является другим правильным ответом. Добавь карточки с другими значениями или выбери другой режим.</div>' : ''}${!clozeCards.length ? '<p class="study-banner">Для пропусков добавь пример с самим словом или выражением в разделе «Картинки, аудио и примеры».</p>' : ''}${!weakCards.length ? '<p class="study-banner">После первых ответов появятся слабые карточки. Здесь собираются до 20 карточек с самой низкой долей правильных ответов.</p>' : ''}<button class="secondary" id="manage-media">${icon('image')} Картинки, аудио и примеры</button><div class="set-management"><button class="text-button" id="reset-set-progress">${icon('rotate')} Сбросить прогресс набора</button><button class="text-button danger-text" id="delete-set">${icon('close')} Удалить набор</button></div><div class="terms">${set.cards.slice(termsPage * 40, (termsPage + 1) * 40).map(c => `<div><b>${esc(c[0])}</b><span>${esc(c[1])}</span></div>`).join('')}</div>${cardPagination(termsPage, set.cards.length, 'terms')}`);
  document.querySelectorAll('[data-direction]').forEach(button => button.onclick = () => { direction = button.dataset.direction; openSet(id); sound('click'); });
  document.querySelector('#manage-media').onclick = () => mediaManager(set);
  document.querySelector('#delete-set').onclick = () => confirmSetDeletion(set);
  document.querySelector('#reset-set-progress').onclick = () => confirmSetReset(set);
  document.querySelectorAll('[data-terms-page]').forEach(button => button.onclick = () => openSet(id, Number(button.dataset.termsPage)));
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    if (button.dataset.mode === 'match') { startMatching(set); return; }
    if (button.dataset.mode === 'review') { startReview(set.id); return; }
    if (button.dataset.mode === 'pronunciation') { startPronunciation(set); return; }
    if (button.dataset.mode === 'weak') { beginStudy(set, 'weak', weakCards); return; }
    beginStudy(set, button.dataset.mode, shuffle(button.dataset.mode === 'cloze' ? clozeCards : set.cards));
  });
}
function beginStudy(set, mode, queue) {
  rememberStudy(set, queue[0]);
  session = { set, mode, direction: ['cloze', 'listening'].includes(mode) ? 'normal' : direction, index: 0, correct: 0, streak: 0, flipped: false, answered: false, results: [], options: null, queue };
  sound('click'); study();
}
function startReview(setId = null) {
  const entries = getDueCards(data, setId);
  if (!entries.length) { notify('На сегодня всё повторено. Можно потренироваться в любом наборе.'); return; }
  const set = setId === null ? { id: null, title: 'Повторение на сегодня', cards: entries.map(e => e.card) } : findSet(setId);
  beginStudy(set, 'review', entries.map(e => e.card));
}
function startMatching(set) {
  rememberStudy(set);
  session = { set, mode: 'match', correct: 0, streak: 0 };
  modal(`<div id="match-game"></div>`); sound('click');
  matchController = mountMatching(document.querySelector('#match-game'), set.cards, { esc, icon, playSound, sounds: data.settings.sounds,
    onPair: card => { record(true, card); if (session.streak % 3 === 0) celebrate(); },
    onMistake: card => { record(false, card); },
    onFinish: () => { sound('complete'); }, onExit: () => openSet(set.id),
  });
}
function startPronunciation(set, index = 0) {
  rememberStudy(set);
  session = null;
  modal(`<div class="eyebrow">Произношение · ${esc(set.title)}</div><div id="pronunciation-root"></div><div class="study-actions pronunciation-navigation"><button class="secondary" id="pronunciation-prev" ${!index ? 'disabled' : ''}>← Предыдущее слово</button><span>${index + 1} / ${set.cards.length}</span><button class="secondary" id="pronunciation-next" ${index === set.cards.length - 1 ? 'disabled' : ''}>Следующее слово →</button></div>`);
  pronunciationController = mountPronunciation(document.querySelector('#pronunciation-root'), set.cards[index], { esc, icon, pronounce, sound, notify, onExit: () => openSet(set.id) });
  document.querySelector('#pronunciation-prev').onclick = () => { if (index > 0) startPronunciation(set, index - 1); };
  document.querySelector('#pronunciation-next').onclick = () => { if (index < set.cards.length - 1) startPronunciation(set, index + 1); };
}
function choices(set, card, currentDirection) {
  const side = currentDirection === 'reverse' ? 0 : 1, correct = card[side];
  return shuffle([correct, ...shuffle(distractors(set, card, currentDirection)).slice(0, 3)]);
}
function studyTools(card, allowExample) {
  return `<div class="study-tools"><button class="secondary" id="speak-term">${icon('sound')} Прослушать${icon('wave')}</button>${card[2]?.example && allowExample ? `<button class="secondary" id="speak-example">${icon('sound')} Пример</button>` : ''}</div>${card[2]?.example && allowExample ? `<p class="card-example">${esc(card[2].example)}</p>` : ''}${attachmentMarkup(card, esc, { audio: allowExample })}`;
}
async function pronounce(text, button, options = {}) {
  const request = String(++speechUIRequest);
  document.querySelectorAll('.is-speaking').forEach(node => node.classList.remove('is-speaking'));
  document.querySelectorAll('.speech-status').forEach(node => { node.textContent = ''; });
  const parent = button?.closest('.modal, .speech-settings, .hero-preview');
  let status = parent?.querySelector('.speech-status');
  if (parent && !status) {
    status = document.createElement('p'); status.className = 'speech-status'; status.setAttribute('role', 'status');
    const tools = button.closest('.study-tools, .pronunciation-controls');
    if (tools) tools.after(status); else button.after(status);
  }
  if (status) { status.dataset.request = request; status.textContent = 'Готовлю озвучку…'; }
  button?.classList.add('is-speaking');
  button?.setAttribute('aria-busy', 'true');
  if (button) button.dataset.speechRequest = request;
  const cleanup = () => {
    if (button?.dataset.speechRequest === request) { button.classList.remove('is-speaking'); button.setAttribute('aria-busy', 'false'); }
    if (status?.dataset.request === request) status.textContent = '';
  };
  const result = await speakText(text, { voice: options.voice || data.settings.speechVoice || 'auto', rate: options.rate ?? data.settings.speechRate ?? .9, lang: options.lang,
    onStart: () => { if (status?.dataset.request === request) status.textContent = ''; },
    onEnd: event => { cleanup(); if (!event?.cancelled && !event?.error && (!event?.status || event.status === 'ended')) options.onEnd?.(); },
    onError: message => { options.onError?.(message); notify(message); },
  });
  if (!result.ok) { cleanup(); options.onError?.(result.message); notify(result.message || 'Не удалось включить озвучку.'); }
  return result;
}
function study() {
  const s = session; if (!s || s.index >= s.queue.length) { finish(); return; }
  const card = s.queue[s.index], reverse = s.direction === 'reverse';
  const cloze = s.mode === 'cloze' ? buildCloze(card) : null;
  const listening = s.mode === 'listening' ? buildListening(card) : null;
  const prompt = card[reverse ? 1 : 0], expected = cloze?.answer || listening?.answer || card[reverse ? 0 : 1];
  s.expected = expected;
  const isCard = ['flash', 'review', 'weak'].includes(s.mode);
  if (s.mode === 'test' && !s.options) s.options = choices(s.set, card, s.direction);
  const daily = dailyProgress(data), rank = rankProgress(data);
  let exercise;
  if (isCard) {
    exercise = `<button class="flashcard" id="flip" aria-label="${esc(prompt)}. Перевернуть карточку" aria-pressed="false"><div class="flashcard-inner"><div class="flash-face flash-front" aria-hidden="false"><span>${reverse ? 'Значение' : 'Термин'}</span><h2>${esc(prompt)}</h2></div><div class="flash-face flash-back" aria-hidden="true"><span>${reverse ? 'Термин' : 'Значение'}</span><h2>${esc(expected)}</h2></div></div><small class="flip-caption">${icon('rotate')} Нажми, чтобы перевернуть</small></button>${studyTools(card, true)}<div class="study-actions rating-actions"><button class="secondary" id="again">${icon('rotate')} Ещё повторить</button><button class="secondary" id="hard">${icon('wave')} Трудно</button><button class="primary" id="known">${icon('check')} Знаю</button><button class="secondary" id="easy">${icon('bolt')} Легко</button></div><p class="keyboard-hint"><kbd>Пробел</kbd> переворачивает · <kbd>1</kbd> ещё повторить · <kbd>2</kbd> знаю · <kbd>3</kbd> легко</p>`;
  } else {
    let question;
    if (cloze) question = `<div class="question"><span>Впиши пропущенное слово или выражение</span><p class="cloze-sentence">${esc(cloze.before)}<span class="cloze-blank" aria-label="Пропущенные слова">••••</span>${esc(cloze.after)}</p></div><div class="study-tools"><button class="secondary" id="speak-term">${icon('sound')} Послушать предложение ${icon('wave')}</button></div>`;
    else if (listening) question = `<div class="listening-card"><div class="listening-icon">${icon('sound')}</div><h2>Слушай и пиши</h2><p class="listening-prompt">Послушай слово или выражение и напиши то, что услышал.</p><button class="primary" id="speak-term">${icon('sound')} Прослушать ${icon('wave')}</button></div>`;
    else question = `<div class="question"><span>${s.mode === 'test' ? 'Выбери правильный ответ' : 'Вспомни ответ'}</span><h2>${esc(prompt)}</h2></div>${studyTools(card, !reverse)}`;
    const answer = s.mode === 'test' ? `<div class="answer-options" aria-label="Варианты ответа">${s.options.map((option, index) => `<button class="answer-option" data-choice="${index}"><span class="option-key">${index + 1}</span><span class="option-text">${esc(option)}</span><span class="option-status"></span></button>`).join('')}</div><p class="test-caption">Один правильный ответ · можно нажать цифру варианта</p><div id="feedback" role="status" aria-live="polite"></div><button class="primary" id="next-question" disabled>Выбери ответ ${icon('arrow')}</button>` : `<form id="answer-form"><input id="answer" aria-label="Твой ответ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${listening ? 'Напиши услышанное…' : cloze ? 'Пропущенное слово или выражение…' : 'Твой ответ…'}" required><div id="feedback" role="status" aria-live="polite"></div><button class="primary" type="submit">Проверить ${icon('arrow')}</button></form><button class="hint" id="hint">Нужна подсказка?</button>`;
    exercise = question + answer;
  }
  const labels = { weak: 'Слабые карточки', flash: 'Карточки', review: 'Интервальное повторение', test: 'Тест', learn: 'Запоминание', cloze: 'Пропуски', listening: 'Аудирование' };
  const directionLabel = cloze ? 'Предложение → слово' : listening ? 'Слушаю → пишу' : reverse ? 'Значение → термин' : 'Термин → значение';
  modal(`<div class="eyebrow">${labels[s.mode]} · ${esc(s.set.title)}</div><div class="study-meta"><span>${s.index + 1} / ${s.queue.length}</span><span class="direction-badge">${directionLabel}</span><span class="streak ${s.streak >= 3 ? 'is-hot' : ''}">${icon('bolt')} <span>${s.streak} подряд</span></span></div><div class="progress-track"><i style="width:${s.index / s.queue.length * 100}%"></i></div>${exercise}<p class="study-daily">Сегодня: ${daily.answers} / ${daily.goal} ответов</p><p class="study-xp">${rank.name} · ${rank.xp} XP</p>`);
  hydrateAttachments(document.querySelector('.modal'));
  document.querySelector('#speak-term').onclick = e => pronounce(cloze?.sentence || listening?.prompt || (isCard ? card[0] : prompt), e.currentTarget);
  document.querySelector('#speak-example')?.addEventListener('click', e => pronounce(card[2].example, e.currentTarget));
  if (isCard) {
    document.querySelector('#flip').onclick = e => {
      s.flipped = !s.flipped; e.currentTarget.classList.toggle('is-flipped', s.flipped); e.currentTarget.setAttribute('aria-pressed', String(s.flipped));
      e.currentTarget.setAttribute('aria-label', `${s.flipped ? expected : prompt}. Перевернуть карточку`);
      e.currentTarget.querySelector('.flash-front').setAttribute('aria-hidden', String(s.flipped));
      e.currentTarget.querySelector('.flash-back').setAttribute('aria-hidden', String(!s.flipped)); sound('flip');
    };
    document.querySelector('#again').onclick = () => { record(false, card, 'again'); s.queue.push(card); sound('wrong'); nextCard(); };
    for (const [id, grade] of [['hard', 'hard'], ['known', 'good'], ['easy', 'easy']]) {
      document.querySelector(`#${id}`).onclick = () => { record(true, card, grade); sound('correct'); if (s.streak % 3 === 0) celebrate(); nextCard(); };
    }
  } else if (s.mode === 'test') {
    document.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => chooseAnswer(Number(button.dataset.choice)));
    document.querySelector('#next-question').onclick = () => { if (s.answered) nextCard(); };
  } else {
    document.querySelector('#answer').focus();
    document.querySelector('#hint').onclick = e => { e.currentTarget.textContent = `Начинается с «${expected.slice(0, 2)}…»`; };
    document.querySelector('#answer-form').onsubmit = e => {
      e.preventDefault(); if (s.answered) { nextCard(); return; }
      const answer = document.querySelector('#answer').value; if (!answer.trim()) return;
      const ok = cloze ? evaluateCloze(answer, cloze) : listening ? evaluateListening(answer, listening) : matchesTypedAnswer(answer, [...validAnswers(s.set, card, s.direction)]);
      const variants = cloze ? [cloze.answer, ...(cloze.alternatives || [])] : listening ? listening.answer : [...validAnswers(s.set, card, s.direction)];
      s.acceptedTypo = ok && !answerVariants(variants).includes(normalizeTypedAnswer(answer));
      if (!ok) s.queue.push(card);
      acceptAnswer(answer, ok); document.querySelector('#answer').disabled = true;
      document.querySelector('#answer-form button[type="submit"]').innerHTML = `${nextLabel()} ${icon('arrow')}`; document.querySelector('#hint').remove(); document.querySelector('#answer-form button[type="submit"]').focus();
    };
  }
}
function nextLabel() { return session.index === session.queue.length - 1 ? 'Посмотреть результат' : 'Следующая карточка'; }
function nextCard() { session.index++; session.answered = false; session.flipped = false; session.options = null; session.correctionReceipt = null; session.acceptedTypo = false; study(); }
function chooseAnswer(index) {
  if (!session || session.mode !== 'test' || session.answered || !Number.isInteger(index) || index < 0 || index >= session.options.length) return;
  const card = session.queue[session.index], answer = session.options[index], side = session.direction === 'reverse' ? 0 : 1;
  acceptAnswer(answer, normalize(answer) === normalize(card[side]));
  document.querySelectorAll('[data-choice]').forEach(button => { const value = session.options[Number(button.dataset.choice)]; button.disabled = true;
    if (normalize(value) === normalize(card[side])) { button.classList.add('is-correct'); button.querySelector('.option-status').innerHTML = icon('check'); }
    else if (Number(button.dataset.choice) === index) { button.classList.add('is-wrong'); button.querySelector('.option-status').innerHTML = icon('close'); }
    else button.classList.add('is-muted');
  });
  const next = document.querySelector('#next-question'); next.disabled = false; next.innerHTML = `${nextLabel()} ${icon('arrow')}`; next.focus();
}
function acceptAnswer(answer, ok) {
  const card = session.queue[session.index], expected = session.expected || card[session.direction === 'reverse' ? 0 : 1];
  const now = Date.now();
  session.correctionReceipt = !ok && session.mode !== 'test' ? { cardId: card[2].id, now, streakBefore: session.streak, retryIndex: session.queue.length - 1, corrected: false, reviewBefore: Object.hasOwn(data.reviews, card[2].id) ? structuredClone(data.reviews[card[2].id]) : null } : null;
  session.answered = true; record(ok, card, ok, now); sound(ok ? 'correct' : 'wrong');
  session.results.push({ term: card[session.direction === 'reverse' ? 1 : 0], expected, answer, ok });
  showFeedback(ok, expected);
}
function showFeedback(ok, expected, corrected = false) {
  document.querySelector('#feedback').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${icon(ok ? 'check' : 'close')}<span>${ok ? corrected ? 'Ответ засчитан.' : 'Правильно!' : `Правильный ответ: ${esc(expected)}`}</span></div>${!ok && session.correctionReceipt ? '<button class="secondary" type="button" id="override-answer">Я был прав</button>' : ''}`;
  document.querySelector('#override-answer')?.addEventListener('click', correctCurrentAnswer);
  if (ok && session.acceptedTypo && !corrected) {
    const spelling = document.createElement('p'); spelling.className = 'test-caption'; spelling.textContent = `Опечатка засчитана. Верное написание: ${expected}`;
    document.querySelector('#feedback').append(spelling);
  }
  const streak = document.querySelector('.streak'); streak.classList.toggle('is-hot', session.streak >= 3); streak.innerHTML = `${icon('bolt')} <span>${session.streak} подряд</span>`;
  const daily = dailyProgress(data); document.querySelector('.study-daily').textContent = `Сегодня: ${daily.answers} / ${daily.goal} ответов`;
  const rank = rankProgress(data); document.querySelector('.study-xp').textContent = `${rank.name} · ${rank.xp} XP`;
  if (ok && session.streak % 3 === 0) celebrate();
}
function correctCurrentAnswer() {
  const s = session, receipt = s?.correctionReceipt, card = s?.queue[s.index];
  if (!s?.answered || !receipt || receipt.corrected || receipt.cardId !== card?.[2]?.id) return;
  receipt.corrected = true;
  reclassifyAnswer(data, card, receipt);
  const experience = awardRankXP(data, card, true, s.mode, receipt.now);
  s.correct++; s.streak = receipt.streakBefore + 1; s.results.at(-1).ok = true;
  if (s.queue[receipt.retryIndex] === card && receipt.retryIndex > s.index) s.queue.splice(receipt.retryIndex, 1);
  save(); sound('correct'); showFeedback(true, s.expected, true);
  const next = document.querySelector('#answer-form button[type="submit"]'); next.innerHTML = `${nextLabel()} ${icon('arrow')}`; next.focus();
  if (experience.leveledUp) notify(`Новый ранг — ${experience.current.name}!`);
}
function record(ok, card, grade = ok, now = Date.now()) {
  rememberStudy(session.set, card);
  recordCardAnswer(data, card, ok);
  const wasComplete = dailyProgress(data, now).complete;
  const experience = awardRankXP(data, card, ok, session.mode, now);
  session.correct += ok ? 1 : 0; session.streak = ok ? session.streak + 1 : 0;
  data.answers++; if (ok) data.learned++; scheduleReview(data, card, grade, now); recordDaily(data, ok, now); save();
  if (experience.leveledUp) { notify(`Новый ранг — ${experience.current.name}! ${experience.current.xp} XP`); sound('complete'); }
  else if (!wasComplete && dailyProgress(data).complete) { notify(`Дневная цель выполнена: ${data.settings.goal} ответов!`); sound('complete'); }
}
function celebrate() {
  sound('streak'); document.querySelector('.celebration')?.remove();
  const celebration = document.createElement('div'); celebration.className = 'celebration'; celebration.setAttribute('role', 'status');
  celebration.innerHTML = `<div>${icon('trophy')}<b>${session.streak} подряд!</b><span>Отличная серия</span></div>${Array.from({ length: 42 }, (_, i) => `<i style="--x:${Math.random() * 100}vw;--delay:${Math.random() * .35}s;--color:${['#1f9b85', '#e8b65a', '#4e8abd'][i % 3]}"></i>`).join('')}`;
  document.body.append(celebration); setTimeout(() => celebration.remove(), 2600);
}
function finish() {
  const s = session; if (!s) return; sound('complete');
  modal(`<div class="result-icon">${icon('trophy')}</div><div class="eyebrow">Занятие завершено</div><h2>${s.correct === s.queue.length ? 'Все ответы правильные!' : 'Практика завершена'}</h2><p>${s.mode === 'review' ? 'Расписание следующих повторов обновлено.' : 'Карточки получили своё время следующего повторения.'}</p><div class="result-score">${s.correct}<span> / ${s.queue.length}</span></div><p>правильных ответов</p><div class="terms">${s.results.filter(r => !r.ok).map(r => `<div><b>${esc(r.term)}</b><span>${esc(r.expected)}</span></div>`).join('')}</div><div class="study-actions"><button class="primary" id="repeat">${icon('rotate')} Повторить</button><button class="secondary" id="done">На главную ${icon('arrow')}</button></div>`);
  document.querySelector('#repeat').onclick = () => { session = null; s.set.id === null ? startReview() : openSet(s.set.id); };
  document.querySelector('#done').onclick = () => goPage('home');
}
function mediaManager(set, mediaPage = 0) {
  session = null; let pendingUploads = 0;
  const pageCards = set.cards.slice(mediaPage * 40, (mediaPage + 1) * 40), cardsById = new Map(pageCards.map(card => [card[2].id, card]));
  modal(`<div class="media-manager"><div class="eyebrow">${esc(set.title)}</div><h2>Картинки, аудио и примеры</h2><p>Загрузи картинку или свою аудиозапись. Файлы до 8 МБ сохраняются в этом браузере.</p>${pageCards.map(card => `<section class="media-row" data-card-id="${esc(card[2].id)}"><h3>${esc(card[0])}</h3><p>${esc(card[1])}</p><div class="media-fields"><label>Пример использования<textarea data-example="${esc(card[2].id)}" rows="2" placeholder="Например: I need a ticket to London.">${esc(card[2].example || '')}</textarea></label><div class="attachment-field"><label>${icon('image')} Картинка<input type="file" data-upload-kind="image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>${card[2].imageId ? `<span>${esc(card[2].imageName || 'Картинка')}</span><button class="text-button" data-remove-kind="image">Удалить картинку</button>` : ''}</div><div class="attachment-field"><label>${icon('sound')} Аудиозапись<input type="file" data-upload-kind="audio" accept="audio/*"></label>${card[2].audioId ? `<span>${esc(card[2].audioName || 'Аудио')}</span><button class="text-button" data-remove-kind="audio">Удалить аудио</button>` : ''}</div></div><div class="upload-status" role="status"></div><div class="attachment-preview">${attachmentMarkup(card, esc)}</div></section>`).join('')}${cardPagination(mediaPage, set.cards.length, 'media')}<div class="form-error" id="media-error" role="alert"></div><button class="primary" id="save-media">${icon('check')} Готово</button></div>`);
  const manager = document.querySelector('.media-manager'), doneButton = manager.querySelector('#save-media');
  const updateBusy = () => {
    if (!manager.isConnected) return;
    doneButton.disabled = pendingUploads > 0;
    doneButton.innerHTML = pendingUploads ? 'Сохраняю вложение…' : `${icon('check')} Готово`;
    manager.querySelectorAll('[data-remove-kind], [data-media-page]').forEach(button => { button.disabled = pendingUploads > 0; });
  };
  const removeFromManager = async (card, kind) => {
    if (pendingUploads) return;
    pendingUploads++;
    manager.querySelectorAll('[data-upload-kind]').forEach(input => { input.disabled = true; }); updateBusy();
    const updated = await removeMedia(card, kind);
    pendingUploads--;
    if (!manager.isConnected) return;
    if (updated) mediaManager(set, mediaPage);
    else { manager.querySelectorAll('[data-upload-kind]').forEach(input => { input.disabled = false; }); updateBusy(); }
  };
  hydrateAttachments(manager);
  document.querySelectorAll('[data-example]').forEach(input => input.oninput = () => { const card = cardsById.get(input.dataset.example); card[2].example = input.value.slice(0, 500); save(); });
  document.querySelectorAll('[data-upload-kind]').forEach(input => input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const row = input.closest('.media-row'), card = cardsById.get(row.dataset.cardId), kind = input.dataset.uploadKind;
    const status = row.querySelector('.upload-status'); status.textContent = 'Сохраняю файл…'; input.disabled = true; pendingUploads++;
    updateBusy();
    try {
      const attachment = await storeAttachment(file, kind), oldId = card[2][`${kind}Id`];
      if (!manager.isConnected) { await removeAttachment(attachment.id); return; }
      const oldMeta = { ...card[2] }; card[2][`${kind}Id`] = attachment.id; card[2][`${kind}Name`] = attachment.name;
      try { await saveNow(); } catch (error) { card[2] = oldMeta; await removeAttachment(attachment.id); throw error; }
      for (const id of collectUnreferencedAttachments(data, [oldId])) await removeAttachment(id);
      if (!manager.isConnected) return;
      status.textContent = `${kind === 'image' ? 'Картинка' : 'Аудио'} сохранено: ${attachment.name}`;
      row.querySelector('.attachment-preview').innerHTML = attachmentMarkup(card, esc); await hydrateAttachments(row);
      if (!row.querySelector(`[data-remove-kind="${kind}"]`)) {
        const remove = document.createElement('button'); remove.className = 'text-button'; remove.dataset.removeKind = kind; remove.textContent = kind === 'image' ? 'Удалить картинку' : 'Удалить аудио';
        input.closest('.attachment-field').append(remove); remove.disabled = pendingUploads > 0; remove.onclick = () => removeFromManager(card, kind);
      }
      sound('correct');
    } catch (error) { status.textContent = error.message || 'Не удалось сохранить файл.'; }
    finally { input.disabled = false; input.value = ''; pendingUploads--; updateBusy(); }
  });
  document.querySelectorAll('[data-remove-kind]').forEach(button => button.onclick = () => { const card = cardsById.get(button.closest('.media-row').dataset.cardId); removeFromManager(card, button.dataset.removeKind); });
  document.querySelectorAll('[data-media-page]').forEach(button => button.onclick = () => { if (!pendingUploads) mediaManager(set, Number(button.dataset.mediaPage)); });
  doneButton.onclick = async () => { if (pendingUploads) return; try { await saveNow(); openSet(set.id); notify('Карточки сохранены'); } catch (error) { document.querySelector('#media-error').textContent = error.message; } };
}
async function removeMedia(card, kind) {
  const id = card[2][`${kind}Id`], previous = { ...card[2] };
  delete card[2][`${kind}Id`]; delete card[2][`${kind}Name`];
  try { await saveNow(); } catch (error) { card[2] = previous; notify(error.message); return false; }
  try { for (const unused of collectUnreferencedAttachments(data, [id])) await removeAttachment(unused); } catch { notify('Вложение убрано из карточки, но браузер не смог удалить файл.'); }
  return true;
}
document.addEventListener('pointerdown', () => { if (data.settings.sounds) unlockAudio(); }, { once: true });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelector('.close')?.click(); return; }
  const dialog = document.querySelector('.modal');
  if (e.key === 'Tab' && dialog) {
    const focusable = [...dialog.querySelectorAll('button, a[href], input, textarea, select, audio[controls], [tabindex]')].filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (first && ((!dialog.contains(document.activeElement)) || (!e.shiftKey && document.activeElement === last) || (e.shiftKey && document.activeElement === first))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    return;
  }
  if (!session || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,[contenteditable="true"],audio,video')) return;
  if (['flash', 'review', 'weak'].includes(session.mode)) {
    const action = e.key === ' ' || e.code === 'Space' ? 'flip' : { '1': 'again', '2': 'known', '3': 'easy' }[e.key];
    if (action) { e.preventDefault(); document.getElementById(action)?.click(); }
    return;
  }
  if (session.mode === 'test' && !session.answered && /^[1-4]$/.test(e.key)) { e.preventDefault(); chooseAnswer(Number(e.key) - 1); }
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(data.settings));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void stateStore.flush().catch(() => {}); });
window.addEventListener('pagehide', () => { void stateStore.flush().catch(() => {}); });
save(); render();
