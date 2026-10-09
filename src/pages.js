import { createBackup, inspectBackup, restoreBackup, parseImport, stageImport, discardStaged, commitStaged, exportCSV } from './portability.js';
import { rankProgress, rankCatalog } from './ranks.js';

export function ranksPage(data, icon, esc) {
  const rank = rankProgress(data);
  return `<section class="rank-summary" data-rank-level="${rank.level}" data-rank="${rankCatalog[rank.level - 1].id}"><div class="rank-emblem" data-rank-level="${rank.level}">${icon('trophy')}<span>${rank.level}</span></div><div><span class="panel-label">Твой ранг</span><h2>${esc(rank.name)}</h2><p>Каждый правильный ответ — ещё один шаг вперёд.</p><div class="rank-xp"><strong id="rank-total-xp">${rank.xp} XP</strong><span>${rank.nextName ? `До ранга «${esc(rank.nextName)}» — ${rank.remaining} XP` : 'Ты достиг высшего ранга'}</span></div><div class="rank-track" role="progressbar" aria-label="До следующего ранга" aria-valuenow="${Math.round(rank.progress)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${rank.progress}%"></i></div><p class="rank-progress-label">${rank.nextXP ? `${rank.earned} / ${rank.nextXP - rankCatalog[rank.level - 1].xp} XP в этом ранге` : 'Продолжай практику и накапливай опыт'}</p><button class="primary" id="ranks-practice">Учиться дальше ${icon('arrow')}</button></div></section><section class="rank-ladder" aria-label="Все ранги">${rankCatalog.map(item => `<article class="rank-card ${item.level === rank.level ? 'current' : item.level < rank.level ? 'unlocked' : 'locked'}" data-rank="${item.id}" data-rank-level="${item.level}"><div class="rank-emblem" data-rank-level="${item.level}">${icon(item.level <= rank.level ? 'trophy' : 'lock')}</div><span>Ранг ${item.level}</span><h3>${esc(item.name)}</h3><p>${item.xp} XP</p><b>${item.level === rank.level ? 'Твой ранг' : item.level < rank.level ? 'Открыт' : `Ещё ${Math.max(0, item.xp - rank.xp)} XP`}</b></article>`).join('')}</section><p class="rank-rules">+10 XP за правильный ответ. Одна карточка приносит опыт до трёх раз за день. Ошибки не отнимают опыт. Прежние правильные ответы тоже учтены.</p>`;
}

export function storagePage(icon, data) {
  return `<div class="storage-view"><div class="storage-grid"><section class="storage-panel"><span class="panel-label">На твоём устройстве</span><h2>${icon('archive')} Резервная копия</h2><p>Один файл со всеми наборами, категориями, прогрессом, рангами, настройками, картинками и аудио.</p><button class="primary" id="backup-download">${icon('download')} Скачать копию</button><p class="transfer-status" id="backup-status" role="status"></p></section><section class="storage-panel"><span class="panel-label">Вернуть сохранённое</span><h2>${icon('rotate')} Восстановление</h2><p>Выбери файл копии zhekandus. Перед восстановлением увидишь его содержимое.</p><label class="file-picker" for="restore-file">Выбрать резервную копию<input type="file" id="restore-file" accept=".json,application/json"></label><div id="restore-preview" class="transfer-preview"></div><p class="transfer-status" id="restore-status" role="status"></p></section></div><section class="storage-panel import-panel"><span class="panel-label">Перенести карточки</span><h2>${icon('import')} Импорт CSV и Anki</h2><p>CSV с термином и определением или текстовый экспорт Anki (.txt и .tsv). Новые наборы добавятся к твоей коллекции.</p><div class="transfer-actions"><label class="file-picker" for="import-file">Выбрать файл<input type="file" id="import-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"></label><button class="secondary" id="csv-download" ${!data.sets.some(set => set.cards.length) ? 'disabled' : ''}>${icon('download')} Экспорт CSV</button></div><p class="transfer-status" id="csv-status" role="status"></p><p class="import-format">CSV: «термин,определение» или «термин;определение». Необязательные столбцы: «пример», «категория», «набор» (или example, category, title). CSV переносит текст карточек; прогресс и вложения сохраняются в резервной копии.</p><div id="import-preview" class="import-preview"></div><p class="transfer-status" id="import-status" role="status"></p></section><p class="storage-note">Файлы обрабатываются на твоём устройстве. Копии и записи никуда не отправляются.</p></div>`;
}

