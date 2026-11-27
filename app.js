(() => {
  'use strict';

  const API_ORIGIN = 'https://fishaudio.org';
  const FISH_MODELS = ['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3', 's3-pro'];
  const FISH_ASR_MODELS = ['transcribe-1', 'transcribe-1-pro', 'transcribe-2-pro'];
  const API_V3 = '/api/open/v3';
  const API_V1 = '/api/open/v1';
  const TEST_VOICE_ID = '00a1b221-6137-4b73-ad62-b0cbce134167';
  const state = {
    provider: 'kitta',
    proxyUrl: '',
    proxyToken: '',
    connectionVerified: false,
    profile: null,
    capabilities: null,
    voices: [],
    voicesPage: 1,
    voicesTotalPages: 1,
    voiceType: 'all',
    ttsMode: 'sync',
    currentAudioUrl: '',
    openApi: null,
    jobs: [],
    lipSyncJobs: [],
    fishApiCredit: null,
    fishVoiceCandidates: []
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'kitta-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const pretty = (value) => JSON.stringify(value, null, 2);

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast' + (type ? ' ' + type : '');
    node.textContent = message;
    $('toast-region').append(node);
    window.setTimeout(() => node.remove(), 4800);
  }

  function log(id, message, type) {
    const node = $(id);
    if (!node) return;
    node.className = 'result-log' + (type ? ' ' + type : '');
    node.textContent = message || '';
  }

  function setConnected(connected, label) {
    $('sidebar-status-dot').classList.toggle('connected', connected);
    $('sidebar-status').textContent = connected ? 'Подключено' : 'Не подключено';
    $('sidebar-account').textContent = connected ? (label || (state.provider === 'fish' ? 'Fish Audio через Worker' : 'Защищённый proxy активен')) : (state.provider === 'fish' ? 'Fish Audio не подключён' : 'Proxy не подключён');
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.textContent = busyText || 'Выполняется…';
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function assertConnected() {
    if (!state.proxyUrl || !state.proxyToken || !state.connectionVerified) {
      if (!$('settings-dialog').open) $('settings-dialog').showModal();
      throw new Error('Сначала подключите и проверьте серверный Worker proxy. Прямые обращения к fishaudio.org с GitHub Pages отключены из-за CORS.');
    }
  }

  function normalizePath(path) {
    if (typeof path !== 'string' || path.startsWith('//') || /[\r\n\\]/.test(path)) {
      throw new Error('Недопустимый путь API.');
    }
    if (state.provider === 'fish') {
      const candidate = new URL(path, 'https://api.fish.audio');
      if (candidate.origin !== 'https://api.fish.audio') throw new Error('Запрос за пределы Fish Audio API запрещён.');
      const fishAllowed = candidate.pathname === '/fish/model' ||
        /^\/fish\/model\/[A-Za-z0-9_-]+$/.test(candidate.pathname) ||
        ['/fish/wallet/self/package', '/fish/wallet/self/api-credit',
          '/fish/v1/tts', '/fish/v1/tts/stream/with-timestamp',
          '/fish/v1/asr', '/fish/v1/audio/infill', '/fish/v1/voice-design'].includes(candidate.pathname);
      if (!fishAllowed) throw new Error('Этот путь не входит в разрешённый список Fish Audio API.');
      return candidate;
    }
    if (!(path === '/api/openapi.json' || path === API_ORIGIN + '/api/openapi.json' ||
          path.startsWith('/api/open/') || path.startsWith(API_ORIGIN + '/api/open/'))) {
      throw new Error('Разрешены только пути и HTTPS URL официального API Kitta Audio.');
    }
    const candidate = path.startsWith('https://') ? new URL(path) : new URL(path, API_ORIGIN);
    if (candidate.origin !== API_ORIGIN ||
        !(candidate.pathname === '/api/openapi.json' || candidate.pathname.startsWith('/api/open/'))) {
      throw new Error('Запрос за пределы API Kitta Audio запрещён.');
    }
    return candidate;
  }

  async function apiRequest(path, options) {
    const settings = options || {};
    const url = normalizePath(path);
    const headers = new Headers(settings.headers || {});
    if (settings.allowUnverified) {
      if (!state.proxyUrl || !state.proxyToken) throw new Error('Сначала укажите URL и пароль Worker proxy.');
    } else {
      assertConnected();
    }
    // Browser credentials authenticate only to the user's Worker; upstream API secrets stay server-side.
    headers.set('Authorization', 'Bearer ' + state.proxyToken);
    if (settings.fishModel) headers.set('X-Fish-Model', settings.fishModel);
    if (settings.idempotencyKey) headers.set('Idempotency-Key', settings.idempotencyKey);
    if (settings.requestId) headers.set('X-Request-Id', settings.requestId);
    if (settings.body !== undefined && !(settings.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), settings.timeout || 90000);
    let response;
    const requestUrl = new URL(url.pathname + url.search, state.proxyUrl).toString();
    try {
      response = await fetch(requestUrl, {
        method: settings.method || 'GET',
        headers,
        body: settings.body === undefined ? undefined : (settings.body instanceof FormData ? settings.body : typeof settings.body === 'string' ? settings.body : JSON.stringify(settings.body)),
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Истекло время ожидания API. Для длительной генерации проверьте результат перед повторным запросом.');
      if (error instanceof TypeError) throw new Error('Не удалось связаться с Worker proxy. Проверьте URL Worker, пароль PROXY_ACCESS_TOKEN и CORS preflight.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) {
      let detail = '';
      if (contentType.includes('json')) {
        try {
          const data = await response.json();
          detail = (data.message || data.detail || data.error || data.code || pretty(data)).toString();
          if (data.reason) detail += ' · ' + data.reason;
          if (data.requestId) detail += ' · requestId: ' + data.requestId;
        } catch (_) {
          detail = response.statusText;
        }
      } else {
        try { detail = (await response.text()).slice(0, 900); } catch (_) { detail = response.statusText; }
      }
      const error = new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      error.requestId = requestId;
      throw error;
    }

    if (contentType.includes('application/json') || contentType.includes('+json')) {
      return { kind: 'json', data: await response.json(), response };
    }
    if (contentType.startsWith('text/')) {
      return { kind: 'text', data: await response.text(), response };
    }
    return { kind: 'blob', data: await response.blob(), response };
  }

  function getTask(data) {
    return data && (data.task || data.data && (data.data.task || data.data) || data.job || data);
  }

  function setProgress(visible, title, detail) {
    $('job-progress').classList.toggle('hidden', !visible);
    $('result-empty').classList.toggle('hidden', visible || !$('result-content').classList.contains('hidden'));
    $('job-state').textContent = title || 'Задача выполняется';
    $('job-detail').textContent = detail || '';
  }

  function clearAudio() {
    $('result-content').classList.add('hidden');
    $('result-empty').classList.remove('hidden');
    if (state.currentAudioUrl) {
      URL.revokeObjectURL(state.currentAudioUrl);
      state.currentAudioUrl = '';
    }
    $('audio-player').removeAttribute('src');
    $('audio-player').load();
    $('download-audio').removeAttribute('href');
  }

  function showAudio(blob, filename, description) {
    if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
    const mime = blob.type || 'audio/mpeg';
    state.currentAudioUrl = URL.createObjectURL(blob);
    $('audio-player').src = state.currentAudioUrl;
    $('download-audio').href = state.currentAudioUrl;
    $('download-audio').download = filename;
    $('audio-filename').textContent = filename;
    $('audio-meta').textContent = description || 'Готово к воспроизведению';
    $('result-content').classList.remove('hidden');
    $('result-empty').classList.add('hidden');
    $('job-progress').classList.add('hidden');
    log('studio-log', 'Аудиофайл готов (' + (blob.size / 1024).toFixed(1) + ' КБ, ' + mime + ').', 'success');
  }

  function downloadBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1500);
  }

  async function fetchAudioFromPath(path, filename, description) {
    const result = await apiRequest(path, {timeout: 120000});
    if (result.kind === 'blob') {
      showAudio(result.data, filename, description);
      return result.data;
    }
    if (result.kind === 'json') {
      const url = result.data && (result.data.audioUrl || result.data.audio_url || result.data.url || result.data.delivery && (result.data.delivery.downloadUrl || result.data.delivery.playbackUrl));
      if (url) return await fetchAudioFromPath(url, filename, description);
      throw new Error('API вернул JSON, но не предоставил ссылку на аудио: ' + pretty(result.data).slice(0, 500));
    }
    throw new Error('Вместо аудиофайла API вернул текстовый ответ.');
  }

  function buildFishTtsPayload() {
    const text = $('tts-text').value.trim();
    if (!text) throw new Error('Введите текст для озвучивания.');
    const model = $('tts-model').value;
    if (!FISH_MODELS.includes(model)) throw new Error('Выберите поддерживаемую модель Fish Audio.');
    const payload = {
      text,
      format: $('tts-format').value,
      normalize: $('tts-normalization').checked,
      temperature: Number($('fish-temperature').value),
      top_p: Number($('fish-top-p').value),
      prosody: {
        speed: Number($('tts-speed').value),
        volume: Number($('tts-volume').value),
        normalize_loudness: true
      }
    };
    const referenceId = $('tts-fish-reference').value.trim();
    if (referenceId) {
      if (referenceId.startsWith('[')) {
        let ids;
        try { ids = JSON.parse(referenceId); } catch (error) { throw new Error('Reference ID в формате массива содержит некорректный JSON: ' + error.message); }
        if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id.trim())) {
          throw new Error('Для нескольких голосов укажите JSON-массив непустых Reference ID.');
        }
        if (!['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3'].includes(model)) {
          throw new Error('Многоголосый синтез поддерживается только моделями S2 и Drama 3.');
        }
        if (!/<\\|speaker:\\d+\\|>/.test(text)) {
          throw new Error('Для нескольких голосов добавьте в текст теги <|speaker:0|>, <|speaker:1|> и так далее.');
        }
        payload.reference_id = ids.map((id) => id.trim());
      } else {
        payload.reference_id = referenceId;
      }
    }
    const language = $('tts-language').value.trim();
    if (language && language.toLowerCase() !== 'auto') payload.language = language;
    const extraText = $('fish-tts-advanced').value.trim();
    if (extraText) {
      let extra;
      try { extra = JSON.parse(extraText); } catch (error) { throw new Error('Дополнительные параметры TTS: некорректный JSON: ' + error.message); }
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Дополнительные параметры TTS должны быть JSON-объектом.');
      const allowed = new Set(['chunk_length', 'min_chunk_length', 'sample_rate', 'mp3_bitrate', 'opus_bitrate', 'latency', 'max_new_tokens', 'repetition_penalty', 'condition_on_previous_chunks', 'early_stop_threshold', 'features', 'pronunciation_dictionary']);
      const unknown = Object.keys(extra).filter((key) => !allowed.has(key));
      if (unknown.length) throw new Error('Неизвестные или уже управляемые параметры: ' + unknown.join(', '));
      if (extra.pronunciation_dictionary !== undefined && (!Array.isArray(extra.pronunciation_dictionary) || extra.pronunciation_dictionary.length > 3)) {
        throw new Error('pronunciation_dictionary должен быть массивом максимум из 3 словарей.');
      }
      Object.assign(payload, extra);
    }
    return { model, body: payload };
  }

  function buildTtsPayload() {
    if (state.provider === 'fish') return buildFishTtsPayload();
    const text = $('tts-text').value.trim();
    if (!text) throw new Error('Введите текст для озвучивания.');
    const modelId = $('tts-model').value;
    const voiceId = $('tts-voice').value.trim();
    if (!voiceId) throw new Error('Выберите или укажите Voice ID.');
    const model = state.capabilities && Array.isArray(state.capabilities.models) ? state.capabilities.models.find((item) => item.id === modelId) : null;
    if (model && model.maxTextLength && text.length > model.maxTextLength) {
      throw new Error('Для этой модели допустимо не более ' + model.maxTextLength + ' символов.');
    }
    const selectedVoice = state.voices.find((voice) => (voice.voiceId || voice.id) === voiceId);
    if (selectedVoice && Array.isArray(selectedVoice.modelIds) && selectedVoice.modelIds.length && !selectedVoice.modelIds.includes(modelId)) {
      throw new Error('Выбранный голос не поддерживает модель ' + modelId + '.');
    }
    const payload = {
      text,
      voiceId,
      format: $('tts-format').value,
      textNormalization: $('tts-normalization').checked
    };
    if (modelId) payload.modelId = modelId;
    const controls = model && model.controls ? model.controls : {speed:true,volume:true,stability:true,similarity:true};
    if (controls.speed === true) payload.speed = Number($('tts-speed').value);
    if (controls.volume === true) payload.volume = Number($('tts-volume').value);
    if (controls.stability === true) payload.stability = Number($('tts-stability').value);
    if (controls.similarity === true) payload.similarity = Number($('tts-similarity').value);
    if (controls.pitch === true) payload.pitch = Number($('tts-pitch').value);
    const language = $('tts-language').value.trim();
    if (language && language.toLowerCase() !== 'auto') payload.language = language;
    const emotion = $('tts-emotion').value.trim();
    if (emotion) payload.emotion = emotion;
    const instruction = $('tts-instruction').value.trim();
    if (instruction) payload.instruction = instruction;
    if ($('tts-filter-emoji').checked) payload.filterEmoji = true;
    if (model && Array.isArray(model.outputFormats) && !model.outputFormats.includes(payload.format)) {
      throw new Error('Модель не поддерживает формат ' + payload.format + '.');
    }
    return payload;
  }

async function generateFishTtsWithTimestamps(config) {
    clearAudio();
    setProgress(true, 'Генерируем аудио с временными метками', 'Fish Audio SSE · POST /v1/tts/stream/with-timestamp');
    log('studio-log', 'Поток аудио и выравнивание текста получены. Обрабатываем результат…');
    const response = await apiRequest('/fish/v1/tts/stream/with-timestamp', {
      method: 'POST', body: config.body, fishModel: config.model, timeout: 240000, requestId: uuid()
    });
    if (response.kind !== 'text') throw new Error('Fish Audio вернул неожиданный формат потока с временными метками.');
    const chunks = [];
    const alignments = [];
    const events = response.data.split(/\r?\n/);
    let dataLines = [];
    const consumeEvent = () => {
      if (!dataLines.length) return;
      const raw = dataLines.join('\n');
      dataLines = [];
      let item;
      try { item = JSON.parse(raw); } catch (_) { return; }
      if (item.audio_base64) {
        const binary = atob(item.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        chunks.push(bytes);
      }
      if (item.alignment) alignments.push(item.alignment);
    };
    for (const line of events) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      else if (!line.trim()) consumeEvent();
    }
    consumeEvent();
    if (!chunks.length) throw new Error('Поток Fish Audio не содержал аудиоданных: ' + response.data.slice(0, 500));
    const blob = new Blob(chunks, {type: config.body.format === 'opus' ? 'audio/ogg' : config.body.format === 'wav' ? 'audio/wav' : 'audio/mpeg'});
    showAudio(blob, 'fish-audio-timestamps.' + config.body.format, 'Fish Audio · ' + config.model + ' · timestamps');
    log('studio-log', 'Синтез с временными метками завершён. Блоков выравнивания: ' + alignments.length + '. ' + (alignments.length ? pretty(alignments).slice(0, 1200) : ''), 'success');
  }

  async function generateFishTts(config) {
    if ($('fish-tts-timestamps') && $('fish-tts-timestamps').checked) {
      return generateFishTtsWithTimestamps(config);
    }
    clearAudio();
    setProgress(true, 'Генерируем аудио через Fish Audio', 'Native REST API · POST /v1/tts · потоковый ответ с аудиоданными.');
    log('studio-log', 'Запрос отправлен в Fish Audio. Дождитесь завершения генерации.');
    const response = await apiRequest('/fish/v1/tts', {
      method: 'POST',
      body: config.body,
      fishModel: config.model,
      timeout: 180000,
      requestId: uuid()
    });
    if (response.kind !== 'blob') throw new Error('Fish Audio вернул неожиданный ответ вместо аудиофайла.');
    showAudio(response.data, 'fish-audio.' + config.body.format, 'Fish Audio · ' + config.model);
  }

  async function fishTranscribe() {
    assertConnected();
    const file = $('fish-asr-file').files && $('fish-asr-file').files[0];
    if (!file) throw new Error('Выберите аудиофайл для распознавания.');
    const form = new FormData();
    form.append('audio', file, file.name);
    const language = $('fish-asr-language').value.trim();
    if (language) form.append('language', language);
    form.append('ignore_timestamps', String($('fish-asr-ignore-timestamps').checked));
    const model = $('fish-asr-model').value;
    const result = await apiRequest('/fish/v1/asr', {
      method: 'POST', body: form, fishModel: model, timeout: 240000
    });
    $('fish-asr-result').classList.remove('hidden');
    $('fish-asr-text').textContent = pretty(result.data);
    log('fish-asr-log', 'Распознавание завершено · ' + model, 'success');
  }

  async function fishVoiceDesign() {
    assertConnected();
    const instruction = $('fish-design-instruction').value.trim();
    if (!instruction) throw new Error('Введите описание желаемого голоса.');
    const payload = {
      instruction,
      n: Number($('fish-design-count').value),
      language: $('fish-design-language').value.trim() || undefined,
      reference_text: $('fish-design-reference').value.trim() || undefined,
      speed: Number($('fish-design-speed').value),
      num_step: Number($('fish-design-steps').value),
      guidance_scale: Number($('fish-design-guidance').value),
      instruct_guidance_scale: Number($('fish-design-instruct-guidance').value)
    };
    const seedText = $('fish-design-seed').value.trim();
    if (seedText) {
      const seed = Number(seedText);
      if (!Number.isInteger(seed)) throw new Error('Seed должен быть целым числом.');
      payload.seed = seed;
    }
    const result = await apiRequest('/fish/v1/voice-design', {
      method: 'POST', body: payload, fishModel: 'voice-design-1', timeout: 240000
    });
    const candidates = result.data && result.data.candidates || [];
    state.fishVoiceCandidates = candidates;
    const root = $('fish-design-results');
    root.replaceChildren();
    candidates.forEach((candidate, index) => {
      const card = document.createElement('article');
      card.className = 'output-box';
      const title = document.createElement('strong');
      title.textContent = 'Вариант ' + (index + 1) + ' · ' + (candidate.duration_ms || 0) + ' мс';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = 'data:audio/wav;base64,' + candidate.audio_base64;
      const meta = document.createElement('p');
      meta.className = 'voice-description';
      meta.textContent = 'Candidate ID: ' + (candidate.id || '—') + ' · ' + (candidate.sample_rate || '—') + ' Hz';
      card.append(title, audio, meta);
      root.append(card);
    });
    log('fish-design-log', candidates.length ? 'Создано вариантов: ' + candidates.length + '. Это предварительные образцы, а не сохранённые голосовые модели.' : 'API не вернул кандидатов: ' + pretty(result.data), candidates.length ? 'success' : 'error');
  }

  function updateFishInfillFields() {
    if (!$('fish-infill-mode')) return;
    const joining = $('fish-infill-mode').value === 'join';
    $('fish-infill-edit-fields').hidden = joining;
    $('fish-infill-edit-fields').classList.toggle('hidden', joining);
    $('fish-infill-join-fields').hidden = !joining;
    $('fish-infill-join-fields').classList.toggle('hidden', !joining);
  }

  async function fishAudioInfill() {
    assertConnected();
    const transcript = $('fish-infill-transcript').value.trim();
    if (!transcript) throw new Error('Введите полный итоговый текст записи.');
    const form = new FormData();
    form.append('transcript', transcript);
    if ($('fish-infill-mode').value === 'join') {
      const prefixAudio = $('fish-infill-prefix-audio').files && $('fish-infill-prefix-audio').files[0];
      const suffixAudio = $('fish-infill-suffix-audio').files && $('fish-infill-suffix-audio').files[0];
      if (!prefixAudio) throw new Error('Для склейки укажите начальный аудиоклип.');
      form.append('prefix_audio', prefixAudio, prefixAudio.name);
      if (suffixAudio) form.append('suffix_audio', suffixAudio, suffixAudio.name);
    } else {
      const file = $('fish-infill-file').files && $('fish-infill-file').files[0];
      const prefix = $('fish-infill-prefix').value.trim();
      const suffix = $('fish-infill-suffix').value.trim();
      if (!file) throw new Error('Выберите запись, которую нужно отредактировать.');
      if (!prefix || !suffix || !Number.isFinite(Number(prefix)) || !Number.isFinite(Number(suffix)) || Number(prefix) < 0 || Number(suffix) <= Number(prefix)) {
        throw new Error('Укажите границы фрагмента в секундах: конец должен быть больше начала.');
      }
      form.append('audio', file, file.name);
      form.append('prefix_seconds', prefix);
      form.append('suffix_seconds', suffix);
    }
    form.append('format', $('fish-infill-format').value);
    const result = await apiRequest('/fish/v1/audio/infill', {
      method: 'POST', body: form, fishModel: 'drama-3', timeout: 300000
    });
    if (result.kind !== 'blob') throw new Error('Fish Audio вернул неожиданный ответ для Audio Infill.');
    showAudio(result.data, 'fish-audio-edited.' + $('fish-infill-format').value, 'Fish Audio Audio Infill · Drama 3');
    log('fish-infill-log', 'Редактирование записи завершено.', 'success');
  }

  async function generateSync(payload) {
    clearAudio();
    setProgress(true, 'Генерируем аудио', 'Синхронный запрос HTTP TTS v3. Не отправляйте его повторно из-за обычной задержки.');
    log('studio-log', 'Запрос отправлен. Подождите завершения генерации.');
    const response = await apiRequest(API_V3 + '/speech/tts', {
      method: 'POST',
      body: payload,
      timeout: 180000,
      idempotencyKey: uuid(),
      requestId: uuid()
    });
    if (response.kind === 'blob') {
      const ext = payload.format || 'mp3';
      showAudio(response.data, 'kitta-speech.' + ext, 'Синхронная генерация · ' + payload.modelId);
    } else if (response.kind === 'json') {
      const task = getTask(response.data);
      const audioPath = task && (task.audioUrl || task.audio_url || task.delivery && (task.delivery.downloadUrl || task.delivery.playbackUrl));
      if (audioPath) await fetchAudioFromPath(audioPath, 'kitta-speech.' + (payload.format || 'mp3'), 'Результат HTTP TTS v3');
      else {
        $('job-progress').classList.add('hidden');
        $('result-empty').classList.remove('hidden');
        log('studio-log', 'API вернул метаданные без audioUrl. Ответ: ' + pretty(response.data).slice(0, 700), 'success');
      }
    } else {
      throw new Error('Неожиданный текстовый ответ на запрос генерации.');
    }
  }

  async function generateAsync(payload) {
    clearAudio();
    setProgress(true, 'Создаём фоновую задачу', 'Сохраняем идентификатор задачи и затем опрашиваем её статус.');
    const idempotencyKey = uuid();
    const response = await apiRequest(API_V3 + '/speech/tts/jobs', {
      method: 'POST',
      body: payload,
      timeout: 90000,
      idempotencyKey,
      requestId: uuid()
    });
    const task = getTask(response.data);
    const taskId = task && (task.id || task.taskId || task.task_id) || response.data && response.data.taskId;
    if (!taskId) throw new Error('API не вернул идентификатор задачи: ' + pretty(response.data).slice(0, 600));
    $('recover-task-id').value = taskId;
    await pollTtsTask(taskId, payload.format);
  }

  async function pollTtsTask(taskId, format) {
    const safeId = encodeURIComponent(taskId);
    let wait = 3500;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (attempt > 0) await sleep(wait);
      setProgress(true, 'Задача ' + taskId, 'Проверка статуса · попытка ' + (attempt + 1));
      const response = await apiRequest(API_V3 + '/speech/tts/jobs/' + safeId, {timeout: 45000});
      const task = getTask(response.data);
      const status = String(task.status || task.state || '').toLowerCase();
      if (status === 'success' || status === 'partial_fail' || status === 'completed') {
        const path = task.delivery && (task.delivery.downloadUrl || task.delivery.playbackUrl) || task.audioUrl || task.audio_url;
        if (!path) {
          $('job-progress').classList.add('hidden');
          log('studio-log', 'Задача завершилась, но API не вернул ссылку на аудио. ID сохранён: ' + taskId, 'error');
          return;
        }
        await fetchAudioFromPath(path, 'kitta-' + taskId + '.' + (format || 'mp3'), 'Асинхронная задача · ' + status);
        if (status === 'partial_fail') log('studio-log', 'Готов частичный результат. Некоторые сегменты могли завершиться ошибкой.', 'error');
        return;
      }
      if (status === 'fail' || status === 'failed' || status === 'error') {
        $('job-progress').classList.add('hidden');
        $('result-empty').classList.remove('hidden');
        throw new Error('Задача завершилась с ошибкой: ' + (task.message || task.error || status) + ' · ID: ' + taskId);
      }
      wait = Math.min(Math.round(wait * 1.25), 10000);
    }
    $('job-progress').classList.add('hidden');
    log('studio-log', 'Ожидание остановлено по тайм-ауту интерфейса. Задача продолжает жить на сервере. Сохраните ID и проверьте его позже: ' + taskId, 'error');
  }

  async function loadCapabilities() {
    try {
      const result = await apiRequest(API_V3 + '/speech/tts/capabilities', {auth: false, timeout: 30000});
      state.capabilities = result.data;
      const models = Array.isArray(result.data.models) ? result.data.models.filter((item) => item.available !== false) : [];
      if (models.length) {
        const select = $('tts-model');
        const previous = select.value;
        select.replaceChildren();
        models.forEach((model) => {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name ? model.name + ' · ' + model.id : model.id;
          select.append(option);
        });
        select.value = models.some((item) => item.id === previous) ? previous : models[0].id;
        $('model-hint').textContent = models.length + ' доступных моделей · лимит текста зависит от модели';
        updateModelControls();
      } else {
        $('model-hint').textContent = 'API не вернул список доступных моделей. Проверьте OpenAPI.';
      }
    } catch (error) {
      $('model-hint').textContent = 'Не удалось получить capabilities: ' + error.message;
      log('studio-log', 'Не удалось загрузить список моделей. Можно проверить API вручную в Explorer.', 'error');
    }
  }

  function updateModelControls() {
    const modelId = $('tts-model').value;
    const model = state.capabilities && Array.isArray(state.capabilities.models) ? state.capabilities.models.find((item) => item.id === modelId) : null;
    const controls = model && model.controls ? model.controls : {};
    ['speed', 'volume', 'stability', 'similarity', 'pitch'].forEach((name) => {
      const enabled = model ? controls[name] === true : name !== 'pitch';
      const item = document.querySelector('[data-control="' + name + '"]');
      if (item) item.classList.toggle('hidden', !enabled);
    });
    if (model && model.outputFormats) {
      Array.from($('tts-format').options).forEach((option) => { option.disabled = !model.outputFormats.includes(option.value); });
      if (!model.outputFormats.includes($('tts-format').value)) $('tts-format').value = model.outputFormats[0] || 'mp3';
    }
    $('model-hint').textContent = model ? 'Лимит: ' + (model.maxTextLength || 'по контракту') + ' символов' : 'Список моделей не загружен';
  }

  function getVoiceItems(data) {
    if (Array.isArray(data)) return data;
    return data && (data.items || data.voices || data.data && (data.data.items || data.data.voices)) || [];
  }

  function fishVoiceId(voice) {
    return voice && (voice._id || voice.id || voice.voice_id) || '';
  }

  async function loadFishVoices(page) {
    assertConnected();
    state.voicesPage = page || 1;
    const params = new URLSearchParams({page_size: '50', page_number: String(state.voicesPage), self: 'true', sort_by: 'created_at'});
    const search = $('voice-search').value.trim();
    if (search) params.set('title', search);
    if (['private', 'unlist'].includes($('voice-type').value)) params.set('visibility', $('voice-type').value);
    const result = await apiRequest('/fish/model?' + params.toString());
    const items = getVoiceItems(result.data);
    state.voices = items;
    const total = Number(result.data && result.data.total || items.length);
    state.voicesTotalPages = Math.max(1, Math.ceil(total / 50));
    $('voices-count').textContent = total + ' голосов Fish Audio';
    $('voices-pagination').textContent = 'Страница ' + state.voicesPage + ' из ' + state.voicesTotalPages;
    $('voices-prev').disabled = state.voicesPage <= 1;
    $('voices-next').disabled = state.voicesPage >= state.voicesTotalPages;
    $('voice-language').disabled = true;
    $('voice-language').placeholder = 'Фильтр языка недоступен для личных моделей';
    renderVoices();
    const select = $('tts-fish-voice-select');
    const keep = $('tts-fish-reference').value.trim() || select.value;
    select.replaceChildren();
    items.forEach((voice) => {
      const id = fishVoiceId(voice);
      if (!id) return;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = (voice.title || id) + ' · ' + (voice.state || 'модель');
      select.append(option);
    });
    const manual = document.createElement('option');
    manual.value = '__manual__';
    manual.textContent = 'Ввести reference_id вручную';
    select.append(manual);
    select.value = items.some((voice) => fishVoiceId(voice) === keep) ? keep : '__manual__';
    $('voice-hint').textContent = items.length ? 'Загружено ' + items.length + ' личных голосовых моделей' : 'Личных моделей пока нет. Создайте голос ниже.';
    return items;
  }

  async function loadVoices(page) {
    if (state.provider === 'fish') return loadFishVoices(page);
    $('voice-language').disabled = false;
    $('voice-language').placeholder = 'Например: en, ru';
    assertConnected();
    state.voicesPage = page || 1;
    const params = new URLSearchParams({page: String(state.voicesPage), pageSize: '50', includePersonal: 'true'});
    if (state.voiceType !== 'all') params.set('modelType', state.voiceType);
    if ($('voice-search').value.trim()) params.set('search', $('voice-search').value.trim());
    if ($('voice-language').value.trim()) params.set('supportsLanguage', $('voice-language').value.trim());
    const result = await apiRequest(API_V3 + '/voices?' + params.toString());
    const items = getVoiceItems(result.data);
    state.voices = items;
    const pagination = result.data && (result.data.pagination || result.data);
    state.voicesTotalPages = Number(pagination && (pagination.totalPages || pagination.pages) || 1);
    $('voices-count').textContent = (pagination && pagination.total !== undefined ? pagination.total : items.length) + ' голосов';
    $('voices-pagination').textContent = 'Страница ' + state.voicesPage + ' из ' + state.voicesTotalPages;
    $('voices-prev').disabled = state.voicesPage <= 1;
    $('voices-next').disabled = state.voicesPage >= state.voicesTotalPages;
    renderVoices();
    const select = $('tts-voice');
    const keep = select.value;
    select.replaceChildren();
    items.forEach((voice) => {
      const id = voice.voiceId || voice.id;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = (voice.name || voice.title || voice.displayName || id) + (voice.isPersonal ? ' · личный' : '');
      select.append(option);
    });
    if (!items.some((voice) => (voice.voiceId || voice.id) === keep)) {
      const test = document.createElement('option');
      test.value = TEST_VOICE_ID;
      test.textContent = 'System test voice';
      select.prepend(test);
    }
    select.value = items.some((voice) => (voice.voiceId || voice.id) === keep) ? keep : select.options[0].value;
    $('voice-hint').textContent = items.length ? 'Загружено ' + items.length + ' голосов' : 'Список пуст. Доступен тестовый голос.';
    return items;
  }

  function renderVoices() {
    const body = $('voices-table');
    body.replaceChildren();
    if (state.provider === 'fish') {
      if (!state.voices.length) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = 'table-empty';
        cell.textContent = 'Личные Fish Audio модели не найдены. Создайте голосовую модель из аудиообразца ниже.';
        return;
      }
      state.voices.forEach((voice) => {
        const row = body.insertRow();
        const nameCell = row.insertCell();
        const name = document.createElement('span');
        name.className = 'voice-name';
        name.textContent = voice.title || 'Без названия';
        const desc = document.createElement('small');
        desc.className = 'voice-description';
        desc.textContent = voice.description || '';
        nameCell.append(name, desc);
        const idCell = row.insertCell();
        const id = document.createElement('code');
        id.className = 'id-code';
        id.textContent = fishVoiceId(voice);
        idCell.append(id);
        const typeCell = row.insertCell();
        const type = document.createElement('span');
        type.className = 'type-tag personal';
        type.textContent = voice.state || voice.visibility || 'Личный';
        typeCell.append(type);
        row.insertCell().textContent = Array.isArray(voice.languages) ? voice.languages.join(', ') : '—';
        const actionCell = row.insertCell();
        const use = document.createElement('button');
        use.type = 'button'; use.className = 'text-button'; use.textContent = 'Использовать';
        use.dataset.useVoice = fishVoiceId(voice);
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Изменить';
        edit.dataset.editFishVoice = fishVoiceId(voice);
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'text-button'; del.textContent = 'Удалить';
        del.dataset.deleteVoice = fishVoiceId(voice);
        actionCell.append(use, document.createTextNode(' · '), edit, document.createTextNode(' · '), del);
      });
      return;
    }
    if (!state.voices.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 5;
      cell.className = 'table-empty';
      cell.textContent = 'Голоса по заданным фильтрам не найдены.';
      return;
    }
    state.voices.forEach((voice) => {
      const row = body.insertRow();
      const nameCell = row.insertCell();
      const name = document.createElement('span');
      name.className = 'voice-name';
      name.textContent = voice.name || voice.title || voice.displayName || 'Без названия';
      const desc = document.createElement('small');
      desc.className = 'voice-description';
      desc.textContent = voice.description || '';
      nameCell.append(name, desc);
      const idCell = row.insertCell();
      const id = document.createElement('code');
      id.className = 'id-code';
      id.textContent = voice.voiceId || voice.id || '—';
      idCell.append(id);
      const typeCell = row.insertCell();
      const type = document.createElement('span');
      type.className = 'type-tag' + (voice.isPersonal ? ' personal' : '');
      type.textContent = voice.isPersonal ? 'Личный' : 'Публичный';
      typeCell.append(type);
      row.insertCell().textContent = voice.primaryLanguage || (Array.isArray(voice.languages) ? voice.languages.join(', ') : '—') || '—';
      const actionCell = row.insertCell();
      if (voice.isPersonal) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = 'Удалить';
        button.dataset.deleteVoice = voice.voiceId || voice.id;
        actionCell.append(button);
      } else {
        actionCell.textContent = '—';
      }
    });
  }

  async function deleteVoice(voiceId) {
    if (!window.confirm('Удалить личный голос ' + voiceId + '? Это действие нельзя отменить.')) return;
    if (state.provider === 'fish') {
      await apiRequest('/fish/model/' + encodeURIComponent(voiceId), {method: 'DELETE'});
    } else {
      await apiRequest(API_V1 + '/voices/' + encodeURIComponent(voiceId), {method: 'DELETE'});
    }
    toast('Голос удалён.', 'success');
    await loadVoices(state.voicesPage);
  }

  async function editFishVoice(voiceId) {
    const voice = state.voices.find((item) => fishVoiceId(item) === voiceId);
    if (!voice) throw new Error('Голос не найден в текущем списке.');
    const title = window.prompt('Новое название голоса:', voice.title || '');
    if (title === null) return;
    const description = window.prompt('Новое описание:', voice.description || '');
    if (description === null) return;
    await apiRequest('/fish/model/' + encodeURIComponent(voiceId), {
      method: 'PATCH', body: {title: title.trim(), description: description.trim()}
    });
    toast('Данные голосовой модели обновлены.', 'success');
    await loadVoices(state.voicesPage);
  }

  async function createFishVoice() {
    if (!$('clone-consent').checked) throw new Error('Подтвердите, что имеете право использовать загруженные голосовые образцы.');
    const name = $('clone-name').value.trim();
    const files = Array.from($('clone-files').files || []);
    if (!name) throw new Error('Укажите название голосовой модели.');
    if (!files.length) throw new Error('Выберите хотя бы один аудиофайл.');
    if (files.length > 20) throw new Error('Fish Audio принимает не более 20 образцов за один запрос.');
    if (files.some((file) => !file.type.startsWith('audio/') && !/\.(aac|flac|m4a|mp3|mp4|mpeg|oga|ogg|opus|wav|webm)$/i.test(file.name))) {
      throw new Error('Один из файлов не распознан как поддерживаемый аудиообразец.');
    }
    const reference = $('clone-reference').value.trim();
    const texts = reference ? (files.length === 1 ? [reference] : reference.split(/\r?\n/).map((text) => text.trim()).filter(Boolean)) : [];
    if (texts.length && texts.length !== files.length) {
      throw new Error('Для нескольких аудиофайлов укажите по одному тексту на строку, в том же порядке, что и файлы.');
    }
    const form = new FormData();
    form.append('type', 'tts');
    form.append('title', name);
    form.append('train_mode', 'fast');
    form.append('visibility', $('clone-visibility').value);
    const description = $('clone-description').value.trim();
    if (description) form.append('description', description);
    form.append('enhance_audio_quality', String($('clone-enhance-audio') ? $('clone-enhance-audio').checked : true));
    form.append('generate_sample', String($('clone-generate-sample') ? $('clone-generate-sample').checked : false));
    const tags = $('clone-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
    tags.forEach((tag) => form.append('tags', tag));
    const cover = $('clone-cover').files && $('clone-cover').files[0];
    if (cover) form.append('cover_image', cover, cover.name);
    files.forEach((file) => form.append('voices', file, file.name));
    texts.forEach((text) => form.append('texts', text));
    log('clone-log', 'Передаём ' + files.length + ' образцов Fish Audio. Дождитесь ответа API…');
    const result = await apiRequest('/fish/model', {method: 'POST', body: form, timeout: 300000});
    const model = result.data || {};
    const id = fishVoiceId(model);
    if (!id) throw new Error('Fish Audio ответил без ID модели: ' + pretty(result.data).slice(0, 900));
    $('tts-fish-reference').value = id;
    $('clone-files').value = '';
    log('clone-log', 'Голосовая модель создана. Reference ID: ' + id + '\nСтатус: ' + (model.state || 'создана') + '\nID подставлен в генератор речи.', 'success');
    toast('Fish Audio: голос создан.', 'success');
    await loadFishVoices(1);
  }

  async function createVoice() {
    if (state.provider === 'fish') return createFishVoice();
    if (!$('clone-consent').checked) throw new Error('Подтвердите, что имеете право использовать загруженные голосовые образцы.');
    const name = $('clone-name').value.trim();
    const files = Array.from($('clone-files').files || []);
    if (!name) throw new Error('Укажите название голоса.');
    if (!files.length) throw new Error('Выберите хотя бы один аудиофайл.');
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) throw new Error('Файл ' + file.name + ' больше 10 МБ.');
    }
    const form = new FormData();
    form.append('name', name);
    form.append('visibility', $('clone-visibility').value);
    if ($('clone-description').value.trim()) form.append('description', $('clone-description').value.trim());
    if ($('clone-reference').value.trim()) form.append('referenceText', $('clone-reference').value.trim());
    files.forEach((file) => form.append('audioFiles', file, file.name));
    const result = await apiRequest(API_V1 + '/voices', {method: 'POST', body: form, timeout: 180000});
    log('clone-log', 'Голос создан: ' + pretty(result.data), 'success');
    toast('Голос успешно создан.', 'success');
    $('clone-files').value = '';
    await loadVoices(1);
  }

  function extractUrl(data) {
    const candidates = [
      data && data.url,
      data && data.file_url,
      data && data.fileUrl,
      data && data.media_url,
      data && data.mediaUrl,
      data && data.data && data.data.url,
      data && data.data && data.data.file_url,
      data && data.data && data.data.fileUrl,
      data && data.data && data.data.mediaUrl
    ];
    return candidates.find((candidate) => typeof candidate === 'string' && /^https:\/\/[a-z0-9.-]+\//i.test(candidate)) || '';
  }

  async function uploadMedia() {
    const file = $('upload-file').files[0];
    if (!file) throw new Error('Выберите файл для загрузки.');
    const form = new FormData();
    form.append('type', $('upload-type').value);
    form.append('file', file, file.name);
    const result = await apiRequest(API_V1 + '/uploads', {method: 'POST', body: form, timeout: 180000});
    const url = extractUrl(result.data);
    if (!url) throw new Error('Загрузка завершилась, но URL не найден в ответе: ' + pretty(result.data).slice(0, 500));
    $('uploaded-url').value = url;
    $('upload-result').classList.remove('hidden');
    if ($('upload-type').value === 'audio') $('transcribe-url').value = url;
    log('upload-log', 'Файл загружен. Скопируйте URL для следующего шага.', 'success');
  }

  async function transcribe() {
    const url = $('transcribe-url').value.trim();
    if (!/^https:\/\//i.test(url)) throw new Error('Укажите HTTPS URL аудиофайла.');
    const payload = {audio_url: url};
    const language = $('transcribe-language').value.trim();
    if (language) payload.language = language;
    const result = await apiRequest(API_V1 + '/speech/transcriptions', {method: 'POST', body: payload, timeout: 180000});
    $('transcribe-result').classList.remove('hidden');
    $('transcript-text').textContent = typeof result.data === 'string' ? result.data : pretty(result.data);
    log('transcribe-log', 'Транскрибация завершена.', 'success');
  }

  async function createLipSync() {
    const video = $('lipsync-video').value.trim();
    const audio = $('lipsync-audio').value.trim();
    if (!/^https:\/\//i.test(video) || !/^https:\/\//i.test(audio)) throw new Error('Укажите HTTPS URL видео и аудио.');
    const result = await apiRequest(API_V1 + '/media/lip-sync/jobs', {
      method: 'POST',
      body: {video_url: video, audio_url: audio},
      timeout: 120000,
      idempotencyKey: uuid()
    });
    const data = result.data && (result.data.data || result.data);
    const id = data && (data.id || data.jobId || data.job_id);
    log('lipsync-log', 'Задача создана: ' + pretty(result.data) + (id ? '\nID: ' + id : ''), 'success');
    if (id) {
      state.lipSyncJobs.push(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-quiet button-small';
      button.textContent = 'Проверить задачу ' + id;
      button.addEventListener('click', async () => {
        try {
          const status = await apiRequest(API_V1 + '/media/lip-sync/jobs/' + encodeURIComponent(id));
          log('lipsync-log', pretty(status.data), 'success');
        } catch (error) { log('lipsync-log', error.message, 'error'); }
      });
      $('lipsync-log').append(button);
    }
  }

  async function refreshJobs() {
    assertConnected();
    const result = await apiRequest(API_V3 + '/speech/tts/jobs?limit=50&page=1');
    const data = result.data;
    state.jobs = Array.isArray(data) ? data : data && (data.items || data.jobs || data.data && (data.data.items || data.data.jobs)) || [];
    $('jobs-count').textContent = state.jobs.length + ' задач';
    renderJobs();
    log('jobs-log', 'Загружено задач: ' + state.jobs.length, 'success');
  }

  function renderJobs() {
    const body = $('jobs-table');
    body.replaceChildren();
    if (!state.jobs.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 6;
      cell.className = 'table-empty';
      cell.textContent = 'Задач не найдено.';
      return;
    }
    state.jobs.forEach((job) => {
      const row = body.insertRow();
      const idCell = row.insertCell();
      const id = job.taskId || job.id || job.task_id || '—';
      const idNode = document.createElement('code');
      idNode.className = 'id-code';
      idNode.textContent = id;
      idCell.append(idNode);
      const statusCell = row.insertCell();
      const status = String(job.status || 'unknown');
      const statusNode = document.createElement('span');
      statusNode.className = 'status-tag ' + status.toLowerCase();
      statusNode.textContent = status;
      statusCell.append(statusNode);
      row.insertCell().textContent = job.voiceId || job.voice_id || '—';
      row.insertCell().textContent = job.creditsUsed !== undefined ? String(job.creditsUsed) : job.credits_used !== undefined ? String(job.credits_used) : '—';
      const created = job.createdAt || job.created_at;
      row.insertCell().textContent = created ? new Date(created).toLocaleString() : '—';
      const actions = row.insertCell();
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'text-button';
      check.textContent = 'Проверить';
      check.dataset.jobId = id;
      actions.append(check);
    });
  }

  async function recoverJob(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Введите ID задачи.');
    const response = await apiRequest(API_V3 + '/speech/tts/jobs/' + encodeURIComponent(id));
    const task = getTask(response.data);
    log('recover-log', pretty(response.data), 'success');
    const status = String(task.status || task.state || '').toLowerCase();
    if (['success', 'partial_fail', 'completed'].includes(status)) {
      const path = task.delivery && (task.delivery.downloadUrl || task.delivery.playbackUrl) || task.audioUrl || task.audio_url;
      if (path) await fetchAudioFromPath(path, 'kitta-' + id + '.mp3', 'Восстановлено из истории задач');
    }
  }

  function setProviderUi(provider) {
    const isFish = provider === 'fish';
    state.provider = isFish ? 'fish' : 'kitta';
    if ($('voice-type')) {
      $('voice-type').replaceChildren(...(isFish
        ? [new Option('Все мои модели', 'all'), new Option('Приватные', 'private'), new Option('Доступ по ссылке', 'unlist')]
        : [new Option('Все голоса', 'all'), new Option('Публичные', 'public'), new Option('Личные', 'personal')]));
    }
    if ($('voice-language')) {
      $('voice-language').disabled = isFish;
      $('voice-language').placeholder = isFish ? 'Фильтр языка недоступен для личных моделей' : 'Например: en, ru';
    }
    const toggle = (id, visible) => {
      const node = $(id);
      if (node) {
        node.hidden = !visible;
        node.classList.toggle('hidden', !visible);
      }
    };
    document.querySelectorAll('[data-kitta-only]').forEach((node) => {
      node.hidden = isFish;
      node.classList.toggle('hidden', isFish);
    });
    document.querySelectorAll('[data-fish-only]').forEach((node) => {
      node.hidden = !isFish;
      node.classList.toggle('hidden', !isFish);
    });
    toggle('fish-asr-panel', isFish);
    toggle('fish-design-panel', isFish);
    toggle('fish-infill-panel', isFish);
    toggle('fish-realtime-note', isFish);
    toggle('kitta-upload-panel', !isFish);
    toggle('kitta-transcribe-panel', !isFish);
    toggle('kitta-lipsync-panel', !isFish);
    toggle('tts-kitta-voice-field', !isFish);
    toggle('tts-fish-voice-select-field', isFish);
    toggle('clone-enhance-field', isFish);
    toggle('fish-clone-hint', isFish);
    toggle('tts-fish-reference-field', isFish);
    toggle('fish-tuning-controls', isFish);
    toggle('tts-emotion-field', !isFish);
    toggle('tts-instruction-field', !isFish);
    toggle('tts-filter-emoji-toggle', !isFish);
    toggle('mode-switch', !isFish);
    toggle('refresh-voices', !isFish);
    const model = $('tts-model');
    if (isFish) {
      model.replaceChildren();
      FISH_MODELS.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        model.append(option);
      });
      model.value = 'drama-3';
      $('model-hint').textContent = 'Модель передаётся в HTTP-заголовке model.';
      $('voice-hint').textContent = 'Выберите личную модель ниже или укажите её reference_id вручную.';
      $('tts-fish-voice-select').value = $('tts-fish-reference').value.trim() || '__manual__';
      $('clone-visibility').replaceChildren(new Option('Приватный', 'private'), new Option('Доступ по ссылке', 'unlist'));
      $('clone-reference').placeholder = 'Необязательно. Для нескольких файлов укажите по одному тексту на строку.';
      $('studio-title').textContent = 'Fish Audio · генерация речи';
      $('studio-description').textContent = 'Нативный REST API Fish Audio: Drama 3, S2 и S3.';
      $('api-origin-label').textContent = 'api.fish.audio · через Worker';
      $('open-settings-label').textContent = 'Fish Audio API';
      $('security-title').textContent = 'Нативный Fish Audio API через ваш Worker.';
      $('security-message').textContent = 'Ключ Fish Audio хранится в Worker Secret FISH_API_KEY. В браузер передаётся только пароль доступа к вашему Worker.';
      $('security-docs').href = 'https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech';
      $('security-docs').textContent = 'Документация Fish Audio ↗';
      $('fish-drama-help').classList.remove('hidden');
      $('tts-format').querySelector('option[value="ogg"]').hidden = true;
      $('tts-format').querySelector('option[value="opus"]').hidden = false;
      $('tts-format').querySelector('option[value="pcm"]').hidden = false;
      if ($('tts-format').value === 'ogg') $('tts-format').value = 'mp3';
      if (state.ttsMode !== 'sync') {
        state.ttsMode = 'sync';
        document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === 'sync'));
        $('generate-tts').querySelector('span').textContent = 'Создать аудио';
      }
      if (!$('view-studio').classList.contains('active')) showView('studio');
    } else {
      model.replaceChildren();
      const option = document.createElement('option');
      option.value = 'fishaudio-s21pro-flash';
      option.textContent = 'fishaudio-s21pro-flash';
      model.append(option);
      $('model-hint').textContent = 'Подключите Kitta Audio для загрузки доступных моделей.';
      $('voice-hint').textContent = 'Каталог голосов Kitta Audio загрузится после подключения.';
      $('studio-title').textContent = 'Генерация речи';
      $('studio-description').textContent = 'Создавайте аудио через актуальный HTTP TTS API Kitta Audio.';
      $('api-origin-label').textContent = 'Secure Worker';
      $('open-settings-label').textContent = 'API proxy';
      $('security-title').textContent = 'Запросы к Kitta Audio выполняются только через серверный proxy.';
      $('security-message').textContent = 'API Kitta Audio не разрешает CORS-запросы с GitHub Pages. Подключите свой Cloudflare Worker, который хранит ключ на сервере.';
      $('security-docs').href = 'https://docs.kittaaudio.com/en/docs/api-reference';
      $('security-docs').textContent = 'Требования безопасности Kitta Audio ↗';
      $('fish-drama-help').classList.add('hidden');
      $('clone-visibility').replaceChildren(new Option('Приватный', 'private'), new Option('Публичный', 'public'));
      $('clone-reference').placeholder = 'Точный текст, произнесённый в загруженной записи';
      $('tts-format').querySelector('option[value="ogg"]').hidden = false;
      $('tts-format').querySelector('option[value="opus"]').hidden = true;
      $('tts-format').querySelector('option[value="pcm"]').hidden = true;
    }
  }

  async function connect() {
    const provider = $('api-provider').value === 'fish' ? 'fish' : 'kitta';
    const proxyText = $('proxy-url').value.trim() || state.proxyUrl;
    const proxyToken = $('proxy-token').value.trim() || state.proxyToken;
    if (!proxyText) throw new Error('Введите HTTPS URL серверного Worker.');
    if (!proxyToken || proxyToken.length < 32) throw new Error('Пароль Worker должен содержать не менее 32 символов.');
    let parsed;
    try { parsed = new URL(proxyText); } catch (_) { throw new Error('Укажите корректный URL Worker.'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.workers.dev') ||
        parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.port) {
      throw new Error('Укажите HTTPS URL вида https://имя-воркера.аккаунт.workers.dev без пути и параметров.');
    }
    state.provider = provider;
    setProviderUi(provider);
    state.proxyUrl = parsed.origin;
    state.proxyToken = proxyToken;
    state.connectionVerified = false;
    state.profile = null;
    log('connection-log', provider === 'fish'
      ? 'Проверяем Fish Audio через GET /wallet/self/package…'
      : 'Проверяем Kitta Audio через GET /api/open/v1/profile…');
    try {
      const result = await apiRequest(provider === 'fish' ? '/fish/wallet/self/package' : API_V1 + '/profile', {
        timeout: 30000,
        allowUnverified: true
      });
      state.profile = result.data;
      state.connectionVerified = true;
      $('proxy-token').value = '';
      const account = provider === 'fish'
        ? [state.profile.type, state.profile.balance !== undefined ? 'баланс: ' + state.profile.balance : '', state.profile.total !== undefined ? 'всего: ' + state.profile.total : ''].filter(Boolean).join(' · ')
        : [state.profile.tier, state.profile.credits !== undefined ? 'кредиты: ' + state.profile.credits : '', state.profile.api_quota_remaining !== undefined ? 'квота: ' + state.profile.api_quota_remaining : ''].filter(Boolean).join(' · ');
      setConnected(true, (provider === 'fish' ? 'Fish Audio' : 'Kitta Audio') + (account ? ' · ' + account : ''));
      log('connection-log', (provider === 'fish' ? 'Fish Audio API подключён через Worker.' : 'Kitta Audio Worker proxy подключён.') + ' Ключ хранится только в Worker Secret. ' + account, 'success');
      toast((provider === 'fish' ? 'Fish Audio' : 'Kitta Audio') + ' подключён.', 'success');
      $('settings-dialog').close();
      if (provider === 'kitta') {
        await loadCapabilities();
        try { await loadVoices(1); } catch (_) {}
      } else {
        try {
          const credit = await apiRequest('/fish/wallet/self/api-credit?check_free_credit=true');
          state.fishApiCredit = credit.data;
          if (state.fishApiCredit && state.fishApiCredit.credit !== undefined) {
            $('sidebar-account').textContent += ' · API credit: ' + state.fishApiCredit.credit;
          }
        } catch (creditError) {
          log('connection-log', 'Fish Audio подключён, баланс API-кредитов недоступен: ' + creditError.message, 'error');
        }
        try { await loadFishVoices(1); } catch (voiceError) {
          log('clone-log', 'Подключение выполнено, но каталог голосов не загрузился: ' + voiceError.message, 'error');
        }
      }
    } catch (error) {
      state.connectionVerified = false;
      state.proxyToken = '';
      setConnected(false);
      log('connection-log', error.message, 'error');
      throw error;
    }
  }

  function disconnect() {
    state.proxyToken = '';
    state.connectionVerified = false;
    state.profile = null;
    state.capabilities = null;
    state.openApi = null;
    $('proxy-token').value = '';
    setConnected(false);
    toast((state.provider === 'fish' ? 'Fish Audio' : 'Kitta Audio') + ' отключён.');
    $('settings-dialog').close();
  }

  async function loadSchema() {
    $('schema-status').textContent = 'Загружаем схемы OpenAPI v1 и v3…';
    const results = await Promise.allSettled([
      apiRequest('/api/openapi.json', {auth: false, timeout: 45000}),
      apiRequest(API_V3 + '/openapi.json', {auth: false, timeout: 45000})
    ]);
    const schemas = [];
    if (results[0].status === 'fulfilled' && results[0].value.kind === 'json') schemas.push({version:'v1',prefix:API_V1,schema:results[0].value.data});
    if (results[1].status === 'fulfilled' && results[1].value.kind === 'json') schemas.push({version:'v3',prefix:API_V3,schema:results[1].value.data});
    if (!schemas.length) {
      const failures = results.map((item) => item.status === 'rejected' ? item.reason.message : 'OpenAPI endpoint returned a non-JSON response').join(' | ');
      throw new Error('Не удалось загрузить схемы v1/v3: ' + failures);
    }
    state.openApi = {
      schemas,
      paths: schemas.flatMap((entry) => Object.entries(entry.schema.paths || {}).map(([path, operations]) => ({
        version:entry.version,
        prefix:entry.prefix,
        path:path.startsWith('/api/') ? path : entry.prefix + (path.startsWith('/') ? path : '/' + path),
        operations
      })))
    };
    const count = state.openApi.paths.reduce((sum, item) => sum + Object.keys(item.operations).filter((method) => ['get','post','put','patch','delete'].includes(method)).length, 0);
    $('schema-status').textContent = schemas.map((entry) => 'OpenAPI ' + entry.version).join(' + ') + ' · ' + count + ' операций';
    renderEndpoints();
  }

  function renderEndpoints() {
    const root = $('endpoint-list');
    root.replaceChildren();
    if (!state.openApi || !state.openApi.paths) {
      root.textContent = 'Схема недоступна.';
      return;
    }
    const filter = $('endpoint-filter').value.toLowerCase();
    let count = 0;
    state.openApi.paths.forEach((entry) => {
      const path = entry.path;
      const operations = entry.operations;
      Object.entries(operations).forEach(([method, operation]) => {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) return;
        const summary = operation.summary || operation.operationId || '';
        if (filter && !(path + ' ' + summary + ' ' + method).toLowerCase().includes(filter)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'endpoint-item';
        const tag = document.createElement('span');
        tag.className = 'method-tag ' + method;
        tag.textContent = method.toUpperCase() + ' ' + entry.version;
        const pathText = document.createElement('span');
        pathText.className = 'endpoint-path';
        pathText.textContent = path;
        const summaryText = document.createElement('span');
        summaryText.className = 'endpoint-summary';
        summaryText.textContent = summary;
        button.append(tag, pathText, summaryText);
        button.addEventListener('click', () => {
          $('explorer-method').value = method.toUpperCase();
          $('explorer-path').value = path;
          $('explorer-body').value = exampleRequestBody(operation);
          $('explorer-content-type').value = operation.requestBody ? 'json' : 'none';
          $('explorer-response').textContent = 'Настройте параметры и отправьте запрос.';
        });
        root.append(button);
        count += 1;
      });
    });
    if (!count) {
      const empty = document.createElement('p');
      empty.className = 'table-empty';
      empty.textContent = 'Маршруты не найдены по фильтру.';
      root.append(empty);
    }
  }

  function exampleRequestBody(operation) {
    try {
      const content = operation.requestBody && operation.requestBody.content;
      const schema = content && (content['application/json'] || content['application/*+json']);
      if (!schema) return '';
      const resolved = schema.schema || {};
      const example = resolved.example || schema.example;
      if (example) return pretty(example);
      const properties = resolved.properties || {};
      const result = {};
      Object.entries(properties).forEach(([key, spec]) => {
        if (spec.example !== undefined) result[key] = spec.example;
        else if (spec.type === 'string') result[key] = '';
        else if (spec.type === 'boolean') result[key] = false;
        else if (spec.type === 'number' || spec.type === 'integer') result[key] = 0;
      });
      return Object.keys(result).length ? pretty(result) : '';
    } catch (_) { return ''; }
  }

  async function sendExplorerRequest() {
    const method = $('explorer-method').value;
    const path = $('explorer-path').value.trim();
    const contentType = $('explorer-content-type').value;
    const bodyText = $('explorer-body').value.trim();
    if (!path) throw new Error('Введите путь API.');
    normalizePath(path);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !window.confirm('Выполнить ' + method + ' запрос к ' + path + '? Операция может изменить данные или расходовать квоту.')) return;
    let body;
    if (contentType === 'json' && bodyText && method !== 'GET' && method !== 'DELETE') {
      try { body = JSON.parse(bodyText); } catch (error) { throw new Error('Некорректный JSON: ' + error.message); }
    }
    $('explorer-response').textContent = 'Запрос выполняется…';
    const started = Date.now();
    const result = await apiRequest(path, {method, body, timeout: 120000});
    $('explorer-response-meta').textContent = method + ' · ' + (result.response.status || 200) + ' · ' + (Date.now() - started) + ' мс';
    if (result.kind === 'blob') {
      $('explorer-response').textContent = 'Бинарный ответ: ' + result.data.type + ' · ' + result.data.size + ' байт. Для аудио используйте генератор речи.';
      return;
    }
    $('explorer-response').textContent = result.kind === 'json' ? pretty(result.data) : result.data;
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === 'view-' + name));
    document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    const titles = {studio:'Генерация речи',voices:'Голоса',media:'Медиа и задачи',jobs:'История TTS',explorer:'API Explorer'};
    $('page-breadcrumb').textContent = titles[name] || titles.studio;
    if (name === 'voices' && state.connectionVerified && !state.voices.length) loadVoices(1).catch((error) => log('clone-log', error.message, 'error'));
    if (name === 'jobs' && state.connectionVerified) refreshJobs().catch((error) => log('jobs-log', error.message, 'error'));
    if (name === 'explorer' && state.connectionVerified && !state.openApi) loadSchema().catch((error) => {
      $('schema-status').textContent = 'Схема не загрузилась: ' + error.message;
      $('endpoint-list').textContent = 'Попробуйте обновить схему. Маршруты можно вводить вручную.';
    });
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    $('open-settings').addEventListener('click', () => $('settings-dialog').showModal());
    $('api-provider').addEventListener('change', () => {
      setProviderUi($('api-provider').value);
      state.connectionVerified = false;
      setConnected(false);
    });
    $('dismiss-security').addEventListener('click', () => $('security-banner').classList.add('hidden'));
    $('connect-api').addEventListener('click', async () => {
      const button = $('connect-api');
      setBusy(button, true, 'Проверка…');
      try { await connect(); } catch (error) { toast(error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('disconnect-api').addEventListener('click', disconnect);
    $('clear-text').addEventListener('click', () => { $('tts-text').value = ''; updateTextCounter(); });
    $('tts-text').addEventListener('input', updateTextCounter);
    $('tts-model').addEventListener('change', () => { if (state.provider === 'kitta') updateModelControls(); });
    $('refresh-voices').addEventListener('click', async () => {
      try { await loadVoices(1); toast('Список голосов обновлён.', 'success'); }
      catch (error) { log('studio-log', error.message, 'error'); }
    });
    $('voices-reload').addEventListener('click', async () => {
      try { await loadVoices(1); toast('Список голосов обновлён.', 'success'); }
      catch (error) { toast(error.message, 'error'); }
    });
    $('voice-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadVoices(1).catch((error) => toast(error.message, 'error')); });
    $('voice-type').addEventListener('change', () => { state.voiceType = $('voice-type').value; loadVoices(1).catch((error) => toast(error.message, 'error')); });
    $('voice-language').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadVoices(1).catch((error) => toast(error.message, 'error')); });
    $('voices-prev').addEventListener('click', () => loadVoices(Math.max(1, state.voicesPage - 1)).catch((error) => toast(error.message, 'error')));
    $('voices-next').addEventListener('click', () => loadVoices(Math.min(state.voicesTotalPages, state.voicesPage + 1)).catch((error) => toast(error.message, 'error')));
    $('voices-table').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.deleteVoice) deleteVoice(button.dataset.deleteVoice).catch((error) => toast(error.message, 'error'));
      if (button.dataset.useVoice) {
        $('tts-fish-reference').value = button.dataset.useVoice;
        $('tts-fish-voice-select').value = button.dataset.useVoice;
        showView('studio');
        toast('Reference ID подставлен в генератор речи.', 'success');
      }
      if (button.dataset.editFishVoice) editFishVoice(button.dataset.editFishVoice).catch((error) => toast(error.message, 'error'));
    });
    $('tts-fish-voice-select').addEventListener('change', () => {
      if ($('tts-fish-voice-select').value !== '__manual__') $('tts-fish-reference').value = $('tts-fish-voice-select').value;
    });
    $('clone-submit').addEventListener('click', async () => {
      const button = $('clone-submit');
      setBusy(button, true, 'Создание…');
      try { await createVoice(); } catch (error) { log('clone-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('fish-asr-submit').addEventListener('click', async () => {
      const button = $('fish-asr-submit');
      setBusy(button, true, 'Распознаём…');
      try { await fishTranscribe(); } catch (error) { log('fish-asr-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('fish-design-submit').addEventListener('click', async () => {
      const button = $('fish-design-submit');
      setBusy(button, true, 'Создаём варианты…');
      try { await fishVoiceDesign(); } catch (error) { log('fish-design-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('fish-infill-submit').addEventListener('click', async () => {
      const button = $('fish-infill-submit');
      setBusy(button, true, 'Редактируем аудио…');
      try { await fishAudioInfill(); } catch (error) { log('fish-infill-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('upload-submit').addEventListener('click', async () => {
      const button = $('upload-submit');
      setBusy(button, true, 'Загрузка…');
      try { await uploadMedia(); } catch (error) { log('upload-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('copy-upload-url').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('uploaded-url').value); toast('URL скопирован.', 'success'); }
      catch (_) { $('uploaded-url').select(); document.execCommand('copy'); toast('URL скопирован.'); }
    });
    $('transcribe-submit').addEventListener('click', async () => {
      const button = $('transcribe-submit');
      setBusy(button, true, 'Транскрибация…');
      try { await transcribe(); } catch (error) { log('transcribe-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('copy-transcript').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('transcript-text').textContent); toast('Текст скопирован.', 'success'); }
      catch (_) { toast('Не удалось скопировать.'); }
    });
    $('lipsync-submit').addEventListener('click', async () => {
      const button = $('lipsync-submit');
      setBusy(button, true, 'Создание…');
      try { await createLipSync(); } catch (error) { log('lipsync-log', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('jobs-refresh').addEventListener('click', () => refreshJobs().catch((error) => log('jobs-log', error.message, 'error')));
    $('jobs-table').addEventListener('click', (event) => {
      const button = event.target.closest('[data-job-id]');
      if (button) recoverJob(button.dataset.jobId).catch((error) => log('jobs-log', error.message, 'error'));
    });
    $('recover-task').addEventListener('click', () => recoverJob($('recover-task-id').value).catch((error) => log('recover-log', error.message, 'error')));
    document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => {
      state.ttsMode = button.dataset.mode;
      document.querySelectorAll('.mode-button').forEach((item) => item.classList.toggle('active', item === button));
      $('generate-tts').querySelector('span').textContent = state.ttsMode === 'sync' ? 'Создать аудио' : 'Создать фоновую задачу';
    }));
    $('generate-tts').addEventListener('click', async () => {
      const button = $('generate-tts');
      setBusy(button, true, 'Генерация…');
      try {
        assertConnected();
        const payload = buildTtsPayload();
        if (state.provider === 'fish') await generateFishTts(payload);
        else if (state.ttsMode === 'sync') await generateSync(payload);
        else await generateAsync(payload);
      } catch (error) {
        $('job-progress').classList.add('hidden');
        $('result-empty').classList.remove('hidden');
        log('studio-log', error.message, 'error');
      } finally { setBusy(button, false); }
    });
    $('schema-reload').addEventListener('click', () => loadSchema().catch((error) => {
      $('schema-status').textContent = 'Ошибка: ' + error.message;
      toast(error.message, 'error');
    }));
    $('endpoint-filter').addEventListener('input', renderEndpoints);
    $('explorer-send').addEventListener('click', async () => {
      const button = $('explorer-send');
      setBusy(button, true, 'Запрос…');
      try { await sendExplorerRequest(); } catch (error) {
        $('explorer-response-meta').textContent = 'Ошибка';
        $('explorer-response').textContent = error.message;
      } finally { setBusy(button, false); }
    });
    $('tts-speed').addEventListener('input', () => $('speed-output').textContent = Number($('tts-speed').value).toFixed(2) + '×');
    $('tts-volume').addEventListener('input', () => $('volume-output').textContent = $('tts-volume').value + ' dB');
    $('tts-stability').addEventListener('input', () => $('stability-output').textContent = Number($('tts-stability').value).toFixed(2));
    $('tts-similarity').addEventListener('input', () => $('similarity-output').textContent = Number($('tts-similarity').value).toFixed(2));
    $('tts-pitch').addEventListener('input', () => $('pitch-output').textContent = $('tts-pitch').value);
    $('fish-temperature').addEventListener('input', () => $('fish-temperature-output').textContent = Number($('fish-temperature').value).toFixed(2));
    $('fish-top-p').addEventListener('input', () => $('fish-top-p-output').textContent = Number($('fish-top-p').value).toFixed(2));
    $('fish-asr-model').addEventListener('change', () => {
      if (!FISH_ASR_MODELS.includes($('fish-asr-model').value)) $('fish-asr-model').value = 'transcribe-1-pro';
    });
    $('fish-infill-mode').addEventListener('change', updateFishInfillFields);
  }

  function updateTextCounter() {
    const size = $('tts-text').value.length;
    $('text-counter').textContent = size.toLocaleString() + ' символов';
  }

  function showWelcomeNotice() {
    const dialog = $('welcome-dialog');
    if (!dialog) return;
    let seen = false;
    try { seen = localStorage.getItem('kitta_anya_notice_seen') === '1'; } catch (_) {}
    if (seen) return;
    const markSeen = () => {
      try { localStorage.setItem('kitta_anya_notice_seen', '1'); } catch (_) {}
    };
    $('welcome-close').addEventListener('click', () => {
      markSeen();
      dialog.close();
    }, {once: true});
    dialog.addEventListener('cancel', markSeen, {once: true});
    dialog.showModal();
  }

  function init() {
    bindEvents();
    setConnected(false);
    updateTextCounter();
    setProviderUi(state.provider);
    $('model-hint').textContent = 'Подключите Worker proxy для загрузки доступных моделей.';
    $('voice-hint').textContent = 'Подключите Worker proxy для загрузки голосов.';
    $('schema-status').textContent = 'Подключите Worker proxy для загрузки OpenAPI v1 и v3.';
    $('endpoint-list').textContent = 'Маршруты появятся после подключения.';
    showWelcomeNotice();
  }

  document.addEventListener('DOMContentLoaded', init, {once: true});
})();
