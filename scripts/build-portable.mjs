import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'dist', 'KittaAudioConsole-Portable');

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error('Portable build could not find expected source fragment: ' + label);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error('Portable build found the source fragment more than once: ' + label);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceFunction(source, functionStart, nextMarker, replacement, label) {
  const start = source.indexOf(functionStart);
  if (start < 0) throw new Error('Portable build could not find function: ' + label);
  const end = source.indexOf(nextMarker, start + functionStart.length);
  if (end < 0) throw new Error('Portable build could not find the end marker for: ' + label);
  return source.slice(0, start) + replacement + source.slice(end);
}

const assertConnectedReplacement = [
"  function assertConnected() {",
"    if (!state.apiKey || !state.connectionVerified) {",
"      if (!$('settings-dialog').open) $('settings-dialog').showModal();",
"      throw new Error('Сначала введите и проверьте личный Kitta Audio API key.');",
"    }",
"  }",
""
].join('\n');

const apiRequestReplacement = [
"  async function apiRequest(path, options) {",
"    const settings = options || {};",
"    const url = normalizePath(path);",
"    const headers = new Headers(settings.headers || {});",
"    if (settings.allowUnverified) {",
"      if (!state.apiKey) throw new Error('Сначала введите Kitta Audio API key.');",
"    } else {",
"      assertConnected();",
"    }",
"    // The user's key is sent only to this computer's loopback server.",
"    headers.set('Authorization', 'Bearer ' + state.apiKey);",
"    if (settings.idempotencyKey) headers.set('Idempotency-Key', settings.idempotencyKey);",
"    if (settings.requestId) headers.set('X-Request-Id', settings.requestId);",
"    if (settings.body !== undefined && !(settings.body instanceof FormData) && !headers.has('Content-Type')) {",
"      headers.set('Content-Type', 'application/json');",
"    }",
"    const controller = new AbortController();",
"    const timeout = window.setTimeout(() => controller.abort(), settings.timeout || 90000);",
"    let response;",
"    const requestUrl = url.pathname + url.search;",
"    try {",
"      response = await fetch(requestUrl, {",
"        method: settings.method || 'GET',",
"        headers,",
"        body: settings.body === undefined ? undefined : (settings.body instanceof FormData ? settings.body : typeof settings.body === 'string' ? settings.body : JSON.stringify(settings.body)),",
"        signal: controller.signal,",
"        redirect: 'follow',",
"        cache: 'no-store',",
"        credentials: 'omit'",
"      });",
"    } catch (error) {",
"      if (error && error.name === 'AbortError') throw new Error('Истекло время ожидания API. Для асинхронной задачи проверьте историю перед повторным созданием.');",
"      if (error instanceof TypeError) throw new Error('Не удалось связаться с локальным сервером. Проверьте, что start.bat запущен и окно сервера не закрыто.');",
"      throw error;",
"    } finally {",
"      window.clearTimeout(timeout);",
"    }",
"",
"    const contentType = response.headers.get('content-type') || '';",
"    const requestId = response.headers.get('x-request-id');",
"    if (!response.ok) {",
"      let detail = '';",
"      if (contentType.includes('json')) {",
"        try {",
"          const data = await response.json();",
"          detail = (data.message || data.detail || data.error || data.code || pretty(data)).toString();",
"          if (data.requestId) detail += ' · requestId: ' + data.requestId;",
"        } catch (_) {",
"          detail = response.statusText;",
"        }",
"      } else {",
"        try { detail = (await response.text()).slice(0, 900); } catch (_) { detail = response.statusText; }",
"      }",
"      const error = new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));",
"      error.status = response.status;",
"      error.retryAfter = response.headers.get('retry-after');",
"      error.requestId = requestId;",
"      throw error;",
"    }",
"",
"    if (contentType.includes('application/json') || contentType.includes('+json')) {",
"      return { kind: 'json', data: await response.json(), response };",
"    }",
"    if (contentType.startsWith('text/')) {",
"      return { kind: 'text', data: await response.text(), response };",
"    }",
"    return { kind: 'blob', data: await response.blob(), response };",
"  }",
""
].join('\n');

