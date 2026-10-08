import { ensurePracticeData, localDay, getDueCards, scheduleReview, recordDaily, dailyProgress, activityCalendar, studyStreak } from './practice.js';
import { unlockAudio, playSound, speakText, stopAudio, storeAttachment, removeAttachment, attachmentMarkup, hydrateAttachments, releaseMediaUrls } from './media.js';
import { mountMatching } from './matching.js';
import { buildCloze, buildListening, evaluateCloze, evaluateListening } from './exercises.js';
import { ensureRankData, rankProgress, awardRankXP } from './ranks.js';
import { ranksPage, storagePage, bindStorage } from './pages.js';
import { mountPronunciation } from './pronunciation.js';
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
  { name: 'letters', label: 'Слова', color: 'neutral', glyph: 'Aa' },
  { name: 'numbers', label: 'Факты', color: 'neutral', glyph: '01' },
  { name: 'book', label: 'Книга', color: 'neutral' },
  { name: 'globe', label: 'Мир', color: 'neutral' },
  { name: 'calendar', label: 'Даты', color: 'neutral' },
  { name: 'target', label: 'Цель', color: 'neutral' },
];
const symbolIcon = (item) => item.glyph ? `<span class="symbol-glyph">${item.glyph}</span>` : icon(item.name);
const username = 'leverage100x';
const defaultCategories = ['Английский', 'Идиомы', 'Общее развитие'];
const initial = [
  { id: 1, title: 'Повседневный английский', desc: 'Слова, которые пригодятся каждый день', category: 'Английский', color: 'neutral', symbol: 'letters', cards: [['Serendipity', 'Счастливая случайность'], ['To make a difference', 'Изменить что-то к лучшему'], ['Take your time', 'Не торопись'], ['A piece of cake', 'Проще простого'], ['Curiosity', 'Любопытство'], ['To be on the same page', 'Быть на одной волне']] },
  { id: 2, title: 'Английские идиомы', desc: 'Устойчивые выражения и их значения', category: 'Идиомы', color: 'neutral', symbol: 'book', cards: [['Break the ice', 'Разрядить обстановку'], ['Hit the books', 'Усердно учиться'], ['Under the weather', 'Плохо себя чувствовать'], ['Once in a blue moon', 'Очень редко']] },
  { id: 3, title: 'Факты и даты', desc: 'История, искусство и окружающий мир', category: 'Общее развитие', color: 'neutral', symbol: 'numbers', cards: [['Самая большая планета', 'Юпитер'], ['Год первого полёта в космос', '1961'], ['Автор «Звёздной ночи»', 'Винсент ван Гог']] },
  { id: 4, title: 'Английский для поездок', desc: 'Транспорт, билеты и путешествия', category: 'Английский', color: 'neutral', symbol: 'globe', cards: [['Boarding pass', 'Посадочный талон'], ['Round trip', 'Поездка туда и обратно'], ['Carry-on luggage', 'Ручная кладь'], ['Departure', 'Отправление']] },
];
let data;
try { data = JSON.parse(localStorage.getItem('lexi-data')); } catch {}
if (!data || !Array.isArray(data.sets)) data = { sets: initial, learned: 0, answers: 0, days: [] };
ensurePracticeData(data);
const starterExamples = {
  'Serendipity': 'Finding this book was pure serendipity.',
  'To make a difference': 'Small changes can make a difference.',
  'Take your time': 'Take your time. There is no hurry.',
  'A piece of cake': 'The exam was a piece of cake.',
  'Curiosity': 'Curiosity helps us discover new things.',
  'To be on the same page': 'Let us make sure we are on the same page.',
  'Break the ice': 'A friendly question can break the ice.',
  'Hit the books': 'I need to hit the books before the exam.',
  'Under the weather': 'I am feeling under the weather today.',
  'Once in a blue moon': 'We go to that restaurant once in a blue moon.',
  'Boarding pass': 'Please show your boarding pass at the gate.',
  'Round trip': 'I would like a round-trip ticket to London.',
  'Carry-on luggage': 'You can bring one piece of carry-on luggage.',
  'Departure': 'Our departure is scheduled for nine in the morning.',
};
for (const set of data.sets) if ([1, 2, 4].includes(set.id)) {
  for (const card of set.cards) if (card[2].example === undefined && starterExamples[card[0]]) card[2].example = starterExamples[card[0]];
}
data.learned = Number(data.learned) || 0;
data.answers = Number(data.answers) || 0;
const cleanCategory = value => String(value || '').trim().replace(/\s+/g, ' ');
const categoryKey = value => cleanCategory(value).toLocaleLowerCase('ru');
function prepareData(value) {
  ensurePracticeData(value); ensureRankData(value);
  value.categories = [...defaultCategories, ...(Array.isArray(value.categories) ? value.categories : []), ...value.sets.map(s => s.category)].reduce((list, value) => {
  const name = cleanCategory(value);
  if (name && !list.some(c => categoryKey(c) === categoryKey(name))) list.push(name);
  return list;
}, []);
  value.sets.forEach(s => { s.category = value.categories.find(c => categoryKey(c) === categoryKey(s.category)) || 'Общее развитие'; });
  return value;
}
prepareData(data);
let page = 'home', filter = null, query = '', session = null, direction = 'normal';
let toastTimer, matchController, pronunciationController, settingsDraft = null, modalReturnFocus = null, speechUIRequest = 0;
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
function save() { try { localStorage.setItem('lexi-data', JSON.stringify(data)); return true; } catch { return false; } }
function notify(message) {
  document.querySelector('.toast')?.remove(); clearTimeout(toastTimer);
  const toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status');
  toast.innerHTML = `${icon('check')}<span>${esc(message)}</span>`; document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 3500);
}
function cleanupSession() { matchController?.destroy(); matchController = null; pronunciationController?.destroy(); pronunciationController = null; stopAudio(); releaseMediaUrls(); }
function applyTheme(settings = data.settings) {
  const theme = settings.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = settings.accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14211f' : '#f5f7f3');
}
function visual(set) {
  const fallback = set.id === 3 ? 'numbers' : set.id === 4 ? 'globe' : 'letters';
  const symbol = symbols.find(item => item.name === set.symbol) || symbols.find(item => item.name === fallback);
  return `<div class="set-symbol neutral">${symbolIcon(symbol)}</div>`;
}
function goPage(next) { cleanupSession(); session = null; page = next; settingsDraft = page === 'settings' ? { ...data.settings } : null; render(); }
function render() {
  cleanupSession(); session = null;
  document.body.classList.remove('has-modal');
  applyTheme(page === 'settings' && settingsDraft ? settingsDraft : data.settings);
  const titles = { home: `Привет, ${username}`, sets: 'Мои наборы', stats: 'Твой прогресс', ranks: 'Твои ранги', storage: 'Копии и импорт', settings: 'Настройки' };
  const descriptions = { home: 'Карточки, игры и небольшая практика каждый день.', sets: 'Свои категории, слова, картинки и аудио.', stats: 'Смотри, как занятия складываются в привычку.', ranks: 'Набирай опыт, открывай ранги и замечай свой рост.', storage: 'Сохрани всё на устройстве или перенеси карточки из других приложений.', settings: 'Выбери оформление, звуки и удобную ежедневную цель.' };
  const title = titles[page];
  document.querySelector('#app').innerHTML = `
    <aside><a class="logo" href="#" aria-label="zhekandus, главная">zhekandus</a><div class="workspace">Твоё обучение</div>
      <nav>${[['home', 'Главная', 'home'], ['sets', 'Мои наборы', 'layers'], ['stats', 'Прогресс', 'chart'], ['ranks', 'Ранги', 'trophy'], ['storage', 'Копии и импорт', 'archive'], ['settings', 'Настройки', 'settings']].map(([p, label, glyph]) => `<button class="nav ${page === p ? 'active' : ''}" data-page="${p}" aria-label="${label}" title="${label}" ${page === p ? 'aria-current="page"' : ''}>${icon(glyph)}${label}${p === 'sets' ? `<small>${data.sets.length}</small>` : ''}</button>`).join('')}</nav>
      <div class="side-note"><b>Свой ритм, своя цель</b><p>${countLabel(data.settings.goal, ['ответ', 'ответа', 'ответов'])} в день. Сложные карточки вернутся раньше, знакомые — позже.</p><button class="text-button" id="sidebar-review">Повторить сегодня ${icon('arrow')}</button></div>
      <div class="profile"><div class="avatar">L</div><div><b>${username}</b><small>Моя коллекция</small></div></div></aside>
    <main><header><div class="breadcrumb">zhekandus <span>/</span> ${page === 'home' ? 'Главная' : titles[page]}</div><div class="header-right"><button class="icon-button ${data.settings.sounds ? 'is-on' : ''}" id="sound-toggle" aria-pressed="${data.settings.sounds}" title="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки" aria-label="${data.settings.sounds ? 'Выключить' : 'Включить'} звуки">${icon(data.settings.sounds ? 'sound' : 'mute')}</button><button class="icon-button" id="settings" aria-label="Открыть настройки" title="Тема и настройки">${icon('settings')}</button><div class="avatar small" title="${username}">L</div></div></header>
      <div class="content"><div class="welcome"><div><h1>${title}</h1><p>${descriptions[page]}</p></div>${['home', 'sets'].includes(page) ? `<button class="primary" id="create">${icon('plus')} Создать набор</button>` : ''}</div>
      ${page === 'settings' ? settingsPage() : page === 'ranks' ? ranksPage(data, icon, esc) : page === 'storage' ? storagePage(icon) : page === 'stats' ? statsCards() + calendarPanel() + statsPanel() : `${page === 'home' ? hero() + dashboard() + statsCards() : ''}<section class="collection"><div class="section-heading"><h2>Твои наборы <span>${data.sets.length}</span></h2><label class="search">${icon('search')}<input id="search" aria-label="Найти набор" placeholder="Найти набор…" value="${esc(query)}"></label></div><div class="tabs" aria-label="Категории"><button data-filter="*" data-all="true" class="${filter === null ? 'selected' : ''}">Все наборы</button>${data.categories.map(c => `<button data-filter="${esc(c)}" class="${c === filter ? 'selected' : ''}">${esc(c)}</button>`).join('')}</div><div class="grid" id="sets-grid">${setCards()}</div></section>`}</div>
    </main><div id="modal-root"></div>`;
  bind();
}
function hero() {
  const set = data.sets[0], card = set?.cards[0];
  return `<section class="hero"><div class="hero-copy"><div class="pill">Практика, которая остаётся с тобой</div><h2>Узнавай.<br>Вспоминай. Играй.</h2><p>Сегодня — пара новых слов.<br>Завтра — ещё больше уверенности.</p><button class="dark" id="quick">${set ? 'Выбрать режим' : 'Создать первый набор'} ${icon('arrow')}</button><div class="hero-foot">${set ? `${esc(set.title)} · ${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])}` : 'Начни с того, что тебе интересно'}</div></div><div class="hero-art"><div class="hero-preview"><div class="preview-meta"><span>${set ? esc(set.category) : 'Новая карточка'}</span><span class="preview-index">01</span></div><div class="preview-term">${esc(card?.[0] || 'Твоё первое слово')}</div><div class="preview-definition" id="preview-definition" hidden>${esc(card?.[1] || 'Добавь определение')}</div><div class="preview-actions"><button class="preview-flip" id="hero-flip" aria-expanded="false" aria-controls="preview-definition">Показать ответ ${icon('rotate')}</button>${card ? `<button class="icon-button" id="hero-speak" aria-label="Озвучить слово">${icon('sound')}</button>` : ''}</div></div></div></section>`;
}
function dashboard() {
  const due = getDueCards(data), daily = dailyProgress(data);
  return `<div class="dashboard-row"><section class="review-panel"><span class="panel-label">${icon('rotate')} Интервальное повторение</span><h2>${due.length ? `${due.length} ${word(due.length, ['карточка', 'карточки', 'карточек'])} на сегодня` : 'Всё повторено'}</h2><p>${due.length ? 'Новые и забытые карточки — первыми. Следующий повтор зависит от твоего ответа.' : 'Следующие карточки появятся, когда подойдёт время повторения.'}</p><button class="primary" id="start-review" ${!due.length ? 'disabled' : ''}>Повторить ${icon('arrow')}</button></section><section class="goal-panel"><div><span class="panel-label">${icon('target')} Ежедневная цель</span><h2>${daily.complete ? 'Цель выполнена!' : 'Немного каждый день'}</h2><p>${daily.answers} из ${countLabel(daily.goal, ['ответ', 'ответа', 'ответов'])} сегодня</p><button class="text-button" id="change-goal">Изменить цель</button></div><div class="goal-ring" style="--progress:${Math.min(daily.percent, 100)}%"><span><b>${Math.round(daily.percent)}%</b><small>сегодня</small></span></div></section></div>`;
}
function statsCards() {
  const streak = studyStreak(data);
  return `<div class="stats-row"><div><span class="stat-icon neutral">${icon('layers')}</span><section><strong>${data.sets.length}</strong><p>наборов в коллекции</p></section></div><div><span class="stat-icon green">${icon('check')}</span><section><strong>${data.learned}</strong><p>правильных ответов</p></section></div><div><span class="stat-icon orange">${icon('bolt')}</span><section><strong>${streak} <small>${word(streak, ['день', 'дня', 'дней'])}</small></strong><p>серия занятий</p></section></div></div>`;
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
  const prefs = settingsDraft || data.settings;
  return `<section class="settings-panel"><div class="setting-group"><h2>${icon('moon')} Тема</h2><p>Светлая, тёмная или как на устройстве.</p><div class="theme-options">${[['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon'], ['system', 'Системная', 'settings']].map(([value, label, glyph]) => `<button class="secondary ${prefs.theme === value ? 'selected' : ''}" data-theme-choice="${value}" aria-pressed="${prefs.theme === value}">${icon(glyph)}${label}</button>`).join('')}</div></div><div class="setting-group"><h2>Акцентный цвет</h2><div class="accent-options">${[['teal', 'Зелёный'], ['blue', 'Синий'], ['orange', 'Терракота'], ['rose', 'Розовый'], ['graphite', 'Графит']].map(([value, label]) => `<button class="accent-swatch ${prefs.accent === value ? 'selected' : ''}" data-accent-choice="${value}" aria-label="${label}" aria-pressed="${prefs.accent === value}"><span></span>${label}</button>`).join('')}</div></div><div class="setting-group"><h2>${icon('target')} Ежедневная цель</h2><label class="goal-label" for="daily-goal">Ответов в день</label><input id="daily-goal" type="number" min="1" max="200" step="1" value="${prefs.goal}"><p>Считаются ответы в карточках, тестах, запоминании и игре.</p></div><div class="setting-row"><div><h2>${icon('sound')} Звуки</h2><p>Ответы, переворот карточек, совпадения и серии.</p></div><label class="toggle"><input type="checkbox" id="setting-sounds" ${prefs.sounds ? 'checked' : ''}><span></span><b>${prefs.sounds ? 'Включены' : 'Выключены'}</b></label></div><div class="setting-group speech-settings"><h2>${icon('sound')} Озвучка слов</h2><label for="speech-voice">Голосовой движок</label><select id="speech-voice"><option value="auto" ${(prefs.speechVoice || 'auto') === 'auto' ? 'selected' : ''}>Автоматически — голос устройства и локальный запасной</option><option value="offline" ${prefs.speechVoice === 'offline' ? 'selected' : ''}>Встроенный локальный голос</option></select><label for="speech-rate">Скорость <b id="speech-rate-label">${prefs.speechRate || .9}×</b></label><input type="range" id="speech-rate" min="0.5" max="1.5" step="0.1" value="${prefs.speechRate || .9}"><p>Английский и русский работают без скачивания системных голосов. Встроенный голос звучит более механически.</p><button class="secondary" id="speech-demo">${icon('sound')} Проверить озвучку</button></div><div id="settings-error" class="form-error" role="alert"></div><button class="primary" id="save-settings">${icon('check')} Сохранить настройки</button></section>`;
}
function setCards() {
  const sets = data.sets.filter(s => (filter === null || s.category === filter) && `${s.title} ${s.desc}`.toLowerCase().includes(query.toLowerCase()));
  return `${!sets.length ? '<div class="empty-state"><b>Ничего не найдено</b><p>Измени поиск или создай новый набор.</p></div>' : ''}${sets.map(s => `<article class="set-card" data-set="${s.id}" tabindex="0" aria-label="Открыть ${esc(s.title)}"><div class="set-top">${visual(s)}<span class="category">${esc(s.category)}</span><button class="more" data-edit="${s.id}" aria-label="Редактировать набор">${icon('pencil')}</button></div><h3>${esc(s.title)}</h3><p>${esc(s.desc)}</p><div class="set-footer"><span>${icon('layers')} ${countLabel(s.cards.length, ['карточка', 'карточки', 'карточек'])}</span><span class="open-arrow">${icon('arrow')}</span></div></article>`).join('')}<button class="new-set" id="create-card"><span>${icon('plus')}</span><b>Новый набор</b><p>Слова, факты и свои категории</p></button>`;
}
function bind() {
  document.querySelector('.logo').onclick = e => { e.preventDefault(); goPage('home'); };
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => goPage(button.dataset.page));
  document.querySelector('#settings').onclick = () => goPage('settings');
  document.querySelector('#sound-toggle').onclick = () => {
    if (page === 'settings' && settingsDraft) settingsDraft.goal = document.querySelector('#daily-goal').value;
    data.settings.sounds = !data.settings.sounds;
    if (settingsDraft) settingsDraft.sounds = data.settings.sounds;
    if (!data.settings.sounds) stopAudio(); else sound('click');
    save(); render(); notify(`Звуки ${data.settings.sounds ? 'включены' : 'выключены'}`);
  };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.hasAttribute('data-all') ? null : button.dataset.filter; render(); });
  document.querySelector('#search')?.addEventListener('input', e => { query = e.target.value; document.querySelector('#sets-grid').innerHTML = setCards(); bindSets(); });
  document.querySelector('#create')?.addEventListener('click', () => editor());
  document.querySelector('#hero-flip')?.addEventListener('click', e => {
    const definition = document.querySelector('#preview-definition'); definition.hidden = !definition.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!definition.hidden));
    e.currentTarget.innerHTML = `${definition.hidden ? 'Показать ответ' : 'Скрыть ответ'} ${icon('rotate')}`; sound('flip');
  });
  document.querySelector('#hero-speak')?.addEventListener('click', e => pronounce(data.sets[0].cards[0][0], e.currentTarget));
  document.querySelector('#quick')?.addEventListener('click', () => data.sets.length ? openSet(data.sets[0].id) : editor());
  document.querySelector('#start-review')?.addEventListener('click', () => startReview());
  document.querySelector('#sidebar-review').onclick = () => startReview();
  document.querySelector('#change-goal')?.addEventListener('click', () => { goPage('settings'); document.querySelector('#daily-goal').focus(); });
  document.querySelector('#calendar-prev')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); render(); });
  document.querySelector('#calendar-next')?.addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); render(); });
  if (page === 'settings') bindSettings();
  document.querySelector('#ranks-practice')?.addEventListener('click', () => data.sets.length ? openSet(data.sets[0].id) : editor());
  if (page === 'storage') bindStorage({ getData: () => data, esc, notify,
    onRestore: restored => {
      const previous = data;
      try { data = prepareData(restored); if (!save()) { data = previous; return false; } filter = null; query = ''; settingsDraft = null; return true; }
      catch { data = previous; return false; }
    },
    onImport: sets => {
      const previous = structuredClone(data);
      try {
        let id = Math.max(Date.now(), ...data.sets.map(set => Number(set.id) + 1).filter(Number.isFinite));
        data.sets.push(...sets.map(set => ({ ...set, id: id++, desc: set.desc || '', category: set.category || 'Импорт', symbol: set.symbol || 'letters', color: 'neutral' })));
        prepareData(data); if (!save()) { data = previous; return false; } filter = null; query = ''; return true;
      } catch { data = previous; return false; }
    }, onSuccess: () => goPage('sets'),
  });
  bindSets();
}
function bindSettings() {
  const capture = () => {
    settingsDraft.goal = document.querySelector('#daily-goal').value; settingsDraft.sounds = document.querySelector('#setting-sounds').checked;
    settingsDraft.speechVoice = document.querySelector('#speech-voice').value; settingsDraft.speechRate = Number(document.querySelector('#speech-rate').value);
  };
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => { capture(); settingsDraft.theme = button.dataset.themeChoice; render(); });
  document.querySelectorAll('[data-accent-choice]').forEach(button => button.onclick = () => { capture(); settingsDraft.accent = button.dataset.accentChoice; render(); });
  document.querySelector('#setting-sounds').onchange = e => { settingsDraft.sounds = e.target.checked; e.target.parentElement.querySelector('b').textContent = e.target.checked ? 'Включены' : 'Выключены'; if (e.target.checked) playSound('click', true); };
  document.querySelector('#speech-rate').oninput = e => { settingsDraft.speechRate = Number(e.target.value); document.querySelector('#speech-rate-label').textContent = `${settingsDraft.speechRate}×`; };
  document.querySelector('#speech-voice').onchange = capture;
  document.querySelector('#speech-demo').onclick = e => { capture(); pronounce('Learning a little every day makes a difference.', e.currentTarget, { voice: settingsDraft.speechVoice, rate: settingsDraft.speechRate }); };
  document.querySelector('#save-settings').onclick = () => {
    capture(); const goal = Number(settingsDraft.goal);
    if (!Number.isInteger(goal) || goal < 1 || goal > 200) { document.querySelector('#settings-error').textContent = 'Выбери цель от 1 до 200 ответов.'; return; }
    data.settings = { ...settingsDraft, goal }; settingsDraft = { ...data.settings };
    const persisted = save(); render(); sound('complete'); notify(persisted ? 'Настройки сохранены' : 'Браузер запретил сохранение настроек');
  };
}
function bindSets() {
  document.querySelectorAll('[data-set]').forEach(card => { card.onclick = () => openSet(Number(card.dataset.set)); card.onkeydown = e => { if (e.target === card && ['Enter', ' '].includes(e.key)) { e.preventDefault(); card.click(); } }; });
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = e => { e.stopPropagation(); editor(data.sets.find(s => s.id === Number(button.dataset.edit))); });
  if (document.querySelector('#create-card')) document.querySelector('#create-card').onclick = () => editor();
}
function modal(html) {
  cleanupSession();
  const origin = document.activeElement;
  if (!origin.closest('.modal')) modalReturnFocus = origin.id ? `#${CSS.escape(origin.id)}` : origin.dataset.set ? `[data-set="${origin.dataset.set}"]` : null;
  document.querySelector('#modal-root').innerHTML = `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-label="${session ? 'Занятие' : 'Набор карточек'}"><button class="close" aria-label="Закрыть">${icon('close')}</button>${html}</div></div>`;
  document.querySelectorAll('#app > aside, #app > main').forEach(node => { node.inert = true; });
  document.body.classList.add('has-modal');
  document.querySelector('.close').onclick = () => { cleanupSession(); session = null; render(); if (modalReturnFocus) document.querySelector(modalReturnFocus)?.focus({ preventScroll: true }); modalReturnFocus = null; };
  document.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) document.querySelector('.close').click(); };
  document.querySelector('.close').focus({ preventScroll: true });
}
function editor(set) {
  session = null; const selectedSymbol = symbols.some(s => s.name === set?.symbol) ? set.symbol : 'letters';
  modal(`<div class="eyebrow">Мои наборы</div><h2>${set ? 'Редактировать набор' : 'Новый набор'}</h2><p>Пары «термин; определение», каждая с новой строки. Картинки и аудио добавляются после сохранения.</p><form id="editor"><label>Название<input name="title" required maxlength="80" value="${esc(set?.title || '')}" placeholder="Например, английский для поездок"></label><label>Описание<input name="desc" maxlength="120" value="${esc(set?.desc || '')}" placeholder="О чём этот набор?"></label><label>Категория<input name="category" list="category-suggestions" required maxlength="40" value="${esc(set?.category || filter || 'Английский')}" placeholder="Выбери или придумай свою"><small>Напиши любое название — категория появится после сохранения.</small></label><datalist id="category-suggestions">${data.categories.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist><fieldset class="symbol-field"><legend>Иконка набора</legend><div class="symbol-options">${symbols.map(item => `<label class="symbol-choice"><input type="radio" name="symbol" value="${item.name}" ${item.name === selectedSymbol ? 'checked' : ''}><span>${symbolIcon(item)}<small>${item.label}</small></span></label>`).join('')}</div></fieldset><label>Карточки<small>Термин и определение через «;»</small><textarea name="cards" rows="6" required placeholder="Train; Поезд\nTicket; Билет">${esc(set?.cards.map(c => c.slice(0, 2).join('; ')).join('\n') || '')}</textarea></label><div class="form-error" id="form-error" role="alert"></div><button class="primary" type="submit">${icon('check')} Сохранить набор</button></form>`);
  document.querySelector('#editor').onsubmit = e => {
    e.preventDefault(); const form = new FormData(e.target);
    let cards = form.get('cards').split('\n').filter(line => line.trim()).map(line => { const i = line.indexOf(';'); return i < 0 ? [] : [line.slice(0, i).trim(), line.slice(i + 1).trim()]; });
    if (!cards.length || cards.some(c => c.length !== 2 || !c[0] || !c[1])) { document.querySelector('#form-error').textContent = 'В каждой строке нужны термин и определение через ;'; return; }
    const title = form.get('title').trim(), name = cleanCategory(form.get('category'));
    if (!title || !name) { document.querySelector('#form-error').textContent = 'Название и категория не могут быть пустыми.'; return; }
    const category = data.categories.find(c => categoryKey(c) === categoryKey(name)) || name;
    const oldCards = [...(set?.cards || [])];
    cards = cards.map(card => {
      let i = oldCards.findIndex(c => c[0] === card[0] && c[1] === card[1]);
      if (i < 0) i = oldCards.findIndex(c => c[0] === card[0]);
      if (i >= 0) { const old = oldCards.splice(i, 1)[0]; card[2] = { ...old[2] }; if (old[1] !== card[1]) delete data.reviews[card[2].id]; }
      return card;
    });
    const symbol = symbols.find(s => s.name === form.get('symbol')) || symbols[0];
    const item = { id: set?.id || Math.max(Date.now(), ...data.sets.map(s => s.id + 1)), title, desc: form.get('desc').trim(), category, cards, symbol: symbol.name, color: symbol.color };
    if (!data.categories.includes(category)) data.categories.push(category);
    if (set) data.sets = data.sets.map(s => s.id === set.id ? item : s); else data.sets.push(item);
    ensurePracticeData(data); if (filter !== null) filter = category; query = '';
    const persisted = save(); render(); sound('correct'); notify(persisted ? 'Набор сохранён. Добавить картинку или аудио можно внутри набора.' : 'Набор создан, но браузер запретил сохранение.');
  };
}
function uniqueAnswers(set, side) { return set.cards.reduce((list, card) => { if (!list.some(s => normalize(s) === normalize(card[side]))) list.push(card[side]); return list; }, []); }
function validAnswers(set, card, currentDirection) {
  const side = currentDirection === 'reverse' ? 0 : 1;
  return new Set(set.cards.filter(candidate => normalize(candidate[1 - side]) === normalize(card[1 - side])).map(candidate => normalize(candidate[side])));
}
function distractors(set, card, currentDirection) {
  const valid = validAnswers(set, card, currentDirection);
  return uniqueAnswers(set, currentDirection === 'reverse' ? 0 : 1).filter(value => !valid.has(normalize(value)));
}
function openSet(id) {
  session = null; const set = data.sets.find(s => s.id === id); if (!set) return;
  const canTest = set.cards.every(card => distractors(set, card, direction).length > 0), due = getDueCards(data, set.id), clozeCards = set.cards.filter(card => buildCloze(card));
  modal(`${visual(set)}<h2>${esc(set.title)}</h2><p>${esc(set.desc)} · ${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])}</p><div class="direction-switch" aria-label="Направление обучения"><button data-direction="normal" class="${direction === 'normal' ? 'selected' : ''}">Термин → значение</button><button data-direction="reverse" class="${direction === 'reverse' ? 'selected' : ''}">Значение → термин</button></div><div class="mode-grid">${[['flash', 'layers', 'Карточки', 'Переворот, озвучка и повторение'], ['learn', 'book', 'Запоминание', 'Вводи ответ, ошибки вернутся'], ['test', 'target', 'Тест', 'Выбирай из 2–4 вариантов'], ['match', 'game', 'Найди пару', 'Сопоставь карточки на время'], ['review', 'rotate', 'Повторить', `${due.length} карточек по расписанию`], ['cloze', 'pencil', 'Пропуски', 'Вспоминай слова в предложениях'], ['listening', 'sound', 'Аудирование', 'Послушай и напиши слово'], ['pronunciation', 'mic', 'Произношение', 'Запиши и сравни с образцом']].map(([mode, glyph, label, desc]) => `<button data-mode="${mode}" ${mode === 'test' && !canTest || mode === 'review' && !due.length || mode === 'cloze' && !clozeCards.length ? 'disabled' : ''}>${icon(glyph)}<div><b>${label}</b><span>${desc}</span></div>${icon('arrow')}</button>`).join('')}</div>${!canTest ? '<div class="study-banner">Для каждого вопроса нужен хотя бы один вариант, который не является другим правильным ответом. Добавь карточки с другими значениями или выбери другой режим.</div>' : ''}${!clozeCards.length ? '<p class="study-banner">Для пропусков добавь пример с самим словом или выражением в разделе «Картинки, аудио и примеры».</p>' : ''}<button class="secondary" id="manage-media">${icon('image')} Картинки, аудио и примеры</button><div class="terms">${set.cards.map(c => `<div><b>${esc(c[0])}</b><span>${esc(c[1])}</span></div>`).join('')}</div>`);
  document.querySelectorAll('[data-direction]').forEach(button => button.onclick = () => { direction = button.dataset.direction; openSet(id); sound('click'); });
  document.querySelector('#manage-media').onclick = () => mediaManager(set);
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    if (button.dataset.mode === 'match') { startMatching(set); return; }
    if (button.dataset.mode === 'review') { startReview(set.id); return; }
    if (button.dataset.mode === 'pronunciation') { startPronunciation(set); return; }
    beginStudy(set, button.dataset.mode, shuffle(button.dataset.mode === 'cloze' ? clozeCards : set.cards));
  });
}
function beginStudy(set, mode, queue) {
  session = { set, mode, direction: ['cloze', 'listening'].includes(mode) ? 'normal' : direction, index: 0, correct: 0, streak: 0, flipped: false, answered: false, results: [], options: null, queue };
  sound('click'); study();
}
function startReview(setId = null) {
  const entries = getDueCards(data, setId);
  if (!entries.length) { notify('На сегодня всё повторено. Можно потренироваться в любом наборе.'); return; }
  const set = setId === null ? { id: null, title: 'Повторение на сегодня', cards: entries.map(e => e.card) } : data.sets.find(s => s.id === setId);
  beginStudy(set, 'review', entries.map(e => e.card));
}
function startMatching(set) {
  session = { set, mode: 'match', correct: 0, streak: 0 };
  modal(`<div id="match-game"></div>`); sound('click');
  matchController = mountMatching(document.querySelector('#match-game'), set.cards, { esc, icon, playSound, sounds: data.settings.sounds,
    onPair: card => { record(true, card); if (session.streak % 3 === 0) celebrate(); },
    onMistake: card => { record(false, card); },
    onFinish: () => { sound('complete'); }, onExit: () => openSet(set.id),
  });
}
function startPronunciation(set, index = 0) {
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
  const isCard = s.mode === 'flash' || s.mode === 'review';
  if (s.mode === 'test' && !s.options) s.options = choices(s.set, card, s.direction);
  const daily = dailyProgress(data), rank = rankProgress(data);
  let exercise;
  if (isCard) {
    exercise = `<button class="flashcard" id="flip" aria-label="${esc(prompt)}. Перевернуть карточку" aria-pressed="false"><div class="flashcard-inner"><div class="flash-face flash-front" aria-hidden="false"><span>${reverse ? 'Значение' : 'Термин'}</span><h2>${esc(prompt)}</h2></div><div class="flash-face flash-back" aria-hidden="true"><span>${reverse ? 'Термин' : 'Значение'}</span><h2>${esc(expected)}</h2></div></div><small class="flip-caption">${icon('rotate')} Нажми, чтобы перевернуть</small></button>${studyTools(card, true)}<div class="study-actions"><button class="secondary" id="again">${icon('rotate')} Ещё повторить</button><button class="primary" id="known">${icon('check')} Знаю</button></div>`;
  } else {
    let question;
    if (cloze) question = `<div class="question"><span>Впиши пропущенное слово или выражение</span><p class="cloze-sentence">${esc(cloze.before)}<span class="cloze-blank" aria-label="Пропущенные слова">••••</span>${esc(cloze.after)}</p></div><div class="study-tools"><button class="secondary" id="speak-term">${icon('sound')} Послушать предложение ${icon('wave')}</button></div>`;
    else if (listening) question = `<div class="listening-card"><div class="listening-icon">${icon('sound')}</div><h2>Слушай и пиши</h2><p class="listening-prompt">Послушай слово или выражение и напиши то, что услышал.</p><button class="primary" id="speak-term">${icon('sound')} Прослушать ${icon('wave')}</button></div>`;
    else question = `<div class="question"><span>${s.mode === 'test' ? 'Выбери правильный ответ' : 'Вспомни ответ'}</span><h2>${esc(prompt)}</h2></div>${studyTools(card, !reverse)}`;
    const answer = s.mode === 'test' ? `<div class="answer-options" aria-label="Варианты ответа">${s.options.map((option, index) => `<button class="answer-option" data-choice="${index}"><span class="option-key">${index + 1}</span><span class="option-text">${esc(option)}</span><span class="option-status"></span></button>`).join('')}</div><p class="test-caption">Один правильный ответ · можно нажать цифру варианта</p><div id="feedback" role="status" aria-live="polite"></div><button class="primary" id="next-question" disabled>Выбери ответ ${icon('arrow')}</button>` : `<form id="answer-form"><input id="answer" aria-label="Твой ответ" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${listening ? 'Напиши услышанное…' : cloze ? 'Пропущенное слово или выражение…' : 'Твой ответ…'}" required><div id="feedback" role="status" aria-live="polite"></div><button class="primary" type="submit">Проверить ${icon('arrow')}</button></form><button class="hint" id="hint">Нужна подсказка?</button>`;
    exercise = question + answer;
  }
  const labels = { flash: 'Карточки', review: 'Интервальное повторение', test: 'Тест', learn: 'Запоминание', cloze: 'Пропуски', listening: 'Аудирование' };
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
    document.querySelector('#again').onclick = () => { record(false, card); s.queue.push(card); sound('wrong'); nextCard(); };
    document.querySelector('#known').onclick = () => { record(true, card); sound('correct'); if (s.streak % 3 === 0) celebrate(); nextCard(); };
  } else if (s.mode === 'test') {
    document.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => chooseAnswer(Number(button.dataset.choice)));
    document.querySelector('#next-question').onclick = () => { if (s.answered) nextCard(); };
  } else {
    document.querySelector('#answer').focus();
    document.querySelector('#hint').onclick = e => { e.currentTarget.textContent = `Начинается с «${expected.slice(0, 2)}…»`; };
    document.querySelector('#answer-form').onsubmit = e => {
      e.preventDefault(); if (s.answered) { nextCard(); return; }
      const answer = document.querySelector('#answer').value; if (!answer.trim()) return;
      const ok = cloze ? evaluateCloze(answer, cloze) : listening ? evaluateListening(answer, listening) : validAnswers(s.set, card, s.direction).has(normalize(answer));
      if (!ok) s.queue.push(card);
      acceptAnswer(answer, ok); document.querySelector('#answer').disabled = true;
      document.querySelector('#answer-form button').innerHTML = `${nextLabel()} ${icon('arrow')}`; document.querySelector('#hint').remove(); document.querySelector('#answer-form button').focus();
    };
  }
}
function nextLabel() { return session.index === session.queue.length - 1 ? 'Посмотреть результат' : 'Следующая карточка'; }
function nextCard() { session.index++; session.answered = false; session.flipped = false; session.options = null; study(); }
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
  session.answered = true; record(ok, card); sound(ok ? 'correct' : 'wrong');
  session.results.push({ term: card[session.direction === 'reverse' ? 1 : 0], expected, answer, ok });
  document.querySelector('#feedback').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">${icon(ok ? 'check' : 'close')}<span>${ok ? 'Правильно!' : `Правильный ответ: ${esc(expected)}`}</span></div>`;
  const streak = document.querySelector('.streak'); streak.classList.toggle('is-hot', session.streak >= 3); streak.innerHTML = `${icon('bolt')} <span>${session.streak} подряд</span>`;
  const daily = dailyProgress(data); document.querySelector('.study-daily').textContent = `Сегодня: ${daily.answers} / ${daily.goal} ответов`;
  const rank = rankProgress(data); document.querySelector('.study-xp').textContent = `${rank.name} · ${rank.xp} XP`;
  if (ok && session.streak % 3 === 0) celebrate();
}
function record(ok, card) {
  const wasComplete = dailyProgress(data).complete;
  const experience = awardRankXP(data, card, ok, session.mode);
  session.correct += ok ? 1 : 0; session.streak = ok ? session.streak + 1 : 0;
  data.answers++; if (ok) data.learned++; scheduleReview(data, card, ok); recordDaily(data, ok); save();
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
function mediaManager(set) {
  session = null; let pendingUploads = 0;
  modal(`<div class="media-manager"><div class="eyebrow">${esc(set.title)}</div><h2>Картинки, аудио и примеры</h2><p>Загрузи картинку или свою аудиозапись. Файлы до 8 МБ сохраняются в этом браузере.</p>${set.cards.map(card => `<section class="media-row" data-card-id="${esc(card[2].id)}"><h3>${esc(card[0])}</h3><p>${esc(card[1])}</p><div class="media-fields"><label>Пример использования<textarea data-example="${esc(card[2].id)}" rows="2" placeholder="Например: I need a ticket to London.">${esc(card[2].example || '')}</textarea></label><div class="attachment-field"><label>${icon('image')} Картинка<input type="file" data-upload-kind="image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>${card[2].imageId ? `<span>${esc(card[2].imageName || 'Картинка')}</span><button class="text-button" data-remove-kind="image">Удалить картинку</button>` : ''}</div><div class="attachment-field"><label>${icon('sound')} Аудиозапись<input type="file" data-upload-kind="audio" accept="audio/*"></label>${card[2].audioId ? `<span>${esc(card[2].audioName || 'Аудио')}</span><button class="text-button" data-remove-kind="audio">Удалить аудио</button>` : ''}</div></div><div class="upload-status" role="status"></div><div class="attachment-preview">${attachmentMarkup(card, esc)}</div></section>`).join('')}<div class="form-error" id="media-error" role="alert"></div><button class="primary" id="save-media">${icon('check')} Готово</button></div>`);
  const manager = document.querySelector('.media-manager'), doneButton = manager.querySelector('#save-media');
  const updateBusy = () => {
    if (!manager.isConnected) return;
    doneButton.disabled = pendingUploads > 0;
    doneButton.innerHTML = pendingUploads ? 'Сохраняю вложение…' : `${icon('check')} Готово`;
    manager.querySelectorAll('[data-remove-kind]').forEach(button => { button.disabled = pendingUploads > 0; });
  };
  const removeFromManager = async (card, kind) => {
    if (pendingUploads) return;
    pendingUploads++;
    manager.querySelectorAll('[data-upload-kind]').forEach(input => { input.disabled = true; }); updateBusy();
    const updated = await removeMedia(card, kind);
    pendingUploads--;
    if (!manager.isConnected) return;
    if (updated) mediaManager(set);
    else { manager.querySelectorAll('[data-upload-kind]').forEach(input => { input.disabled = false; }); updateBusy(); }
  };
  hydrateAttachments(manager);
  document.querySelectorAll('[data-example]').forEach(input => input.oninput = () => { const card = set.cards.find(c => c[2].id === input.dataset.example); card[2].example = input.value.slice(0, 500); if (!save()) document.querySelector('#media-error').textContent = 'Браузер запретил сохранение примеров.'; });
  document.querySelectorAll('[data-upload-kind]').forEach(input => input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const row = input.closest('.media-row'), card = set.cards.find(c => c[2].id === row.dataset.cardId), kind = input.dataset.uploadKind;
    const status = row.querySelector('.upload-status'); status.textContent = 'Сохраняю файл…'; input.disabled = true; pendingUploads++;
    updateBusy();
    try {
      const attachment = await storeAttachment(file, kind), oldId = card[2][`${kind}Id`];
      if (!manager.isConnected) { await removeAttachment(attachment.id); return; }
      const oldMeta = { ...card[2] }; card[2][`${kind}Id`] = attachment.id; card[2][`${kind}Name`] = attachment.name;
      if (!save()) { card[2] = oldMeta; await removeAttachment(attachment.id); throw new Error('Браузер запретил сохранение карточки.'); }
      if (oldId) await removeAttachment(oldId);
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
  document.querySelectorAll('[data-remove-kind]').forEach(button => button.onclick = () => { const card = set.cards.find(c => c[2].id === button.closest('.media-row').dataset.cardId); removeFromManager(card, button.dataset.removeKind); });
  doneButton.onclick = () => { if (pendingUploads) return; const persisted = save(); openSet(set.id); notify(persisted ? 'Карточки сохранены' : 'Браузер запретил сохранение'); };
}
async function removeMedia(card, kind) {
  const id = card[2][`${kind}Id`], previous = { ...card[2] };
  delete card[2][`${kind}Id`]; delete card[2][`${kind}Name`];
  if (!save()) { card[2] = previous; notify('Не удалось сохранить удаление.'); return false; }
  try { await removeAttachment(id); } catch { notify('Вложение убрано из карточки, но браузер не смог удалить файл.'); }
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
  if (!session || session.mode !== 'test' || session.answered || e.repeat || e.altKey || e.ctrlKey || e.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (/^[1-4]$/.test(e.key)) { e.preventDefault(); chooseAnswer(Number(e.key) - 1); }
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(page === 'settings' && settingsDraft ? settingsDraft : data.settings));
save(); render();
