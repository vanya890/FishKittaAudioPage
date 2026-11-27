# Kitta Audio Console

Статический интерфейс для Kitta Audio Open API. Разворачивается на GitHub Pages.

**Сайт:** https://vanya890.github.io/FishKittaAudioPage/

## Возможности

- HTTP Text-to-Speech v3: синхронная генерация и фоновые задачи.
- Автоматическая загрузка моделей и параметров из TTS capabilities.
- Каталог голосов, поиск, фильтры, создание и удаление личных голосов.
- Загрузка медиа, Speech-to-Text и Lip Sync.
- История TTS-задач и восстановление результата по ID.
- API Explorer для схем OpenAPI v1 и v3.
- Адаптивный интерфейс.
- Одноразовое приветственное уведомление при первом посещении: «Сайт был создан по просьбе Ани :>».

## Архитектура и CORS

Прямые браузерные запросы с GitHub Pages к https://fishaudio.org не работают: API отвечает CORS origin https://kittaaudio.com, который не совпадает с https://vanya890.github.io. Это политика API-сервера; изменить её из JavaScript или HTML невозможно.

Поэтому сайт обращается только к Cloudflare Worker proxy. Worker:
- фиксирует upstream на https://fishaudio.org;
- хранит Kitta API key в Worker Secret KITTA_API_KEY;
- требует отдельный случайный PROXY_ACCESS_TOKEN для каждого запроса;
- проверяет точный Origin GitHub Pages;
- отвечает на CORS preflight OPTIONS до проверки токена;
- разрешает только Open API v1/v3 paths;
- не передаёт proxy token провайдеру и добавляет Kitta API key только на сервере;
- не кэширует API-ответы.

Браузер хранит Worker URL и proxy token только в памяти текущей вкладки. Они не записываются в Local Storage, Session Storage, cookies или URL. Единственное значение в Local Storage — флаг показа приветствия, не содержащий секретов.

## Развёртывание Cloudflare Worker

1. Установите Node.js и Wrangler:

~~~bash
npm install -g wrangler
wrangler login
~~~

2. В файле worker/wrangler.toml проверьте ALLOWED_ORIGIN. Для этого сайта оставьте:

~~~toml
ALLOWED_ORIGIN = "https://vanya890.github.io"
~~~

3. Перейдите в папку Worker и задайте два отдельных секрета:

~~~bash
cd worker
npx wrangler secret put KITTA_API_KEY
npx wrangler secret put PROXY_ACCESS_TOKEN
~~~

KITTA_API_KEY — ключ Kitta Audio из настроек аккаунта. PROXY_ACCESS_TOKEN — отдельный случайный пароль, который защищает доступ к вашему Worker. Сгенерируйте его локально, например через Node.js:

~~~bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Сохраните значение PROXY_ACCESS_TOKEN в менеджере паролей. Не добавляйте его в репозиторий, исходники сайта или команду deploy.

4. Разверните Worker:

~~~bash
npx wrangler deploy
~~~

5. Скопируйте URL вида https://fish-kitta-audio-proxy.<account>.workers.dev.

6. На сайте откройте **API proxy**, вставьте URL Worker и значение PROXY_ACCESS_TOKEN, затем нажмите **Подключить и проверить**.

**Не включайте Cloudflare Access перед этим Worker.** Здесь используется собственная проверка PROXY_ACCESS_TOKEN. Access может перехватывать OPTIONS preflight, а браузеры не отправляют cookies с OPTIONS. Worker уже реализует точный CORS для GitHub Pages.

### CORS и заголовки

Worker отвечает для единственного origin https://vanya890.github.io. На OPTIONS он возвращает:
- Access-Control-Allow-Origin: https://vanya890.github.io;
- методы GET, POST, PUT, PATCH, DELETE;
- заголовки Authorization, Content-Type, Idempotency-Key, X-Request-Id, Range.

Для основного запроса браузер отправляет Authorization: Bearer PROXY_ACCESS_TOKEN. Worker проверяет его и заменяет заголовок на Authorization: Bearer KITTA_API_KEY перед отправкой на fishaudio.org.

Если браузер всё ещё сообщает CORS, проверьте, что URL Worker правильный, секреты созданы в том же окружении, Worker повторно развёрнут после изменений, а ALLOWED_ORIGIN точно совпадает с origin сайта. OPTIONS не должен перенаправляться на страницу входа.

## GitHub Pages

В репозитории установлен GitHub Actions workflow. При push в main он проверяет синтаксис JavaScript, структуру сайта, отсутствие клиентского Kitta API key, CORS-обработчик Worker и отсутствие секретов в клиентском коде. Отдельные runtime-тесты Worker проверяют preflight OPTIONS, allowlist Origin, отказ для неверного токена и то, что настоящий Kitta API key не раскрывается клиентскому proxy token. После проверок GitHub Actions публикует Pages.

## API и безопасность

- Документация Kitta Audio: https://docs.kittaaudio.com/en/docs/getting-started
- API Reference: https://docs.kittaaudio.com/en/docs/api-reference
- Cloudflare Workers: https://developers.cloudflare.com/workers/

Realtime TTS пока требует отдельной интеграции WebSocket и серверной выдачи временного browser ticket.

Это независимый интерфейс; API, квоты и списание кредитов контролируются Kitta Audio.