const connectReplacement = [
"  async function connect() {",
"    const apiKey = $('api-key').value.trim();",
"    if (!apiKey) throw new Error('Вставьте личный Kitta Audio API key.');",
"    state.apiKey = apiKey;",
"    state.connectionVerified = false;",
"    state.profile = null;",
"    log('connection-log', 'Проверяем ключ через локальный сервер и GET /api/open/v1/profile…');",
"    try {",
"      const result = await apiRequest(API_V1 + '/profile', {timeout: 30000, allowUnverified: true});",
"      state.profile = result.data;",
"      state.connectionVerified = true;",
"      $('api-key').value = '';",
"      const account = [state.profile.tier, state.profile.credits !== undefined ? 'кредиты: ' + state.profile.credits : '', state.profile.api_quota_remaining !== undefined ? 'квота: ' + state.profile.api_quota_remaining : ''].filter(Boolean).join(' · ');",
"      setConnected(true, 'Локальный сервер' + (account ? ' · ' + account : ''));",
"      log('connection-log', 'Kitta Audio API подключён. Ключ остаётся в памяти приложения. ' + account, 'success');",
"      toast('Kitta Audio API подключён.', 'success');",
"      $('settings-dialog').close();",
"      await loadCapabilities();",
"      try { await loadVoices(1); } catch (_) {}",
"    } catch (error) {",
"      state.connectionVerified = false;",
"      state.apiKey = '';",
"      setConnected(false);",
"      log('connection-log', error.message, 'error');",
"      throw error;",
"    }",
"  }",
"",
"  function disconnect() {",
"    state.apiKey = '';",
"    state.connectionVerified = false;",
"    state.profile = null;",
"    state.capabilities = null;",
"    state.openApi = null;",
"    $('api-key').value = '';",
"    setConnected(false);",
"    toast('Kitta Audio API отключён.');",
"    $('settings-dialog').close();",
"  }",
""
].join('\n');

function buildPortableApp(source) {
  let app = source;
  app = replaceExactlyOnce(app, "    proxyUrl: '',\n    proxyToken: '',", "    apiKey: '',", 'application connection state');
  app = replaceExactlyOnce(
    app,
    "    $('sidebar-account').textContent = connected ? (label || 'Защищённый proxy активен') : 'Proxy не подключён';",
    "    $('sidebar-account').textContent = connected ? (label || 'Локальный сервер подключён') : 'Локальный сервер не подключён';",
    'connection status label'
  );
  app = replaceFunction(app, '  function assertConnected() {', '\n  function normalizePath(path) {', assertConnectedReplacement, 'assertConnected');
  app = replaceFunction(app, '  async function apiRequest(path, options) {', '\n  function getTask(data) {', apiRequestReplacement, 'API request transport');
  app = replaceFunction(app, '  async function connect() {', '\n  async function loadSchema() {', connectReplacement, 'connect and disconnect');

  app = app.replaceAll('Worker proxy', 'локальный сервер');
  app = app.replaceAll('Worker', 'локальный сервер');
  app = app.replaceAll('PROXY_ACCESS_TOKEN', 'Kitta API key');
  app = app.replaceAll('Cloudflare', 'локальный сервер');
  app = replaceExactlyOnce(app, "$('model-hint').textContent = 'Подключите Worker proxy для загрузки доступных моделей.';", "$('model-hint').textContent = 'Введите API key для загрузки доступных моделей.';", 'initial model hint');
  app = replaceExactlyOnce(app, "$('voice-hint').textContent = 'Подключите Worker proxy для загрузки голосов.';", "$('voice-hint').textContent = 'Введите API key для загрузки голосов.';", 'initial voice hint');
  app = replaceExactlyOnce(app, "$('schema-status').textContent = 'Подключите Worker proxy для загрузки OpenAPI v1 и v3.';", "$('schema-status').textContent = 'Введите API key для загрузки OpenAPI v1 и v3.';", 'initial schema hint');
  app = replaceExactlyOnce(app, "$('endpoint-list').textContent = 'Маршруты появятся после подключения.';", "$('endpoint-list').textContent = 'Маршруты появятся после подключения API key.';", 'initial endpoint hint');
  return app;
}

