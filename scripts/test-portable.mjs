import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPortable } from './build-portable.mjs';
import { createLocalServer, isAllowedApiPath } from '../portable/local-server.mjs';

const outputDir = await buildPortable();
const [html, app, readme, bat, serverSource] = await Promise.all([
  fs.readFile(path.join(outputDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(outputDir, 'app.js'), 'utf8'),
  fs.readFile(path.join(outputDir, 'README.txt'), 'utf8'),
  fs.readFile(path.join(outputDir, 'start.bat'), 'utf8'),
  fs.readFile(path.join(outputDir, 'local-server.mjs'), 'utf8')
]);

assert.match(html, /id="api-key"/, 'The portable interface must expose a personal API-key field.');
assert.match(html, /id="api-provider"[\s\S]*value="fish"/, 'The portable interface must expose the Fish Audio provider.');
assert.match(html, /id="tts-fish-reference"/, 'The portable interface must expose a Fish voice reference field.');
assert.match(html, /id="clone-files"/, 'The portable interface must expose Fish voice cloning uploads.');
assert.match(html, /id="fish-asr-submit"/, 'The portable interface must expose Fish ASR.');
assert.match(html, /id="fish-design-submit"/, 'The portable interface must expose Fish Voice Design.');
assert.match(html, /id="fish-infill-submit"/, 'The portable interface must expose Fish Audio Infill.');
assert.match(app, /async function createFishVoice/, 'The portable app must implement native Fish voice cloning.');
assert.match(app, /form\.append\('voices'/, 'Fish voice cloning must upload native multipart voices fields.');
assert.match(app, /form\.append\('train_mode', 'fast'/, 'Fish voice cloning must request fast model creation.');
assert.match(app, /async function fishTranscribe/, 'The portable app must implement native Fish ASR.');
assert.match(app, /async function fishVoiceDesign/, 'The portable app must implement native Fish Voice Design.');
assert.match(app, /async function fishAudioInfill/, 'The portable app must implement native Fish Audio Infill.');
assert.match(serverSource, /openBrowser\(url\)/, 'The portable server must automatically open the selected local URL.');
assert.match(serverSource, /spawn\('cmd\.exe'/, 'Windows auto-open must invoke the default browser.');
assert.match(bat, /browser tab will open automatically/i, 'The BAT launcher must announce automatic browser opening.');
assert.doesNotMatch(html, /id="proxy-url"|id="proxy-token"|workers\.dev|Cloudflare Worker/i, 'The portable interface must not require a Worker.');
assert.match(html, /connect-src 'self'/, 'The portable CSP must allow only same-origin API requests.');
assert.doesNotMatch(html, /https:\/\/\*\.workers\.dev/, 'The portable CSP must not reference external proxies.');
assert.match(app, /headers\.set\('Authorization', 'Bearer ' \+ state\.apiKey\)/, 'The browser must authenticate using the personal API key.');
assert.match(app, /settings\.fishModel/, 'The portable app must pass the selected Fish Audio model.');
assert.match(app, /buildFishTtsPayload/, 'The portable app must build native Fish Audio TTS payloads.');
assert.match(app, /const requestUrl = url\.pathname \+ url\.search/, 'The browser must call the same-origin local API route.');
assert.doesNotMatch(app, /state\.proxyUrl|state\.proxyToken|workers\.dev|PROXY_ACCESS_TOKEN/, 'The portable app must not contain Worker credentials or configuration.');
assert.match(readme, /Windows 10 or Windows 11, 64-bit/, 'The supported operating system must be documented.');
assert.match(bat, /runtime\\node\.exe/i, 'The BAT launcher must use the bundled Node runtime.');
assert.match(bat, /local-server\.mjs/i, 'The BAT launcher must start the local server.');

assert.equal(isAllowedApiPath('/api/open/v1/profile'), true);
assert.equal(isAllowedApiPath('/api/open/v3/speech/tts'), true);
assert.equal(isAllowedApiPath('/api/openapi.json'), true);
assert.equal(isAllowedApiPath('/api/admin'), false);
assert.equal(isAllowedApiPath('/api/open/v1/../../admin'), false);
assert.equal(isAllowedApiPath('/api/open/v1/%252e%252e/admin'), false);
assert.equal(isAllowedApiPath('/fish/v1/tts'), true);
assert.equal(isAllowedApiPath('/fish/v1/asr'), true);
assert.equal(isAllowedApiPath('/fish/v1/voice-design'), true);
assert.equal(isAllowedApiPath('/fish/v1/audio/infill'), true);
assert.equal(isAllowedApiPath('/fish/model'), true);
assert.equal(isAllowedApiPath('/fish/model/model_123-safe'), true);
assert.equal(isAllowedApiPath('/fish/wallet/self/package'), true);
assert.equal(isAllowedApiPath('/fish/wallet/self/api-credit'), true);
assert.equal(isAllowedApiPath('/fish/admin/secrets'), false);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kitta-portable-test-'));
await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>portable-test</h1>', 'utf8');
const upstreamCalls = [];
const mockFetch = async (input, init = {}) => {
  let body = '';
  if (init.body) body = await new Response(init.body).text();
  upstreamCalls.push({
    url: String(input),
    method: init.method,
    authorization: new Headers(init.headers || {}).get('authorization'),
    headers: new Headers(init.headers || {}),
    body
  });
  if (String(input) === 'https://api.fish.audio/v1/tts') {
    return new Response(new Uint8Array([73, 68, 51, 7, 8, 9]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' }
    });
  }
  return new Response(JSON.stringify({ ok: true, source: 'mock-kitta' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'portable-test-1' }
  });
};

const server = createLocalServer({ rootDir: tempDir, fetchImpl: mockFetch });
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;

  const health = await fetch(baseUrl + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'Audio Console Local API' });

  const page = await fetch(baseUrl + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /portable-test/);

  const noKey = await fetch(baseUrl + '/api/open/v1/profile');
  assert.equal(noKey.status, 401, 'API requests without a personal key must be rejected');
  assert.equal(upstreamCalls.length, 0);

  const foreignOrigin = await fetch(baseUrl + '/api/open/v1/profile', {
    headers: { Origin: 'https://attacker.example' }
  });
  assert.equal(foreignOrigin.status, 403, 'Cross-origin requests must be rejected');
  assert.equal(upstreamCalls.length, 0);

  const forbiddenPath = await fetch(baseUrl + '/api/admin/secrets', {
    headers: { Authorization: 'Bearer test-personal-key' }
  });
  assert.equal(forbiddenPath.status, 404, 'Non-API routes must not be proxied');

  const profile = await fetch(baseUrl + '/api/open/v1/profile', {
    headers: { Authorization: 'Bearer test-personal-key' }
  });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), { ok: true, source: 'mock-kitta' });
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, 'https://fishaudio.org/api/open/v1/profile');
  assert.equal(upstreamCalls[0].authorization, 'Bearer test-personal-key');

  const payload = JSON.stringify({ text: 'Portable test', voiceId: 'voice-test' });
  const tts = await fetch(baseUrl + '/api/open/v3/speech/tts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-personal-key',
      'Content-Type': 'application/json'
    },
    body: payload
  });
  assert.equal(tts.status, 200);
  assert.equal(upstreamCalls.length, 2);
  assert.equal(upstreamCalls[1].method, 'POST');
  assert.equal(upstreamCalls[1].body, payload);

  const fishWallet = await fetch(baseUrl + '/fish/wallet/self/package', {
    headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(fishWallet.status, 200);
  assert.equal(upstreamCalls.length, 3);
  assert.equal(upstreamCalls[2].url, 'https://api.fish.audio/wallet/self/package');
  assert.equal(upstreamCalls[2].authorization, 'Bearer test-fish-key');

  const fishTts = await fetch(baseUrl + '/fish/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-fish-key',
      'X-Fish-Model': 'drama-3',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: '[whisper]Portable Fish test.', reference_id: 'test-voice', format: 'mp3' })
  });
  assert.equal(fishTts.status, 200);
  assert.equal(fishTts.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Array.from(new Uint8Array(await fishTts.arrayBuffer())), [73, 68, 51, 7, 8, 9]);
  assert.equal(upstreamCalls.length, 4);
  assert.equal(upstreamCalls[3].url, 'https://api.fish.audio/v1/tts');
  assert.equal(upstreamCalls[3].authorization, 'Bearer test-fish-key');
  assert.equal(upstreamCalls[3].headers.get('model'), 'drama-3');
  assert.equal(upstreamCalls[3].headers.get('x-fish-model'), null);

  const fishCredit = await fetch(baseUrl + '/fish/wallet/self/api-credit?check_free_credit=true', {
    headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(fishCredit.status, 200);
  assert.equal(upstreamCalls[4].url, 'https://api.fish.audio/wallet/self/api-credit?check_free_credit=true');

  const fishModels = await fetch(baseUrl + '/fish/model?page_size=50&page_number=1&self=true', {
    headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(fishModels.status, 200);
  assert.equal(upstreamCalls[5].url, 'https://api.fish.audio/model?page_size=50&page_number=1&self=true');

  const cloneForm = new FormData();
  cloneForm.append('type', 'tts');
  cloneForm.append('title', 'Portable clone test');
  cloneForm.append('train_mode', 'fast');
  cloneForm.append('visibility', 'private');
  cloneForm.append('voices', new Blob(['mock audio sample'], { type: 'audio/wav' }), 'voice.wav');
  const cloneResponse = await fetch(baseUrl + '/fish/model', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-fish-key' },
    body: cloneForm
  });
  assert.equal(cloneResponse.status, 200);
  assert.equal(upstreamCalls[6].url, 'https://api.fish.audio/model');
  assert.match(upstreamCalls[6].headers.get('content-type') || '', /multipart\/form-data; boundary=/);
  assert.match(upstreamCalls[6].body, /Portable clone test/);
  assert.match(upstreamCalls[6].body, /voice\.wav/);

  const fishModelGet = await fetch(baseUrl + '/fish/model/model_123-safe', {
    headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(fishModelGet.status, 200);
  assert.equal(upstreamCalls[7].url, 'https://api.fish.audio/model/model_123-safe');

  const fishModelPatch = await fetch(baseUrl + '/fish/model/model_123-safe', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer test-fish-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Updated model' })
  });
  assert.equal(fishModelPatch.status, 200);
  assert.equal(upstreamCalls[8].method, 'PATCH');

  const fishModelDelete = await fetch(baseUrl + '/fish/model/model_123-safe', {
    method: 'DELETE', headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(fishModelDelete.status, 200);
  assert.equal(upstreamCalls[9].method, 'DELETE');

  const asrForm = new FormData();
  asrForm.append('audio', new Blob(['mock audio'], { type: 'audio/wav' }), 'speech.wav');
  const asr = await fetch(baseUrl + '/fish/v1/asr', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-fish-key', 'X-Fish-Model': 'transcribe-2-pro' },
    body: asrForm
  });
  assert.equal(asr.status, 200);
  assert.equal(upstreamCalls[10].url, 'https://api.fish.audio/v1/asr');
  assert.equal(upstreamCalls[10].headers.get('model'), 'transcribe-2-pro');

  const design = await fetch(baseUrl + '/fish/v1/voice-design', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-fish-key', 'X-Fish-Model': 'voice-design-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction: 'Warm narrator', n: 2 })
  });
  assert.equal(design.status, 200);
  assert.equal(upstreamCalls[11].url, 'https://api.fish.audio/v1/voice-design');
  assert.equal(upstreamCalls[11].headers.get('model'), 'voice-design-1');

  const infillForm = new FormData();
  infillForm.append('audio', new Blob(['mock audio'], { type: 'audio/wav' }), 'take.wav');
  infillForm.append('transcript', 'Full replacement sentence.');
  infillForm.append('prefix_seconds', '1');
  infillForm.append('suffix_seconds', '2');
  const infill = await fetch(baseUrl + '/fish/v1/audio/infill', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-fish-key', 'X-Fish-Model': 'drama-3' },
    body: infillForm
  });
  assert.equal(infill.status, 200);
  assert.equal(upstreamCalls[12].url, 'https://api.fish.audio/v1/audio/infill');
  assert.equal(upstreamCalls[12].headers.get('model'), 'drama-3');

  const timestampedTts = await fetch(baseUrl + '/fish/v1/tts/stream/with-timestamp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-fish-key',
      'X-Fish-Model': 'drama-3',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: 'Portable timestamped test', reference_id: 'test-voice', format: 'mp3' })
  });
  assert.equal(timestampedTts.status, 200);
  assert.equal(upstreamCalls[13].url, 'https://api.fish.audio/v1/tts/stream/with-timestamp');
  assert.equal(upstreamCalls[13].headers.get('model'), 'drama-3');

  const callsBeforeRejection = upstreamCalls.length;

  const invalidFishModel = await fetch(baseUrl + '/fish/v1/tts', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-fish-key', 'X-Fish-Model': 'unknown-model' },
    body: '{}'
  });
  assert.equal(invalidFishModel.status, 400);
  assert.equal(upstreamCalls.length, callsBeforeRejection);

  const invalidFishMethod = await fetch(baseUrl + '/fish/v1/tts', {
    headers: { Authorization: 'Bearer test-fish-key' }
  });
  assert.equal(invalidFishMethod.status, 405);
  assert.equal(upstreamCalls.length, callsBeforeRejection);

  console.log('Portable tests passed: dual-provider UI, Fish cloning multipart flow, model CRUD, TTS, ASR, Voice Design, Audio Infill, wallet, BAT browser auto-open, local API-key flow, loopback isolation and binary streaming.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}
