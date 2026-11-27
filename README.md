# Kitta Audio Console

Статический интерфейс для Kitta Audio Open API. Разворачивается на GitHub Pages без сборщика, npm-зависимостей и собственного frontend-сервера.

**Сайт:** https://vanya890.github.io/FishKittaAudioPage/

## Возможности

- HTTP Text-to-Speech v3: синхронная генерация и фоновые задачи с опросом статуса, загрузкой и повторным получением результата.
- Автоматическая загрузка доступных моделей и форматов из TTS capabilities.
- Каталог публичных и личных голосов, поиск, фильтры, постраничная навигация.
- Создание персонального голоса с загрузкой аудиообразцов и удаление личных голосов.
- Загрузка аудио, видео и изображений через Open API Uploads.
- Speech-to-Text по загруженному или внешнему HTTPS URL.
- Lip Sync: создание задачи и проверка её статуса.
- История асинхронных TTS-задач и восстановление результата по ID.
- API Explorer, который загружает OpenAPI JSON и позволяет отправлять запросы к официальным API-маршрутам.
- Адаптивный интерфейс для настольных и мобильных экранов.

## Запуск локально

Откройте репозиторий локально и запустите любой статический HTTP-сервер, например:

~~~bash
python -m http.server 8080
~~~

Затем откройте http://localhost:8080. При открытии HTML через file:// поведение сетевых запросов может отличаться.

## GitHub Pages

В репозитории откройте **Settings → Pages → Build and deployment** и установите **Source: GitHub Actions**. После этого каждый push в main запустит workflow:

1. Проверка синтаксиса app.js.
2. Проверка структуры, уникальности HTML ID, CSP, фиксированного API-хоста и отсутствия браузерного хранилища секретов.
3. Публикация содержимого репозитория в GitHub Pages.

Pull request выполняет проверки, но не публикует сайт. Публикация выполняется после слияния в main.

## Подключение API

API-хост закреплён в приложении: https://fishaudio.org. Это адрес Open API из документации Kitta Audio. Пользовательский ввод не может перенаправить Bearer-ключ на произвольный домен.

### Рекомендуемый способ: серверный proxy

Официальная документация Kitta Audio прямо указывает, что API-ключ должен использоваться на сервере, а не в браузерном приложении. Для этого в репозитории есть Worker-шлюз в папке worker/.

1. Установите Wrangler и войдите в свой Cloudflare аккаунт.
2. В worker/wrangler.toml укажите корректные значения ACCESS_TEAM_DOMAIN и ACCESS_AUD из вашей конфигурации Cloudflare Access. Проверьте ALLOWED_ORIGIN: он должен точно совпадать с URL GitHub Pages.
3. Включите Cloudflare Access для Worker в настройках Workers & Pages. Создайте правило доступа только для своего аккаунта или разрешённых пользователей.
4. Разверните Worker:

~~~bash
cd worker
npx wrangler secret put KITTA_API_KEY
npx wrangler deploy
~~~

5. В интерфейсе сайта откройте «API-ключ» → «Подключить защищённый серверный proxy» и вставьте URL Worker, например https://fish-kitta-audio-proxy.<account>.workers.dev.

Worker:
- не принимает адрес upstream от клиента, а всегда обращается к https://fishaudio.org;
- разрешает только Open API пути v1/v3 и маршруты доставки аудио;
- проверяет Origin и подпись, issuer, audience и срок действия Cloudflare Access JWT;
- хранит ключ только в Worker Secret;
- не пишет API-ключ в журналы и не возвращает его браузеру;
- не кэширует API-ответы.

Не публикуйте Worker без включённого Cloudflare Access и не разрешайте доступ всем пользователям: запросы могут расходовать квоту вашего аккаунта.

### Прямой браузерный режим

Для личного тестирования можно подключить ключ непосредственно в диалоге сайта и подтвердить предупреждение. В этом режиме ключ:
- существует только в памяти JavaScript текущей вкладки;
- не сохраняется в Local Storage, Session Storage, cookies, URL или файлах сайта;
- очищается при отключении или перезагрузке страницы;
- отправляется только на фиксированный HTTPS-хост API.

Однако ключ всё равно находится в браузере и потенциально доступен расширениям, инструментам разработчика и вредоносному коду на устройстве. Документация провайдера не рекомендует такой способ. Используйте отдельный ключ с минимальной квотой и только на доверенном устройстве. Если прямой запрос блокируется CORS, используйте защищённый proxy.

## Версии и маршруты API

В проекте используется контракт по документации Kitta Audio:

| Возможность | API |
|---|---|
| Новые TTS-запросы и фоновые задачи | Open API v3 |
| Список голосов для TTS | Open API v3 |
| Профиль и квота | Open API v1 |
| Создание и удаление голосов | Open API v1 |
| Uploads | Open API v1 |
| Speech-to-Text | Open API v1 |
| Lip Sync | Open API v1 |

API Explorer получает схему из /api/open/v3/openapi.json. Текущая доступность моделей, параметров и форматов определяется ответом capabilities, а не жёстко заданным списком в приложении.

Realtime TTS v3 пока не реализован в интерфейсе. Браузер не может установить WebSocket с Bearer Authorization header; документация требует получить короткоживущий browser ticket через доверенный backend. Не следует обходить это передачей API-ключа в URL.

## Проверки

Локальные проверки:

~~~bash
node --check app.js
node scripts/check-site.mjs
~~~

Workflow выполняет эти проверки при push и pull request.

## Документация

- [API Quickstart](https://docs.kittaaudio.com/en/docs/getting-started)
- [API Reference](https://docs.kittaaudio.com/en/docs/api-reference)
- [TTS HTTP v3](https://docs.kittaaudio.com/en/docs/api-reference/text-to-speech/sync-http)
- [Async Jobs](https://docs.kittaaudio.com/en/docs/api-reference/text-to-speech/async-jobs)
- [Realtime TTS v3](https://docs.kittaaudio.com/en/docs/api-reference/text-to-speech/realtime)
- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

## Важное

Это независимый интерфейс для API, а не официальный продукт Kitta Audio. Оплата, квоты, доступность моделей и обработка запросов контролируются API-провайдером.
