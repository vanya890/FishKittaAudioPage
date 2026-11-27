import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workerSource = await fs.readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const workerModuleUrl = 'data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64');
const { default: worker } = await import(workerModuleUrl);

const origin = 'https://vanya890.github.io';
const proxyToken = 'a'.repeat(64);
const kittaApiKey = 'kitta-test-secret-do-not-forward';
const fishApiKey = 'fish-test-secret-do-not-forward';
const env = {
  ALLOWED_ORIGIN: origin,
  PROXY_ACCESS_TOKEN: proxyToken,
  KITTA_API_KEY: kittaApiKey,
  FISH_API_KEY: fishApiKey
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
  if (String(input).startsWith('https://api.fish.audio/v1/tts')) {
    return new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'X-Request-Id': 'fish-tts-1' }
    });
  }
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
      'Access-Control-Request-Headers': 'authorization,content-type,x-fish-model'
    }
  }), env);
  assert.equal(preflight.status, 204, 'OPTIONS preflight must return 204');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /authorization/i);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /x-fish-model/i);
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

  const fishWallet = await worker.fetch(makeRequest('/fish/wallet/self/package', {
    headers: { Authorization: 'Bearer ' + proxyToken }
  }), env);
  assert.equal(fishWallet.status, 200);
  assert.deepEqual(await fishWallet.json(), { ok: true, source: 'mock-upstream' });
  assert.equal(upstreamCalls.length, 2);
  assert.equal(upstreamCalls[1].url, 'https://api.fish.audio/wallet/self/package');
  assert.equal(upstreamCalls[1].headers.get('Authorization'), 'Bearer ' + fishApiKey);
  assert.notEqual(upstreamCalls[1].headers.get('Authorization'), 'Bearer ' + proxyToken);

  const fishTts = await worker.fetch(makeRequest('/fish/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + proxyToken,
      'X-Fish-Model': 'drama-3',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: '[whisper]Native Fish test.', reference_id: 'test-voice', format: 'mp3' })
  }), env);
  assert.equal(fishTts.status, 200);
  assert.equal(fishTts.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Array.from(new Uint8Array(await fishTts.arrayBuffer())), [73, 68, 51, 1, 2, 3]);
  assert.equal(upstreamCalls.length, 3);
  assert.equal(upstreamCalls[2].url, 'https://api.fish.audio/v1/tts');
  assert.equal(upstreamCalls[2].headers.get('Authorization'), 'Bearer ' + fishApiKey);
  assert.equal(upstreamCalls[2].headers.get('model'), 'drama-3');
  assert.equal(upstreamCalls[2].headers.get('X-Fish-Model'), null);
  assert.notEqual(upstreamCalls[2].headers.get('Authorization'), 'Bearer ' + proxyToken);

  const unsupportedFishModel = await worker.fetch(makeRequest('/fish/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + proxyToken,
      'X-Fish-Model': 'untrusted-model',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: 'must not be forwarded' })
  }), env);
  assert.equal(unsupportedFishModel.status, 400);
  assert.equal(upstreamCalls.length, 3, 'Unsupported Fish models must not reach upstream');

  const missingFishSecret = await worker.fetch(makeRequest('/fish/wallet/self/package', {
    headers: { Authorization: 'Bearer ' + proxyToken }
  }), { ...env, FISH_API_KEY: undefined });
  assert.equal(missingFishSecret.status, 503);
  assert.equal(upstreamCalls.length, 3, 'Fish requests without a server secret must not reach upstream');

  const invalidFishMethod = await worker.fetch(makeRequest('/fish/v1/tts', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + proxyToken }
  }), env);
  assert.equal(invalidFishMethod.status, 405);
  assert.equal(upstreamCalls.length, 3, 'Unsupported Fish endpoint methods must not reach upstream');

  console.log('Worker tests passed: Kitta proxy, Fish Audio wallet/TTS routing, model/method validation, CORS preflight, origin allowlist, and provider-secret isolation.');
} finally {
  globalThis.fetch = originalFetch;
}
