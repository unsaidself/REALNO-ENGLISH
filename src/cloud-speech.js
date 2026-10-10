export const cloudDefaults = {
  openai: { voice: 'coral', model: 'gpt-4o-mini-tts' },
  google: { voice: 'en-US-Neural2-F' },
  azure: { voice: 'en-US-JennyNeural', region: 'westeurope' },
};

export function cloudSpeechIdentity(config = {}, lang = 'en-US') {
  const provider = ['openai','google','azure'].includes(config.provider) ? config.provider : 'openai';
  const defaults = cloudDefaults[provider], voice = String(config.voice || defaults.voice).trim(), accent = voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0];
  return { engine: 'cloud', type: 'online', provider, voice, name: `${{openai:'OpenAI',google:'Google Cloud',azure:'Azure'}[provider]} · ${voice}`, model: String(config.model || defaults.model || ''), region: String(config.region || defaults.region || '').toLowerCase(), lang: provider === 'openai' ? lang : accent || lang };
}

function xmlEscape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }

export function cloudSpeechRequest(text, { config, lang = 'en-US', rate = .9, key } = {}) {
  const identity = cloudSpeechIdentity(config,lang);
  if (!key) throw new Error('Добавь API-ключ выбранного провайдера в настройках «Живого голоса».');
  const headers = { 'Content-Type': 'application/json' };
  let url, body;
  if (identity.provider === 'openai') {
    url = 'https://api.openai.com/v1/audio/speech'; headers.Authorization = `Bearer ${key}`;
    body = JSON.stringify({ model: identity.model, voice: identity.voice, input: text, response_format: 'mp3', speed: rate, ...(identity.model === 'gpt-4o-mini-tts' ? { instructions: lang === 'en-GB' ? 'Speak clearly in a natural British English accent.' : lang === 'en-US' ? 'Speak clearly in a natural American English accent.' : 'Speak clearly and naturally in the language of the text.' } : {}) });
  } else if (identity.provider === 'google') {
    url = 'https://texttospeech.googleapis.com/v1/text:synthesize'; headers['X-Goog-Api-Key'] = key;
    body = JSON.stringify({ input: { text }, voice: { languageCode: identity.lang, name: identity.voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } });
  } else {
    if (!/^[a-z0-9]{2,35}$/.test(identity.region)) throw new Error('Укажи регион Azure, например westeurope или eastus.');
    url = `https://${identity.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    headers['Content-Type'] = 'application/ssml+xml'; headers['Ocp-Apim-Subscription-Key'] = key; headers['X-Microsoft-OutputFormat'] = 'audio-24khz-48kbitrate-mono-mp3';
    const percent = Math.round((rate - 1) * 100);
    body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlEscape(identity.lang)}"><voice name="${xmlEscape(identity.voice)}"><prosody rate="${percent >= 0 ? '+' : ''}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`;
  }
  return { url, options: { method: 'POST', headers, body }, identity };
}

export async function synthesizeCloudSpeech(text, { config, lang, rate, key, signal, fetcher = globalThis.fetch } = {}) {
  const request = cloudSpeechRequest(text,{config,lang,rate,key}), controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort,30000);
  try {
    const response = await fetcher(request.url,{...request.options,signal:controller.signal});
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'Провайдер отклонил ключ или доступ к голосу. Проверь ключ и разрешение TTS.' : response.status === 429 ? 'Лимит запросов или средств у провайдера. Использую следующий доступный голос.' : `Провайдер озвучки вернул ошибку ${response.status}. Проверь голос и модель в настройках.`;
      throw new Error(message);
    }
    let blob;
    if (request.identity.provider === 'google') {
      try {
        const result = await response.json();
        if (typeof result.audioContent !== 'string' || result.audioContent.length > 12000000) throw new Error();
        const bytes = Uint8Array.from(atob(result.audioContent), c => c.charCodeAt(0)); blob = new Blob([bytes],{type:'audio/mpeg'});
      } catch { throw new Error('Google не вернул корректное аудио.'); }
    } else blob = new Blob([await response.arrayBuffer()],{type:'audio/mpeg'});
    if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Ответ TTS пустой или больше 8 МБ. Выбери более короткую фразу.');
    // Reject successful JSON/HTML error bodies before they poison the audio cache.
    const bytes = new Uint8Array(await blob.slice(0,12).arrayBuffer());
    const prefix = new TextDecoder().decode(bytes);
    const mp3 = prefix.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    const wav = prefix.startsWith('RIFF') && prefix.slice(8,12) === 'WAVE';
    if (!mp3 && !wav) throw new Error('Провайдер вернул данные без аудио. Запись не сохранена; проверь настройки голоса.');
    return { blob, info: request.identity };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Озвучка отменена.','AbortError');
    if (controller.signal.aborted) throw new Error('Облачный голос не ответил за 30 секунд. Использую следующий доступный голос.');
    if (error instanceof TypeError) throw new Error('Облачный голос недоступен: проверь интернет и поддержку запросов из браузера.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
}

export async function speechCacheKey(text, { lang, rate, identity }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ text:String(text).trim(),lang,rate,identity }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
