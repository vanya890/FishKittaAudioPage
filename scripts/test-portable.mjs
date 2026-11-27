import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPortable } from './build-portable.mjs';
import { createLocalServer, isAllowedApiPath } from '../portable/local-server.mjs';

const outputDir = await buildPortable();
const [html, app, readme, bat] = await Promise.all([
  fs.readFile(path.join(outputDir, 'index.html'), 'utf8'),
  fs.readFile(path.join(outputDir, 'app.js'), 'utf8'),
  fs.readFile(path.join(outputDir, 'README.txt'), 'utf8'),
  fs.readFile(path.join(outputDir, 'start.bat'), 'utf8')
]);

assert.match(html, /id="api-key"/, 'The portable interface must expose a personal API-key field.');
assert.doesNotMatch(html, /id="proxy-url"|id="proxy-token"|workers\.dev|Cloudflare Worker/i, 'The portable interface must not require a Worker.');
assert.match(html, /connect-src 'self'/, 'The portable CSP must allow only same-origin API requests.');
assert.doesNotMatch(html, /https:\/\/\*\.workers\.dev/, 'The portable CSP must not reference external proxies.');
assert.match(app, /headers\.set\('Authorization', 'Bearer ' \+ state\.apiKey\)/, 'The browser must authenticate using the personal API key.');
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
    body
  });
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
  assert.deepEqual(await health.json(), { ok: true, service: 'Kitta Audio Console Local API' });

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

  console.log('Portable tests passed: generated UI, same-origin API-key flow, loopback-only server, origin validation, API route allowlist and streamed POST forwarding.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}
