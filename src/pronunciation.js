import { stopAudio } from './media.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SECONDS = 30;
const escapeText = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const audioFile = file => /^audio\//i.test(file.type) || /\.(?:wav|mp3|m4a|aac|ogg|oga|webm|mp4|flac)$/i.test(file.name || '');

function microphoneError(error) {
  const messages = {
    NotAllowedError: 'Доступ к микрофону запрещён. Разреши его в настройках браузера или загрузи свою аудиозапись ниже.',
    SecurityError: 'Браузер запретил микрофон на этой странице. Открой приложение в Chrome, Edge или Safari либо загрузи аудиофайл.',
    NotFoundError: 'Микрофон не найден. Подключи его или загрузи свою аудиозапись ниже.',
    DevicesNotFoundError: 'Микрофон не найден. Подключи его или загрузи свою аудиозапись ниже.',
    NotReadableError: 'Не удалось открыть микрофон. Проверь, не занят ли он другим приложением, или загрузи аудиофайл.',
    TrackStartError: 'Не удалось открыть микрофон. Проверь, не занят ли он другим приложением, или загрузи аудиофайл.',
    OverconstrainedError: 'Этот микрофон недоступен. Выбери другой в настройках браузера или загрузи аудиофайл.',
  };
  return messages[error?.name] || 'Не удалось записать голос. Проверь микрофон и разрешения браузера или загрузи готовую аудиозапись.';
}

