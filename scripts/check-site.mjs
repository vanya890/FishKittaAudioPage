import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error('Duplicate HTML ids: ' + [...new Set(duplicates)].join(', '));

for (const required of ['app.js', 'styles.css', 'favicon.svg']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error('Missing site asset: ' + required);
}
for (const required of ['view-studio', 'view-voices', 'view-media', 'view-jobs', 'view-explorer', 'proxy-url', 'proxy-token', 'api-provider', 'fish-tuning-controls', 'tts-fish-reference', 'clone-files', 'clone-consent', 'tts-fish-voice-select', 'fish-tts-advanced', 'fish-tts-timestamps', 'fish-asr-submit', 'fish-design-submit', 'fish-infill-mode', 'fish-infill-submit', 'welcome-dialog', 'welcome-close', 'generate-tts']) {
  if (!ids.includes(required)) throw new Error('Missing required interface element: ' + required);
}
if (!html.includes('Content-Security-Policy')) throw new Error('Content Security Policy meta tag is required.');
if (!js.includes("const API_ORIGIN = 'https://fishaudio.org'")) throw new Error('The API origin must remain pinned to the official API host.');
if (/sessionStorage|document\.cookie/.test(js)) throw new Error('Do not persist credentials in browser storage.');
if (/localStorage/.test(js) && !js.includes("localStorage.getItem('kitta_anya_notice_seen')")) {
  throw new Error('Local Storage is permitted only for the non-sensitive first-visit notice flag.');
}
if (!js.includes("localStorage.setItem('kitta_anya_notice_seen', '1')")) throw new Error('First-visit notice persistence is missing.');
if (/api-key|state\.apiKey/.test(js) || /id="api-key"/.test(html)) throw new Error('Direct Kitta API key entry must not be present.');
if (!html.includes('Сайт был создан по просьбе Ани :&gt;')) throw new Error('The first-visit Anya notice is missing.');
if (!js.includes("Authorization")) throw new Error('Worker bearer authentication handling is missing.');
if (!js.includes("new URL(url.pathname + url.search, state.proxyUrl)")) throw new Error('All API traffic must go through the Worker proxy.');
if (!js.includes("'/fish/v1/tts'")) throw new Error('Native Fish Audio TTS route is missing.');
for (const required of [
  'async function createFishVoice',
  'async function loadFishVoices',
  "form.append('voices'",
  "form.append('train_mode', 'fast')",
  'async function fishTranscribe',
  'async function fishVoiceDesign',
  'async function fishAudioInfill',
  '/fish/v1/tts/stream/with-timestamp',
  '/fish/wallet/self/api-credit'
]) {
  if (!js.includes(required)) throw new Error('Native Fish Audio feature is missing: ' + required);
}
if (!js.includes("X-Fish-Model")) throw new Error('Fish Audio model routing header is missing.');
if (/state\.fishApiKey|FISH_API_KEY\s*[:=]/.test(js)) throw new Error('Fish Audio API secrets must never be embedded in browser JavaScript.');
if (!js.includes("credentials: 'omit'")) throw new Error('Worker requests must not depend on third-party cookies.');
if (/frame-ancestors/.test(html)) throw new Error('frame-ancestors is not supported in a CSP meta element.');
if (!js.includes("apiRequest('/api/openapi.json'") || !js.includes("apiRequest(API_V3 + '/openapi.json'")) {
  throw new Error('API Explorer must load both the v1 and v3 OpenAPI contracts.');
}
if (!css.includes('.app-shell') || !css.includes('@media')) throw new Error('Responsive application styles are missing.');
if (!fs.existsSync(path.join(root, 'worker/index.js'))) throw new Error('Secure proxy template is missing.');
if (!fs.existsSync(path.join(root, 'scripts/test-worker.mjs'))) throw new Error('Worker runtime tests are missing.');
const worker = fs.readFileSync(path.join(root, 'worker/index.js'), 'utf8');
for (const required of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Headers', "request.method === 'OPTIONS'", 'PROXY_ACCESS_TOKEN', 'KITTA_API_KEY', 'FISH_API_KEY', 'https://api.fish.audio', 'X-Fish-Model', '/fish/model', '/fish/v1/asr', '/fish/v1/voice-design', '/fish/v1/audio/infill']) {
  if (!worker.includes(required)) throw new Error('Worker is missing required CORS or secret handling: ' + required);
}
if (!worker.includes('constantTimeEqual')) throw new Error('Worker token comparison helper is missing.');
console.log('Site validation passed: ' + ids.length + ' unique ids; Fish cloning, model management, TTS, ASR, Voice Design, Audio Infill, Worker secrets, CSP and credential-storage checks are valid.');
