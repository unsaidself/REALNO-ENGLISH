import { getSpeechVoices } from './media.js';
import { speechDescription, voiceSetupInstruction } from './speech-voices.js';
import { cloudDefaults } from './cloud-speech.js';
import { setTTSKey, getTTSKey, ttsKeyState, clearTTSKeys } from './tts-storage.js';
import { neuralModels, neuralModel, neuralModelInstalled, downloadNeuralModel, removeNeuralModel } from './neural-assets.js';
import { stopNeuralSpeech } from './neural-speech.js';

const demoText = 'Learning a little every day makes a difference.';

export function renderSpeechSettings(prefs, {esc,icon}) {
  const mode=['auto','cloud','neural'].includes(prefs.speechVoice) ? prefs.speechVoice : 'auto';
  const config=prefs.cloudSpeech || {},provider=['openai','google','azure'].includes(config.provider) ? config.provider : 'openai',defaults=cloudDefaults[provider];
  return `<div class="setting-group speech-settings"><h2>${icon('sound')} Озвучка слов</h2>
    <label for="speech-voice">Режим озвучки</label><select id="speech-voice">${[['auto','Голоса браузера — лучший доступный'],['cloud','Живой голос — облачный TTS'],['neural','Piper — нейросетевой голос без интернета']].map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${label}</option>`).join('')}</select>
    <p>Онлайн-голоса браузера могут использовать интернет. Голоса доступны только если браузер показывает их в списке. eSpeak включается последним, если остальные варианты недоступны.</p>
    <label for="speech-accent">Английский акцент</label><select id="speech-accent"><option value="en-US" ${prefs.speechAccent!=='en-GB'?'selected':''}>Американский (US)</option><option value="en-GB" ${prefs.speechAccent==='en-GB'?'selected':''}>Британский (UK)</option></select>
    <label for="speech-rate">Скорость <b id="speech-rate-label">${prefs.speechRate || .9}×</b></label><input type="range" id="speech-rate" min="0.5" max="1.5" step="0.1" value="${prefs.speechRate || .9}">
    <button class="secondary" id="speech-demo">${icon('sound')} Проверить озвучку</button><p id="speech-active-voice" role="status" aria-live="polite">После проверки здесь появятся название, язык и тип реально включённого голоса.</p><div id="speech-fallback-help" hidden></div>
    <details class="speech-voice-details" open><summary>Выбрать конкретный английский голос</summary><label for="system-voice-select">Голос браузера</label><select id="system-voice-select"><option value="auto">Выбирать автоматически</option></select><div id="speech-voice-list"></div></details>
    <section class="speech-provider-fields" id="speech-cloud-fields" ${mode!=='cloud'?'hidden':''}><h3>Живой голос</h3><p>Текст отправляется выбранному провайдеру по твоему API-ключу. Провайдер может брать плату за запросы. Готовое аудио сохраняется локально; повтор того же текста не требует нового запроса.</p>
      <label for="cloud-provider">Провайдер</label><select id="cloud-provider">${[['openai','OpenAI TTS'],['google','Google Cloud TTS'],['azure','Azure Speech']].map(([value,label])=>`<option value="${value}" ${provider===value?'selected':''}>${label}</option>`).join('')}</select>
      <label for="cloud-voice-name">Имя облачного голоса</label><input id="cloud-voice-name" maxlength="100" value="${esc(config.voice || defaults.voice)}" spellcheck="false"><p id="cloud-voice-hint"></p>
      <div id="openai-fields" ${provider!=='openai'?'hidden':''}><label for="cloud-openai-model">Модель OpenAI</label><input id="cloud-openai-model" value="${esc(config.model || 'gpt-4o-mini-tts')}" maxlength="100" spellcheck="false"></div>
      <div id="azure-fields" ${provider!=='azure'?'hidden':''}><label for="cloud-azure-region">Регион Azure</label><input id="cloud-azure-region" value="${esc(config.region || 'westeurope')}" maxlength="35" spellcheck="false"></div>
      <label for="cloud-api-key">API-ключ</label><input type="password" id="cloud-api-key" autocomplete="off" placeholder="Вставь свой ключ" spellcheck="false"><label class="remember-key-label" for="remember-tts-key"><input type="checkbox" id="remember-tts-key"> Запомнить ключ в этом браузере</label><p>Без отметки ключ действует в этой вкладке. Ключи не входят в резервные копии и экспорт.</p><div class="study-actions"><button class="secondary" id="save-tts-key">Сохранить ключ</button><button class="secondary" id="clear-tts-keys">Забыть API-ключи</button></div><p id="cloud-key-status" role="status"></p>
    </section>
    <section class="speech-provider-fields"><h3>Piper без интернета</h3><p>Скачай английскую модель и WASM один раз — около 100 МБ. Они останутся в IndexedDB этого браузера. Текст обрабатывается на устройстве; повторно скачивать модель для каждого слова не нужно.</p><label for="neural-model">Нейросетевой голос</label><select id="neural-model">${neuralModels.map(model=>`<option value="${model.id}" ${model.id===(prefs.neuralModelId || neuralModels[0].id)?'selected':''}>${model.name}</option>`).join('')}</select><div class="study-actions"><button class="secondary" id="download-neural-model">Скачать и использовать</button><button class="secondary" id="test-neural-model" disabled>Проверить Piper</button><button class="secondary" id="remove-neural-model" hidden>Удалить модель</button><button class="secondary" id="cancel-neural-download" hidden>Отменить загрузку</button></div><progress id="neural-download-progress" max="100" value="0" hidden aria-label="Загрузка модели Piper"></progress><p id="neural-model-status" role="status"></p><p><a id="neural-model-license" href="https://huggingface.co/rhasspy/piper-voices" target="_blank" rel="noopener noreferrer">Источник и условия использования модели</a></p>
    </section></div>`;
}

export function showSpeechDiagnostics(container, info, {notice = ''} = {}) {
  const label=container?.querySelector('#speech-active-voice, .speech-identity'),help=container?.querySelector('#speech-fallback-help, .speech-fallback-help');
  if(label)label.textContent=speechDescription(info)+(notice ? ` · ${notice}` : '');
  if(!help)return;
  help.replaceChildren();help.hidden=info.type!=='fallback';
  if(info.type==='fallback') {
    const instruction=voiceSetupInstruction(),anchor=document.createElement('a');anchor.textContent='Установи нормальный голос';anchor.href=instruction.url;anchor.target='_blank';anchor.rel='noopener noreferrer';
    const text=document.createElement('p');text.textContent=instruction.text;help.append(anchor,text);
  }
}

export function mountSpeechSettings(root, {getSettings,save,pronounce,esc,notify}) {
  let destroyed=false,downloadController=null,voiceRefresh=0,keyRefresh=0;
  const node=id=>root.querySelector('#'+id);
  const settings=()=>getSettings();
  function updateCloudFields() {
    const provider=settings().cloudSpeech?.provider || 'openai';
    node('openai-fields').hidden=provider!=='openai';node('azure-fields').hidden=provider!=='azure';
    node('cloud-voice-hint').textContent={openai:'Например coral, alloy, nova. Для gpt-4o-mini-tts акцент задаётся отдельно.',google:'Например en-US-Neural2-F или en-GB-Neural2-A. Язык берётся из имени голоса.',azure:'Например en-US-JennyNeural или en-GB-SoniaNeural. Регион должен совпадать с твоим ресурсом Azure.'}[provider];
  }
  async function updateKeyStatus() {
    const sequence=++keyRefresh,provider=settings().cloudSpeech?.provider || 'openai';
    try {const status=await ttsKeyState(provider);if(destroyed || sequence!==keyRefresh)return;node('cloud-key-status').textContent=status.available ? `Ключ ${provider} готов · ${status.remembered?'сохранён в браузере':'только эта вкладка'}` : 'Ключ не добавлен. Сохранённое аудио можно слушать без ключа.';node('remember-tts-key').checked=status.remembered;}
    catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}
  }
  function refreshVoices() {
    if(destroyed)return;
    const voices=getSpeechVoices(settings().speechAccent || 'en-US'),selected=settings().systemVoice || 'auto';
    const options=voices.map(voice=>`<option value="${esc(voice.id)}" ${voice.id===selected?'selected':''}>${esc(voice.name)} · ${voice.lang} · ${voice.localService?'локальный':'онлайн'}</option>`).join('');
    node('system-voice-select').innerHTML=`<option value="auto" ${selected==='auto'?'selected':''}>Выбирать автоматически</option>${options}${selected!=='auto'&&!voices.some(v=>v.id===selected)?`<option value="${esc(selected)}" selected>Сохранённый голос сейчас недоступен</option>`:''}`;
    node('speech-voice-list').innerHTML=voices.length ? voices.map((voice,index)=>`<div class="speech-voice-row"><div><b>${esc(voice.name)}</b><small>${voice.lang} · ${voice.localService?'локальный':'онлайн'}</small></div><button class="secondary" type="button" data-voice-test="${index}" aria-label="Проверить голос ${esc(voice.name)}">Проверить</button></div>`).join('') : '<p>Браузер пока не показал английские голоса. Список обновится автоматически; Piper и запасная озвучка доступны отдельно.</p>';
    node('speech-voice-list').querySelectorAll('[data-voice-test]').forEach(button=>button.onclick=()=>pronounce(demoText,button,{voice:'auto',systemVoice:voices[Number(button.dataset.voiceTest)].id,lang:voices[Number(button.dataset.voiceTest)].lang}));
  }
  async function refreshNeuralStatus() {
    if(destroyed)return;
    const sequence=++voiceRefresh,id=settings().neuralModelId || neuralModels[0].id;
    const model=neuralModel(id);
    node('neural-model-license').href='https://huggingface.co/rhasspy/piper-voices/blob/main/'+model.path.split('/').slice(0,-1).join('/')+'/MODEL_CARD';
    try{const ready=await neuralModelInstalled(id);if(destroyed || sequence!==voiceRefresh || downloadController)return;node('neural-model-status').textContent=ready ? `${neuralModel(id).name}: модель сохранена, можно работать без сети.` : 'Модель ещё не скачана. Пока можно использовать голоса браузера.';node('test-neural-model').disabled=!ready;node('remove-neural-model').hidden=!ready;node('download-neural-model').textContent=ready?'Модель скачана':'Скачать и использовать';}
    catch(error){if(!destroyed)node('neural-model-status').textContent=error.message;}
  }
  node('speech-voice').onchange=event=>{settings().speechVoice=event.target.value;node('speech-cloud-fields').hidden=event.target.value!=='cloud';save();};
  node('system-voice-select').onchange=event=>{settings().systemVoice=event.target.value;settings().speechVoice='auto';node('speech-voice').value='auto';node('speech-cloud-fields').hidden=true;save();};
  node('speech-accent').onchange=event=>{settings().speechAccent=event.target.value;settings().systemVoice='auto';save();refreshVoices();};
  node('speech-rate').oninput=event=>{settings().speechRate=Number(event.target.value);node('speech-rate-label').textContent=`${event.target.value}×`;save();};
  node('speech-demo').onclick=event=>pronounce(demoText,event.currentTarget);
  node('cloud-provider').onchange=()=>{const provider=node('cloud-provider').value;settings().cloudSpeech={provider,...cloudDefaults[provider]};node('cloud-voice-name').value=cloudDefaults[provider].voice;node('cloud-api-key').value='';node('cloud-openai-model').value=cloudDefaults[provider].model || 'gpt-4o-mini-tts';node('cloud-azure-region').value=cloudDefaults[provider].region || 'westeurope';save();updateCloudFields();void updateKeyStatus();};
  for(const [id,key] of [['cloud-voice-name','voice'],['cloud-openai-model','model'],['cloud-azure-region','region']])node(id).oninput=event=>{settings().cloudSpeech={provider:node('cloud-provider').value,...settings().cloudSpeech,[key]:event.target.value.trim()};save();};
  node('save-tts-key').onclick=async()=>{const provider=node('cloud-provider').value,key=node('cloud-api-key').value;if(!key.trim()){node('cloud-key-status').textContent='Вставь API-ключ перед сохранением.';return;}try{await setTTSKey(provider,key,node('remember-tts-key').checked);if(destroyed)return;node('cloud-api-key').value='';await updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('remember-tts-key').onchange=async event=>{const provider=node('cloud-provider').value,remember=event.target.checked;try{const key=await getTTSKey(provider);if(!key)return;await setTTSKey(provider,key,remember);if(!destroyed)void updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('clear-tts-keys').onclick=async()=>{try{await clearTTSKeys();if(destroyed)return;node('cloud-api-key').value='';await updateKeyStatus();}catch(error){if(!destroyed)node('cloud-key-status').textContent=error.message;}};
  node('neural-model').onchange=event=>{settings().neuralModelId=event.target.value;save();void refreshNeuralStatus();};
  node('test-neural-model').onclick=event=>pronounce(demoText,event.currentTarget,{voice:'neural',neuralId:settings().neuralModelId});
  node('download-neural-model').onclick=async()=>{
    if(downloadController)return;
    const id=node('neural-model').value,controller=downloadController=new AbortController();
    node('download-neural-model').disabled=true;node('neural-model').disabled=true;node('remove-neural-model').disabled=true;node('cancel-neural-download').hidden=false;node('neural-download-progress').hidden=false;
    node('neural-model-status').textContent='Начинаю загрузку модели и WASM…';
    try{await downloadNeuralModel(id,{signal:controller.signal,onProgress:progress=>{if(destroyed)return;node('neural-download-progress').value=Math.min(100,(progress.index-1+(progress.total?progress.loaded/progress.total:0))/progress.count*100);node('neural-model-status').textContent=`Загрузка ${progress.index}/${progress.count} · ${(progress.loaded/1048576).toFixed(1)} МБ${progress.total?` / ${(progress.total/1048576).toFixed(1)} МБ`:''}`;}});settings().neuralModelId=id;settings().speechVoice='neural';save();if(!destroyed){node('speech-voice').value='neural';node('speech-cloud-fields').hidden=true;}notify('Piper скачан. Нейросетевой голос готов без интернета.');}
    catch(error){if(!destroyed)node('neural-model-status').textContent=error.name==='AbortError'?'Загрузка отменена. Уже скачанные файлы сохранены; можно продолжить позже.':`Не получилось скачать Piper. ${error.message}`;}
    finally{downloadController=null;if(!destroyed){node('download-neural-model').disabled=false;node('neural-model').disabled=false;node('remove-neural-model').disabled=false;node('cancel-neural-download').hidden=true;node('neural-download-progress').hidden=true;}}
    if(await neuralModelInstalled(id).catch(()=>false))void refreshNeuralStatus();
  };
  node('cancel-neural-download').onclick=()=>downloadController?.abort();
  node('remove-neural-model').onclick=async()=>{try{stopNeuralSpeech();await removeNeuralModel(node('neural-model').value);void refreshNeuralStatus();}catch(error){if(!destroyed)node('neural-model-status').textContent=error.message;}};
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged',refreshVoices);
  refreshVoices();updateCloudFields();void updateKeyStatus();void refreshNeuralStatus();
  return {destroy(){destroyed=true;globalThis.speechSynthesis?.removeEventListener?.('voiceschanged',refreshVoices);downloadController?.abort();}};
}
