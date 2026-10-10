/** Keep the current form and controllers mounted while asking about an exit. */
export function protectModal({ isDirty, save, discard, message = 'Есть несохранённые изменения. Сохранить их перед выходом?' }) {
  return close => {
    if (!isDirty()) { close(); return; }
    const dialog = document.querySelector('.modal');
    if (!dialog || dialog.querySelector('.exit-confirmation')) return;
    const previous = document.activeElement;
    const panel = document.createElement('section'); panel.className = 'exit-confirmation'; panel.setAttribute('role', 'alert');
    const heading = document.createElement('h3'); heading.textContent = save ? 'Сохранить изменения?' : 'Закончить занятие?';
    const text = document.createElement('p'); text.textContent = message;
    const actions = document.createElement('div'); actions.className = 'study-actions';
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'secondary'; keep.id = 'keep-editing'; keep.textContent = save ? 'Продолжить редактировать' : 'Продолжить занятие';
    keep.onclick = () => { panel.remove(); if (previous?.isConnected) previous.focus(); };
    const leave = document.createElement('button'); leave.type = 'button'; leave.className = 'secondary danger-text'; leave.id = 'discard-editing'; leave.textContent = save ? 'Выйти без сохранения' : 'Закончить';
    leave.onclick = () => { discard?.(); close(); };
    actions.append(keep);
    if (save) { const button = document.createElement('button'); button.type = 'button'; button.className = 'primary'; button.id = 'save-and-close'; button.textContent = 'Сохранить и выйти'; button.onclick = () => { panel.remove(); save(); }; actions.append(button); }
    actions.append(leave); panel.append(heading, text, actions); dialog.prepend(panel); keep.focus();
  };
}
