import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(process.argv[2] || resolve(root, 'dist/zhekandus.html'));
// Bundle local modules before embedding: the downloadable file needs no server.
const result = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, cssCodeSplit: false, rollupOptions: { input: resolve(root, 'index.html') },
} });
const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
const entries = output.filter(item => item.type === 'chunk' && item.isEntry);
if (entries.length !== 1 || entries[0].imports.length || entries[0].dynamicImports.length) {
  throw new Error('Standalone build must contain one self-contained JavaScript entry.');
}
// Compress the complete JavaScript bundle, including voice data. The browser
// expands it locally; no URL, CDN, fetch, or additional file is needed.
const moduleBytes = Buffer.from(entries[0].code, 'utf8');
const compressedBytes = gzipSync(moduleBytes, { level: 9 });
const script = compressedBytes.toString('base64');
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
const speechNotice = await readFile(resolve(root, 'src/voice/NOTICE'), 'utf8');
const speechLicense = await readFile(resolve(root, 'src/voice/LICENSE'), 'utf8');
const licenseComment = `${speechNotice}\n${speechLicense}`;
if (/-->|--!>/.test(licenseComment)) throw new Error('Speech license must be embedded as a safe, verbatim HTML comment.');
const html = `<!doctype html>
<!-- Local speech engine license and source information:\n${licenseComment}\n-->
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f5f7f3">
<title>zhekandus — карточки, игры и повторение</title>
<style>${css}</style></head><body><div id="app"><p data-zhekandus-startup role="status" style="padding:32px;font:20px Arial,sans-serif">Запускаю zhekandus…</p></div>
<script>
// This small, uncompressed watchdog also runs when the module is truncated or
// cannot be parsed. It never replaces the app's own storage recovery panel.
(() => {
  let finished = false;
  const app = document.getElementById('app');
  const showFailure = reason => {
    if (!app || app.querySelector('.startup-error')) return;
    const panel = document.createElement('section');
    panel.className = 'startup-error loader-startup-error';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'max-width:760px;margin:32px auto;padding:24px;font:20px/1.5 Arial,sans-serif;overflow-wrap:anywhere';
    const heading = document.createElement('h1');
    heading.textContent = 'Не удалось запустить zhekandus';
    heading.style.cssText = 'font-size:28px;line-height:1.25';
    const message = document.createElement('p');
    message.textContent = reason;
    const help = document.createElement('p');
    help.textContent = 'Перезагрузи страницу. Если ошибка повторяется, скачай свежий архив, распакуй его и открой zhekandus.html в браузере.';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'primary';
    reload.textContent = 'Перезагрузить';
    reload.addEventListener('click', () => location.reload());
    const download = document.createElement('a');
    download.className = 'secondary';
    download.href = 'https://github.com/unsaidself/REALNO-ENGLISH/raw/refs/heads/codex/zhekandus-download-20261008/zhekandus.zip';
    download.textContent = 'Скачать свежий файл';
    actions.append(reload, download);
    panel.append(heading, message, help, actions);
    app.replaceChildren(panel);
  };
  const watchdog = setTimeout(() => {
    if (!finished && app?.querySelector('[data-zhekandus-startup]')) {
      finished = true;
      showFailure('Запуск не завершился. HTML-файл мог повредиться или загрузиться не полностью.');
    }
  }, 12000);
  globalThis.__zhekandusBoot = {
    fail(reason) { finished = true; clearTimeout(watchdog); showFailure(reason); },
    done() { finished = true; clearTimeout(watchdog); },
  };
})();
</script>
<script type="module">
let source;
let phase = 'decode';
const startup = globalThis.__zhekandusBoot;
try {
  if (!globalThis.DecompressionStream) throw new Error('Этот браузер не поддерживает распаковку приложения. Открой файл в актуальной версии Chrome, Edge, Firefox или Safari.');
  const encoded = '${script}';
  if (encoded.length !== ${script.length} || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Данные приложения в HTML-файле повреждены или обрезаны (Base64).');
  }
  let binary;
  try { binary = atob(encoded); } catch { throw new Error('Не удалось декодировать данные приложения (Base64).'); }
  if (btoa(binary) !== encoded) throw new Error('Данные приложения содержат некорректную строку Base64.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length !== ${compressedBytes.length} || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) {
    throw new Error('Сжатые данные приложения повреждены. Нужен полный HTML-файл с корректным архивом gzip.');
  }
  phase = 'decompress';
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const module = await new Response(stream).arrayBuffer();
  if (module.byteLength !== ${moduleBytes.length}) throw new Error('Распакованный код приложения обрезан.');
  phase = 'module';
  source = URL.createObjectURL(new Blob([module], { type: 'text/javascript' }));
  await import(source);
} catch (error) {
  const reason = phase === 'decompress'
    ? 'Не удалось распаковать приложение. Сжатые данные HTML-файла повреждены или обрезаны.'
    : phase === 'module'
      ? 'Не удалось выполнить код приложения. ' + String(error?.message || 'Неизвестная ошибка.').slice(0, 500)
      : String(error?.message || 'Не удалось прочитать данные приложения.').slice(0, 500);
  startup.fail(reason);
} finally {
  if (source) URL.revokeObjectURL(source);
  startup.done();
  delete globalThis.__zhekandusBoot;
}
</script></body></html>`;
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html, 'utf8');
await chmod(destination, 0o644);
console.log(`Standalone app: ${destination} (${Buffer.byteLength(html)} bytes)`);