function buildPortableHtml(source) {
  let html = source;
  html = replaceExactlyOnce(html, "connect-src 'self' https://*.workers.dev;", "connect-src 'self';", 'portable Content Security Policy');
  html = html.replace('Secure Worker', 'Local API');
  html = html.replace('API proxy', 'API key');
  html = html.replace('Proxy не подключён', 'Локальный сервер не подключён');
  html = html.replace(
    '<strong>Запросы к Kitta Audio выполняются только через серверный proxy.</strong>\n            <p>API Kitta Audio не разрешает CORS-запросы с GitHub Pages. Сайт не обращается к fishaudio.org напрямую и не передаёт API-ключ браузеру. Подключите свой Cloudflare Worker, который хранит ключ на сервере.</p>\n            <a href="https://docs.kittaaudio.com/en/docs/api-reference" target="_blank" rel="noreferrer">Требования безопасности Kitta Audio ↗</a>',
    '<strong>Локальный режим: запросы выполняются через сервер на этом компьютере.</strong>\n            <p>Сайт открыт с localhost. Ваш API key передаётся локальному серверу и затем в Kitta Audio. Никакой внешний proxy, домен или хостинг не требуется.</p>\n            <a href="https://docs.kittaaudio.com/en/docs/api-reference" target="_blank" rel="noreferrer">Документация Kitta Audio API ↗</a>'
  );
  html = html.replace('Схемы загружаются через подключённый серверный proxy.', 'Схемы загружаются через локальный сервер на этом компьютере.');
  html = html.replace('API Explorer отправляет запросы через ваш защищённый Worker. Не запускайте незнакомые POST, PUT, PATCH или DELETE операции.', 'API Explorer отправляет запросы через локальный сервер и ваш личный ключ. Не запускайте незнакомые POST, PUT, PATCH или DELETE операции.');

  const dialogPattern = /<dialog class="settings-dialog" id="settings-dialog">[\s\S]*?<\/dialog>/g;
  const dialogMatches = html.match(dialogPattern) || [];
  if (dialogMatches.length !== 1) throw new Error('Portable build expected exactly one connection dialog.');
  const localDialog = '<dialog class="settings-dialog" id="settings-dialog">\n' +
    '    <form method="dialog" class="dialog-close-form"><button class="dialog-close" aria-label="Закрыть">×</button></form>\n' +
    '    <div class="eyebrow">LOCAL API CONNECTION</div><h2>Подключение Kitta Audio</h2>\n' +
    '    <p class="dialog-description">Введите собственный Kitta Audio API key. Он хранится только в памяти этой вкладки и передаётся локальному серверу на вашем компьютере.</p>\n' +
    '    <div class="security-warning"><strong>Не вводите ключ на чужих компьютерах.</strong><span>Ключ не записывается в файлы, cookies или браузерное хранилище. После обновления страницы его потребуется ввести повторно.</span></div>\n' +
    '    <div class="proxy-setup">\n' +
    '      <label class="field-label" for="api-key">Kitta Audio API key</label>\n' +
    '      <input id="api-key" class="key-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Вставьте личный API key">\n' +
    '      <small>Ключ отправляется только на localhost и затем передаётся Kitta Audio. Не делитесь им.</small>\n' +
    '    </div>\n' +
    '    <div class="dialog-actions"><button class="button button-quiet" id="disconnect-api" type="button">Отключить</button><button class="button button-primary" id="connect-api" type="button">Проверить и подключить</button></div>\n' +
    '    <div class="result-log" id="connection-log" aria-live="polite"></div>\n' +
    '    <a class="docs-link" href="https://docs.kittaaudio.com/en/docs/getting-started" target="_blank" rel="noreferrer">Kitta Audio Quickstart ↗</a>\n' +
    '  </dialog>';
  html = html.replace(dialogPattern, localDialog);
  html = html.replaceAll('Worker proxy', 'локальный сервер');
  html = html.replaceAll('Cloudflare Worker', 'локальный сервер');
  html = html.replaceAll('Worker', 'локальный сервер');
  return html;
}

export async function buildPortable() {
  const [indexSource, appSource] = await Promise.all([
    fs.readFile(path.join(root, 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'app.js'), 'utf8')
  ]);
  const portableHtml = buildPortableHtml(indexSource);
  const portableApp = buildPortableApp(appSource);
  await fs.rm(path.join(root, 'dist'), {recursive:true,force:true});
  await fs.mkdir(outputDir, {recursive:true});
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'index.html'), portableHtml),
    fs.writeFile(path.join(outputDir, 'app.js'), portableApp),
    fs.copyFile(path.join(root, 'styles.css'), path.join(outputDir, 'styles.css')),
    fs.copyFile(path.join(root, 'favicon.svg'), path.join(outputDir, 'favicon.svg')),
    fs.copyFile(path.join(root, 'portable', 'local-server.mjs'), path.join(outputDir, 'local-server.mjs')),
    fs.copyFile(path.join(root, 'portable', 'start.bat'), path.join(outputDir, 'start.bat')),
    fs.copyFile(path.join(root, 'portable', 'README.txt'), path.join(outputDir, 'README.txt'))
  ]);
  return outputDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPortable();
  console.log('Portable package prepared: ' + result);
}