/** A local recording workspace. Microphone access begins only after a click. */
export function mountPronunciation(container, card, { esc = escapeText, icon = () => '', pronounce = async () => ({ ok: false, message: 'Озвучка недоступна.' }), sound = () => {}, notify = () => {}, onExit = () => {} } = {}) {
  const term = String(card?.[0] || '').trim();
  const definition = String(card?.[1] || '').trim();
  let destroyed = false;
  let requestEpoch = 0;
  let playbackEpoch = 0;
  let recordingState = 'idle';
  let stream = null;
  let recorder = null;
  let recordingURL = null;
  let startedAt = 0;
  let clock = null;
  let deadline = null;
  let meterContext = null;
  let meterSource = null;
  let meterFrame = null;

  container.innerHTML = `<section class="pronunciation-mode" aria-label="Тренировка произношения">
    <div class="pronunciation-heading"><div class="eyebrow">Произношение</div><h2>${esc(term)}</h2>${definition ? `<p>${esc(definition)}</p>` : ''}</div>
    <div class="pronunciation-grid">
      <section class="pronunciation-panel" aria-label="Образец произношения"><h3>1. Послушай образец</h3><p>Обрати внимание на ударение, звуки и ритм.</p><div class="pronunciation-controls"><button class="secondary" type="button" data-pron-sample>${icon('sound')} Образец</button><label>Скорость <select data-pron-rate aria-label="Скорость образца"><option value="0.65">Медленно</option><option value="0.9" selected>Обычно</option><option value="1.1">Быстрее</option></select></label></div></section>
      <section class="pronunciation-panel" aria-label="Твоя запись"><h3>2. Повтори своим голосом</h3><p>Запиши до ${MAX_SECONDS} секунд или загрузи готовое аудио до 8 МБ.</p><div class="pronunciation-controls"><button class="primary" type="button" data-pron-start>${icon('sound')} Записать</button><button class="secondary" type="button" data-pron-stop disabled>Остановить</button><strong class="pronunciation-timer" role="timer" aria-label="Длительность записи">0:00</strong></div><div class="pronunciation-meter" aria-label="Уровень микрофона" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="pronunciation-meter-fill" style="width:0%"></i></div><label class="pronunciation-upload">Или загрузить свою запись<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.webm,.mp4,.flac" data-pron-upload aria-label="Загрузить свою аудиозапись"></label></section>
    </div>
    <p class="pronunciation-status" role="status" aria-live="polite">Микрофон включится только после нажатия «Записать».</p>
    <section class="pronunciation-recording" hidden aria-label="Прослушивание своей записи"><h3>3. Сравни звучание</h3><audio controls preload="metadata" data-pron-audio aria-label="Твоя аудиозапись"></audio><div class="pronunciation-controls"><button class="primary" type="button" data-pron-compare>${icon('sound')} Образец → моя запись</button><a class="secondary" data-pron-download download="zhekandus-pronunciation.webm">Скачать запись</a><button class="secondary" type="button" data-pron-delete>Удалить запись</button></div><p class="pronunciation-note">Сравни ударение и произношение, затем запиши ещё раз. Запись остаётся в этой тренировке; скачай её, чтобы сохранить.</p></section>
    <div class="pronunciation-bottom"><button class="secondary" type="button" data-pron-exit>К набору ${icon('arrow')}</button></div>
  </section>`;

  const section = container.querySelector('.pronunciation-mode');
  const startButton = container.querySelector('[data-pron-start]');
  const stopButton = container.querySelector('[data-pron-stop]');
  const sampleButton = container.querySelector('[data-pron-sample]');
  const compareButton = container.querySelector('[data-pron-compare]');
  const uploadInput = container.querySelector('[data-pron-upload]');
  const rateInput = container.querySelector('[data-pron-rate]');
  const player = container.querySelector('[data-pron-audio]');
  const download = container.querySelector('[data-pron-download]');
  const recordingPanel = container.querySelector('.pronunciation-recording');
  const status = container.querySelector('.pronunciation-status');
  const timeLabel = container.querySelector('.pronunciation-timer');
  const meter = container.querySelector('.pronunciation-meter');
  const meterFill = container.querySelector('.pronunciation-meter-fill');

  function setMessage(message, error = false) {
    if (destroyed) return;
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }
  function updateState(state) {
    recordingState = state;
    const busy = state !== 'idle';
    section.classList.toggle('is-recording', state === 'recording');
    section.classList.toggle('is-requesting', state === 'requesting');
    startButton.disabled = busy;
    sampleButton.disabled = busy;
    compareButton.disabled = busy;
    uploadInput.disabled = busy;
    stopButton.disabled = !busy || state === 'stopping';
    stopButton.textContent = state === 'requesting' ? 'Отменить' : 'Остановить';
    player.controls = !busy;
  }
  function stopPlayback() {
    playbackEpoch += 1;
    player.pause();
    stopAudio();
    sampleButton.classList.remove('is-speaking');
    compareButton.classList.remove('is-speaking');
  }
  function stopTracks() {
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
  }
  function stopMeters() {
    if (clock !== null) clearInterval(clock);
    if (deadline !== null) clearTimeout(deadline);
    if (meterFrame !== null) cancelAnimationFrame(meterFrame);
    clock = deadline = meterFrame = null;
    try { meterSource?.disconnect(); } catch { /* Optional level display. */ }
    meterSource = null;
    try { meterContext?.close()?.catch?.(() => {}); } catch { /* Optional level display. */ }
    meterContext = null;
    meterFill.style.width = '0%';
    meter.setAttribute('aria-valuenow', '0');
  }
  function startMeter(activeStream) {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      meterContext = new Context();
      meterContext.resume()?.catch?.(() => {});
      meterSource = meterContext.createMediaStreamSource(activeStream);
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 256;
      meterSource.connect(analyser);
      // No destination connection: the microphone never feeds the speakers.
      const samples = new Uint8Array(analyser.fftSize);
      const frame = () => {
        if (destroyed || recordingState !== 'recording') return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        const level = Math.min(100, Math.round(rms * 350));
        meterFill.style.width = `${level}%`;
        meter.setAttribute('aria-valuenow', String(level));
        meterFrame = requestAnimationFrame(frame);
      };
      frame();
    } catch { /* Recording still works when level monitoring is unavailable. */ }
  }
  function replaceRecording(blob, name) {
    if (destroyed) return;
    stopPlayback();
    const nextURL = URL.createObjectURL(blob);
    if (recordingURL) URL.revokeObjectURL(recordingURL);
    recordingURL = nextURL;
    player.src = nextURL;
    player.load();
    download.href = nextURL;
    download.download = name;
    recordingPanel.hidden = false;
  }
  function updateTime() {
    const seconds = Math.min(MAX_SECONDS, Math.floor((performance.now() - startedAt) / 1000));
    timeLabel.textContent = `0:${String(seconds).padStart(2, '0')}`;
  }
  function stopRecording() {
    if (recordingState === 'requesting') {
      requestEpoch += 1;
      updateState('idle');
      setMessage('Запрос отменён. Можно записать снова или загрузить аудиофайл.');
      return;
    }
    if (recordingState !== 'recording') return;
    updateTime();
    updateState('stopping');
    stopMeters();
    try { recorder?.stop(); }
    catch {
      stopTracks();
      updateState('idle');
      setMessage('Не получилось завершить запись. Попробуй записать ещё раз.', true);
    }
    // stop() schedules its final data event; tracks can be released immediately.
    stopTracks();
  }
  async function startRecording() {
    if (destroyed || recordingState !== 'idle') return;
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setMessage('Этот браузер не поддерживает запись микрофона на странице. Открой приложение в Chrome, Edge или Safari либо загрузи аудиофайл.', true);
      return;
    }
    stopPlayback();
    const epoch = ++requestEpoch;
    updateState('requesting');
    setMessage('Разреши доступ к микрофону в окне браузера.');
    let activeStream;
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (destroyed || epoch !== requestEpoch) {
        activeStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = activeStream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type));
      const activeRecorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);
      recorder = activeRecorder;
      const chunks = [];
      let bytes = 0;
      let failed = false;
      activeRecorder.ondataavailable = event => {
        if (destroyed || epoch !== requestEpoch || failed || !event.data?.size) return;
        bytes += event.data.size;
        if (bytes > MAX_BYTES) {
          failed = true;
          setMessage('Запись превысила 8 МБ. Попробуй записать более короткий фрагмент.', true);
          stopRecording();
          return;
        }
        chunks.push(event.data);
      };
      activeRecorder.onerror = () => {
        if (destroyed || epoch !== requestEpoch) return;
        failed = true;
        setMessage('Запись прервалась. Проверь микрофон и попробуй ещё раз.', true);
        stopRecording();
      };
      activeRecorder.onstop = () => {
        if (destroyed || epoch !== requestEpoch) return;
        stopMeters();
        stopTracks();
        recorder = null;
        updateState('idle');
        if (failed) return;
        if (!chunks.length) { setMessage('Запись получилась пустой. Попробуй ещё раз или загрузи аудиофайл.', true); return; }
        const type = activeRecorder.mimeType || chunks[0].type || 'audio/webm';
        const extension = /mp4/i.test(type) ? 'm4a' : /ogg/i.test(type) ? 'ogg' : 'webm';
        try {
          replaceRecording(new Blob(chunks, { type }), `zhekandus-pronunciation.${extension}`);
          setMessage('Запись готова. Послушай образец и свой голос по очереди.');
          sound('correct');
        } catch { setMessage('Не удалось открыть запись. Попробуй ещё раз.', true); }
      };
      activeRecorder.start(250);
      startedAt = performance.now();
      updateState('recording');
      updateTime();
      setMessage('Идёт запись. Произнеси слово или фразу и нажми «Остановить».');
      clock = setInterval(updateTime, 250);
      deadline = setTimeout(stopRecording, MAX_SECONDS * 1000);
      startMeter(activeStream);
    } catch (error) {
      activeStream?.getTracks().forEach(track => track.stop());
      if (destroyed || epoch !== requestEpoch) return;
      stream = null;
      recorder = null;
      stopMeters();
      updateState('idle');
      setMessage(microphoneError(error), true);
    }
  }
  async function sample(compare = false) {
    if (destroyed || recordingState !== 'idle' || (compare && !recordingURL)) return;
    stopPlayback();
    const epoch = playbackEpoch;
    const button = compare ? compareButton : sampleButton;
    setMessage(compare ? 'Сначала образец, затем твоя запись.' : 'Слушай образец, затем повтори слово.');
    let ended = false;
    let sampleFailed = false;
    try {
      const result = await pronounce(term, button, {
        rate: Number(rateInput.value),
        onEnd: () => {
          if (ended || destroyed || epoch !== playbackEpoch) return;
          ended = true;
          // Older speech engines notify end before the associated error. Defer
          // one microtask so a failed sample never starts the comparison audio.
          queueMicrotask(() => {
            if (sampleFailed || destroyed || epoch !== playbackEpoch || !compare || !recordingURL) return;
            player.currentTime = 0;
            player.play().catch(() => setMessage('Не получилось включить запись. Нажми ▶ в аудиоплеере.', true));
          });
        },
        onError: message => {
          sampleFailed = true;
          if (!destroyed && epoch === playbackEpoch) setMessage(message, true);
        },
      });
      if (destroyed || epoch !== playbackEpoch) return;
      if (result?.ok === false) {
        sampleFailed = true;
        setMessage(result.message || 'Не удалось включить образец.', true);
      }
    } catch {
      if (!destroyed && epoch === playbackEpoch) setMessage('Не удалось включить образец. Попробуй кнопку озвучки ещё раз.', true);
    }
  }
  function removeRecording() {
    stopPlayback();
    player.removeAttribute('src');
    player.load();
    download.removeAttribute('href');
    if (recordingURL) URL.revokeObjectURL(recordingURL);
    recordingURL = null;
    recordingPanel.hidden = true;
    setMessage('Запись удалена. Можно сделать новую.');
  }
  function handleClick(event) {
    const button = event.target.closest?.('button');
    if (!button || !container.contains(button) || destroyed || button.disabled) return;
    if (button.hasAttribute('data-pron-start')) startRecording();
    if (button.hasAttribute('data-pron-stop')) stopRecording();
    if (button.hasAttribute('data-pron-sample')) sample();
    if (button.hasAttribute('data-pron-compare')) sample(true);
    if (button.hasAttribute('data-pron-delete')) removeRecording();
    if (button.hasAttribute('data-pron-exit')) onExit();
  }
  function handleUpload() {
    const file = uploadInput.files?.[0];
    uploadInput.value = '';
    if (!file || destroyed || recordingState !== 'idle') return;
    if (!audioFile(file)) { setMessage('Выбери аудиофайл: MP3, WAV, M4A, OGG или WebM.', true); return; }
    if (!file.size) { setMessage('Этот аудиофайл пустой. Выбери другую запись.', true); return; }
    if (file.size > MAX_BYTES) { setMessage('Файл больше 8 МБ. Выбери короткую аудиозапись.', true); return; }
    try {
      replaceRecording(file, file.name || 'zhekandus-pronunciation.audio');
      setMessage('Аудиофайл готов. Сравни его с образцом или запиши голос заново.');
    } catch { setMessage('Не удалось открыть этот аудиофайл. Попробуй WAV или MP3.', true); }
  }
  function playerStarted() {
    if (destroyed || recordingState !== 'idle') { player.pause(); return; }
    playbackEpoch += 1;
    stopAudio();
  }
  function playerError() {
    if (!destroyed && recordingURL) setMessage('Браузер не смог воспроизвести этот формат. Выбери WAV или MP3.', true);
  }
  container.addEventListener('click', handleClick);
  uploadInput.addEventListener('change', handleUpload);
  player.addEventListener('play', playerStarted);
  player.addEventListener('error', playerError);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestEpoch += 1;
      stopPlayback();
      stopMeters();
      try { if (recorder?.state !== 'inactive') recorder?.stop(); } catch { /* Browser may already have closed its recorder. */ }
      recorder = null;
      stopTracks();
      if (recordingURL) URL.revokeObjectURL(recordingURL);
      recordingURL = null;
      container.removeEventListener('click', handleClick);
      uploadInput.removeEventListener('change', handleUpload);
      player.removeEventListener('play', playerStarted);
      player.removeEventListener('error', playerError);
      player.removeAttribute('src');
      player.load();
    },
  };
}
