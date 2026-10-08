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
const script = gzipSync(entries[0].code, { level: 9 }).toString('base64');
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
<style>${css}</style></head><body><div id="app"><p role="status" style="padding:32px;font:20px Arial,sans-serif">Запускаю zhekandus…</p></div>
<script type="module">
let source;
try {
  if (!globalThis.DecompressionStream) throw new Error('Открой файл в актуальной версии Chrome, Edge, Firefox или Safari.');
  const binary = atob('${script}');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  source = URL.createObjectURL(new Blob([await new Response(stream).arrayBuffer()], { type: 'text/javascript' }));
  await import(source);
} catch (error) {
  const app = document.getElementById('app');
  const message = document.createElement('p');
  message.style.cssText = 'padding:32px;font:20px/1.5 Arial,sans-serif';
  message.textContent = 'Не удалось запустить zhekandus. Скачай HTML-файл и открой его в браузере. ' + (error?.message || '');
  app.replaceChildren(message);
} finally {
  if (source) URL.revokeObjectURL(source);
}
</script></body></html>`;
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html, 'utf8');
await chmod(destination, 0o644);
console.log(`Standalone app: ${destination} (${Buffer.byteLength(html)} bytes)`);
