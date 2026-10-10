let prompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
window.addEventListener('appinstalled', () => { prompt = null; });
export async function installApplication() {
  const status = document.querySelector('#install-status');
  if (prompt) { await prompt.prompt(); await prompt.userChoice; prompt = null; }
  else if (status) status.textContent = document.querySelector('link[rel="manifest"]') && location.protocol !== 'file:'
    ? 'На iPhone: «Поделиться» → «На экран Домой». На Android: меню браузера → «Установить приложение».'
    : 'Для установки нужна веб-версия через HTTPS. В ZIP есть папка web; отдельный HTML продолжает работать без установки.';
}
export function startPWA() {
  if (!import.meta.env.DEV && document.querySelector('link[rel="manifest"]') && location.protocol !== 'file:' && navigator.serviceWorker) {
    navigator.serviceWorker.register(new URL('./sw.js', location.href)).catch(() => {});
  }
}
