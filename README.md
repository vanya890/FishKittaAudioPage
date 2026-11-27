# Kitta Audio Console

Веб-интерфейс с двумя провайдерами: **Kitta Audio Open API** и **нативный Fish Audio API**. Работает на GitHub Pages через Cloudflare Worker; для Windows доступна portable-сборка без установки Node.js.

**Сайт:** https://vanya890.github.io/FishKittaAudioPage/

## Возможности

### Kitta Audio
- HTTP Text-to-Speech v3: синхронная генерация и фоновые задачи.
- Каталог голосов, поиск, фильтры, создание и удаление личных голосов.
- Upload API, Speech-to-Text, Lip Sync.
- История TTS-задач и восстановление результата по ID.
- API Explorer для схем OpenAPI v1 и v3.

### Native Fish Audio
- **Клонирование голоса:** создание TTS-модели из 1–20 аудиообразцов через `POST /model`, режим `fast`. Можно передать транскрипты, теги, описание, обложку, включить улучшение аудио и демонстрационный образец.
- Управление личными моделями: список, поиск, фильтр видимости, просмотр, изменение названия/описания и удаление.
- Созданный `_id` сразу подставляется в `reference_id` генератора TTS.
- REST TTS с моделями S1, S2, S3 и Drama 3; основные настройки, дополнительные параметры из TTSRequest и опциональный SSE TTS с временными метками.
- Многоголосый TTS для поддерживаемых моделей: JSON-массив `reference_id` и теги `<|speaker:0|>`, `<|speaker:1|>` в тексте.
- Speech-to-Text с выбором модели, языка и временных меток.
- Voice Design: генерация предварительных голосовых вариантов по текстовому описанию.
- Audio Infill: замена фрагмента записи или генерация связки между двумя аудиоклипами.
- Информация о тарифе и API-кредитах.

Voice Design выдаёт предварительные аудиообразцы; это не автоматическое сохранение клонированной модели. Для создания постоянной модели используйте форму клонирования. Inline voice references через MessagePack и WebSocket Realtime TTS/ASR пока не реализованы.

**Клонируйте только голос, которым владеете или на использование которого получили разрешение.** Перед отправкой файлов приложение требует подтвердить это.

## Portable Windows

[GitHub Releases](https://github.com/vanya890/FishKittaAudioPage/releases)

1. Распакуйте ZIP в обычную папку.
2. Запустите `start.bat`.
3. После запуска локального сервера браузер откроет страницу автоматически.
4. Выберите Kitta Audio или Native Fish Audio и вставьте соответствующий API key.

Не нужны установленный Node.js, npm, Python, Docker, домен или внешний хостинг. Архив включает официальный portable Node.js runtime с проверкой SHA-256. Сервер слушает только `127.0.0.1`, выбирает свободный порт в диапазоне 4173–4199 и автоматически открывает выбранный адрес в браузере.

Для Fish Audio используйте нативный ключ (обычно начинается с `sk-fish-`). Для Kitta Audio нужен отдельный Kitta Open API key.

Ключ передаётся только локальному серверу и API выбранного провайдера; в файлы и браузерное хранилище он не записывается. После обновления страницы его потребуется ввести повторно.

Поддерживаются Windows 10/11 x64. Публичная GitHub Pages-версия использует Worker-режим.

## Архитектура GitHub Pages и Worker

Прямые браузерные запросы с GitHub Pages к API не используются. Схема:

`GitHub Pages → Cloudflare Worker → api.fish.audio`

Для Worker задаются независимые secrets:
- `KITTA_API_KEY` — Kitta Audio Open API key.
- `FISH_API_KEY` — нативный Fish Audio API key.
- `PROXY_ACCESS_TOKEN` — отдельный случайный пароль для доступа к Worker.

Worker проверяет точный Origin GitHub Pages, отвечает на CORS preflight OPTIONS, проверяет proxy token, фиксирует upstream на официальных API hosts и не передаёт proxy token провайдеру. Настоящие API-ключи остаются в Cloudflare Worker Secrets.

### Развёртывание Worker

Установите Wrangler и войдите в Cloudflare:

```bash
npm install -g wrangler
wrangler login
```

В `worker/wrangler.toml` оставьте:

```toml
ALLOWED_ORIGIN = "https://vanya890.github.io"
```

Задайте секреты:

```bash
cd worker
npx wrangler secret put KITTA_API_KEY
npx wrangler secret put FISH_API_KEY
npx wrangler secret put PROXY_ACCESS_TOKEN
npx wrangler deploy
```

Скопируйте URL Worker вида `https://<worker>.<account>.workers.dev`. На GitHub Pages нажмите **API proxy**, введите URL и `PROXY_ACCESS_TOKEN`, затем подключитесь. Настоящий Fish API key вводится в Cloudflare Worker Secret, а не в браузер.

Для нового Worker не включайте перед ним Cloudflare Access: он может вмешиваться в OPTIONS preflight. Доступ защищается собственным `PROXY_ACCESS_TOKEN`.

## Проверки

GitHub Actions проверяет JavaScript, структуру сайта, отсутствие клиентских секретов, Worker CORS/authentication, маршрутинг Fish Audio и portable-сборку. Тесты прокси используют mock API, поэтому не расходуют реальные Fish Audio кредиты. Реальную генерацию и создание голосовой модели нужно проверять с собственным API key.

## Документация

- Kitta Audio: https://docs.kittaaudio.com/en/docs/api-reference
- Fish Audio API: https://docs.fish.audio/
- Fish Audio OpenAPI: https://api.fish.audio/openapi.json
- Cloudflare Workers: https://developers.cloudflare.com/workers/

API, доступность моделей, квоты и списание средств контролируются соответствующим провайдером.
