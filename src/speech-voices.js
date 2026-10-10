const voiceId = voice => voice.voiceURI || `${voice.name}|${voice.lang}`;

export function voiceQuality(voice) {
  const name = String(voice.name || '').toLowerCase();
  const weights = { natural: 120, neural: 110, online: 80, premium: 75, enhanced: 70, google: 65, samantha: 60, aria: 55, jenny: 55 };
  let score = Object.entries(weights).reduce((sum, [word, value]) => sum + (name.includes(word) ? value : 0), 0);
  if (/espeak|mbrola/.test(name)) score -= 300;
  if (/compact/.test(name)) score -= 150;
  return score;
}

export function rankSpeechVoices(voices, language = 'en-US') {
  const lang = String(language).replace(/_/g, '-').toLowerCase(), prefix = lang.split('-')[0];
  return [...voices].filter(voice => String(voice.lang).replace(/_/g, '-').toLowerCase().split('-')[0] === prefix)
    .sort((a,b) => {
      const exact = voice => String(voice.lang).replace(/_/g, '-').toLowerCase() === lang ? 1 : 0;
      return exact(b) - exact(a) || voiceQuality(b) - voiceQuality(a) || Number(Boolean(b.default)) - Number(Boolean(a.default)) || String(a.name).localeCompare(String(b.name));
    });
}

export function selectSpeechVoice(voices, language, requested = 'auto', { localOnly = false } = {}) {
  const ranked = rankSpeechVoices(voices, language).filter(voice => !localOnly || voice.localService !== false);
  return ranked.find(voice => voiceId(voice) === requested || voice.voiceURI === requested) || ranked[0] || null;
}

export function describeSpeechVoice(voice) {
  return { id: voiceId(voice), name: String(voice.name), lang: String(voice.lang), localService: voice.localService !== false, type: /espeak/i.test(voice.name) ? 'fallback' : voice.localService === false ? 'online' : 'local', quality: voiceQuality(voice) };
}

export function voiceSetupInstruction(platform = globalThis.navigator?.userAgent || '') {
  if (/iPhone|iPad|iPod/i.test(platform)) return { platform: 'iPhone / iPad', text: 'Настройки → Универсальный доступ → Устный контент → Голоса → Английский. Скачай улучшенный голос.', url: 'https://support.apple.com/guide/iphone/hear-whats-on-the-screen-or-typed-iph96b214f0/ios' };
  if (/Android/i.test(platform)) return { platform: 'Android', text: 'Настройки → Специальные возможности → Синтез речи. Выбери Google и установи английские голосовые данные.', url: 'https://support.google.com/accessibility/android/answer/6006983?hl=ru' };
  if (/Mac/i.test(platform)) return { platform: 'macOS', text: 'Системные настройки → Универсальный доступ → Устный контент → Голос. Скачай Samantha Enhanced или другой улучшенный английский голос.', url: 'https://support.apple.com/guide/mac-help/change-spoken-content-settings-mchlp2290/mac' };
  if (/Windows/i.test(platform)) return { platform: 'Windows', text: 'Установи английскую речь в параметрах языка и проверь голоса Edge. Если браузер не показывает хороший голос, скачай Piper в настройках zhekandus.', url: 'https://support.microsoft.com/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01' };
  return { platform: /Linux/i.test(platform) ? 'Linux' : 'браузер', text: 'В этом браузере может не быть естественных системных голосов. В настройках zhekandus выбери Piper, скачай английскую модель и нажми «Проверить Piper». После загрузки он работает без интернета.', url: 'https://github.com/rhasspy/piper#readme' };
}

export function speechDescription(info) {
  const type = { online: 'онлайн', local: 'локальный', fallback: 'запасной' }[info.type] || info.type;
  return `Голос: ${info.name} · ${type} · ${info.lang}${info.cached ? ' · аудио из кэша' : ''}`;
}