const summaryMarkup = (summary, countLabel) => `<div class="summary-chips"><span>${countLabel(summary.sets, ['набор', 'набора', 'наборов'])}</span><span>${countLabel(summary.cards, ['карточка', 'карточки', 'карточек'])}</span><span>${countLabel(summary.attachments, ['вложение', 'вложения', 'вложений'])}</span></div>`;
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
export function bindStorage({ getData, onRestore, onImport, onSuccess, onBackup, notify, esc, countLabel }) {
  const view = document.querySelector('.storage-view');
  let busy = false, snapshot = null, imported = null;
  const setBusy = value => {
    busy = value;
    if (view.isConnected) {
      view.querySelectorAll('input,button').forEach(control => { control.disabled = value; });
      if (!value) view.querySelector('#csv-download').disabled = !getData().sets.some(set => set.cards.length);
    }
  };
  const errorText = error => error?.message || 'Не получилось обработать файл. Попробуй ещё раз.';
  view.querySelector('#backup-download').onclick = async () => {
    if (busy) return; setBusy(true);
    const status = view.querySelector('#backup-status'); status.textContent = 'Собираю карточки и вложения…';
    try {
      const timestamp = Date.now(), copy = structuredClone(getData()); copy.lastBackupAt = timestamp;
      const blob = await createBackup(copy);
      if (!view.isConnected) return;
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      download(blob, `zhekandus-backup-${date}.json`); onBackup?.(timestamp); status.textContent = 'Копия готова. Сохрани скачанный файл в надёжном месте.';
    } catch (error) { if (view.isConnected) status.textContent = errorText(error); }
    finally { setBusy(false); }
  };
  view.querySelector('#csv-download').onclick = () => {
    if (busy) return;
    const status = view.querySelector('#csv-status');
    try { download(exportCSV(getData()), 'zhekandus-cards.csv'); status.textContent = 'CSV готов: термин, определение, пример, категория и набор.'; }
    catch (error) { status.textContent = errorText(error); }
  };
  view.querySelector('#restore-file').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy) return;
    setBusy(true); snapshot = null;
    const status = view.querySelector('#restore-status'), preview = view.querySelector('#restore-preview');
    preview.innerHTML = ''; status.textContent = 'Проверяю копию…';
    try {
      const result = await inspectBackup(file); if (!view.isConnected) return;
      snapshot = result;
      preview.innerHTML = `${summaryMarkup(result.summary, countLabel)}<p>${countLabel(result.summary.answers, ['ответ', 'ответа', 'ответов'])} сохранено в прогрессе. Текущие наборы, прогресс и настройки будут заменены содержимым этой копии.</p><button class="primary" id="restore-confirm">Восстановить эту копию</button>`;
      status.textContent = 'Файл проверен. Восстановление начнётся после нажатия кнопки.';
      preview.querySelector('#restore-confirm').onclick = async () => {
        if (busy || !snapshot) return; setBusy(true); status.textContent = 'Восстанавливаю вложения и прогресс…';
        let restored;
        try {
          restored = await restoreBackup(snapshot);
          if (!view.isConnected) { await discardStaged(restored); return; }
          if (!await onRestore(restored)) { await discardStaged(restored); throw new Error('Не удалось сохранить восстановление. Твои текущие данные сохранены.'); }
          await commitStaged(restored); onSuccess(); notify('Резервная копия восстановлена');
        } catch (error) { if (restored) await discardStaged(restored).catch(() => {}); if (view.isConnected) status.textContent = errorText(error); }
        finally { setBusy(false); }
      };
    } catch (error) { if (view.isConnected) status.textContent = errorText(error); }
    finally { setBusy(false); }
  };
  view.querySelector('#import-file').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy) return;
    setBusy(true); imported = null;
    const status = view.querySelector('#import-status'), preview = view.querySelector('#import-preview');
    preview.innerHTML = ''; status.textContent = 'Читаю карточки…';
    try {
      const result = await parseImport(file); if (!view.isConnected) return;
      imported = result;
      preview.innerHTML = `${summaryMarkup(result.summary, countLabel)}${result.sets.slice(0,5).map(set => `<div><h3>${esc(set.title)}</h3><p>${countLabel(set.cards.length, ['карточка', 'карточки', 'карточек'])} · ${esc(set.category)}</p><div class="terms">${set.cards.slice(0,3).map(card=>`<div><b>${esc(card[0])}</b><span>${esc(card[1])}</span></div>`).join('')}</div></div>`).join('')}${result.warnings?.length ? `<p>${result.warnings.map(esc).join('<br>')}</p>` : ''}<button class="primary" id="import-confirm">Добавить наборы в коллекцию</button>`;
      status.textContent = 'Проверь карточки и нажми «Добавить».';
      preview.querySelector('#import-confirm').onclick = async () => {
        if (busy || !imported) return; setBusy(true); status.textContent = 'Сохраняю наборы и вложения…';
        let sets;
        try {
          sets = await stageImport(imported);
          if (!view.isConnected) { await discardStaged(sets); return; }
          if (!await onImport(sets)) { await discardStaged(sets); throw new Error('Не удалось сохранить импорт. Твоя коллекция не изменена.'); }
          await commitStaged(sets); onSuccess(); notify(`Импортировано: ${countLabel(sets.length, ['набор', 'набора', 'наборов'])}`);
        } catch (error) { if (sets) await discardStaged(sets).catch(() => {}); if (view.isConnected) status.textContent = errorText(error); }
        finally { setBusy(false); }
      };
    } catch (error) { if (view.isConnected) status.textContent = errorText(error); }
    finally { setBusy(false); }
  };
}
