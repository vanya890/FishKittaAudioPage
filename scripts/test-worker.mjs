import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workerSource = await fs.readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const workerModuleUrl = 'data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64');
const { default: worker } = await import(workerModuleUrl);

const origin = 'https://vanya890.github.io';
const proxyToken = 'a'.repeat(64);
const kittaApiKey = 'kitta-test-secret-do-not-forward';
const env = {
  ALLOWED_ORIGIN: origin,
  PROXY_ACCESS_TOKEN: proxyToken,
  KITTA_API_KEY: kittaApiKey
};

const upstreamCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  upstreamCalls.push({
    url: String(input),
    method: init.method || 'GET',
    headers: new Headers(init.headers || {}),
    body: init.body
  });
  return new Response(JSON.stringify({ ok: true, source: 'mock-upstream' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'mock-request-1'
    }
  });
};

function makeRequest(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request('https://fish-kitta-audio-proxy.example.workers.dev' + path, {
    method,
    headers: { Origin: origin, ...headers },
    body
  });
}

try {
  const preflight = await worker.fetch(makeRequest('/api/open/v1/profile', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  }), env);
  assert.equal(preflight.status, 204, 'OPTIONS preflight must return 204');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /authorization/i);
  assert.equal(upstreamCalls.length, 0, 'OPTIONS must not reach the upstream API');

  const missingToken = await worker.fetch(makeRequest('/api/open/v1/profile'), env);
  assert.equal(missingToken.status, 401, 'Missing proxy token must be rejected');
  assert.equal(missingToken.headers.get('Access-Control-Allow-Origin'), origin);

  const invalidToken = await worker.fetch(makeRequest('/api/open/v1/profile', {
    headers: { Authorization: 'Bearer invalid-token' }
  }), env);
  assert.equal(invalidToken.status, 401, 'Invalid proxy token must be rejected');

  const invalidOrigin = await worker.fetch(new Request(
    'https://fish-kitta-audio-proxy.example.workers.dev/api/open/v1/profile',
    { headers: { Origin: 'https://attacker.example', Authorization: 'Bearer ' + proxyToken } }
  ), env);
  assert.equal(invalidOrigin.status, 403, 'Unapproved origins must be rejected');
  assert.equal(invalidOrigin.headers.get('Access-Control-Allow-Origin'), null);

  const disallowedPath = await worker.fetch(makeRequest('/admin/secrets', {
    headers: { Authorization: 'Bearer ' + proxyToken }
  }), env);
  assert.equal(disallowedPath.status, 404, 'Non-Open-API paths must be rejected');
  assert.equal(upstreamCalls.length, 0, 'Rejected requests must not reach upstream');

  const success = await worker.fetch(makeRequest('/api/open/v1/profile', {
    headers: { Authorization: 'Bearer ' + proxyToken }
  }), env);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('Access-Control-Allow-Origin'), origin);
  assert.deepEqual(await success.json(), { ok: true, source: 'mock-upstream' });
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, 'https://fishaudio.org/api/open/v1/profile');
  assert.equal(upstreamCalls[0].headers.get('Authorization'), 'Bearer ' + kittaApiKey);
  assert.notEqual(upstreamCalls[0].headers.get('Authorization'), 'Bearer ' + proxyToken);
  assert.equal(upstreamCalls[0].headers.get('Cookie'), null);

  console.log('Worker tests passed: CORS preflight, origin allowlist, proxy token, path allowlist and upstream secret isolation.');
} finally {
  globalThis.fetch = originalFetch;
}
