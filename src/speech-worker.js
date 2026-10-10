import { generateSpeech } from './voice/speak-browser.js';

let jobs = Promise.resolve();

function utf8Text(text) {
  // This Emscripten release accepts a byte string instead of a Unicode string.
  // Convert explicitly so Cyrillic, accents and typographic punctuation survive.
  const bytes = new TextEncoder().encode(text);
  let output = '';
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

async function synthesize({ id, text, lang, rate }) {
  try {
    const voice = String(lang).toLowerCase().startsWith('ru') ? 'ru' : String(lang).toLowerCase() === 'en-gb' ? 'en/en' : 'en/en-us';
    const numericRate = Number(rate);
    const speed = Number.isFinite(numericRate) ? Math.max(0.5, Math.min(1.5, numericRate)) : 0.9;
    // generateSpeech creates a fresh CLI/FS instance for each request.
    const wav = generateSpeech(utf8Text(String(text)), { voice, speed: Math.round(175 * speed) });
    if (wav.length < 44 || String.fromCharCode(...wav.subarray(0, 4)) !== 'RIFF') throw new Error('The local engine returned no audio.');
    const buffer = wav.byteOffset === 0 && wav.byteLength === wav.buffer.byteLength
      ? wav.buffer : wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
    self.postMessage({ id, wav: buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Local speech synthesis failed.' });
  }
}

self.onmessage = event => {
  const request = event.data;
  jobs = jobs.then(() => synthesize(request), () => synthesize(request));
};
