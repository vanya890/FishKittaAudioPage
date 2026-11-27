const API_HOST = 'https://fishaudio.org';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type', 'idempotency-key', 'x-request-id', 'range'];
const EXPOSED_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'content-length',
  'x-request-id',
  'x-openapi-quota-remaining',
  'x-openapi-credits-used',
  'x-openapi-ignored-parameters',
  'retry-after'
];

function cors(origin, env) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-Request-Id, Range',
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS.join(', '),
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) }
  });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyCloudflareAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    const header = decodeJsonPart(parts[0]);
    const payload = decodeJsonPart(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return false;

    const issuer = 'https://' + env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, '').replace(/\/+$/, '');
    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== issuer || !audience.includes(env.ACCESS_AUD)) return false;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return false;

    const certificateResponse = await fetch(issuer + '/cdn-cgi/access/certs', {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!certificateResponse.ok) return false;
    const certificateSet = await certificateResponse.json();
    const jwk = (certificateSet.keys || []).find((key) => key.kid === header.kid);
    if (!jwk) return false;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signedContent = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(parts[2]), signedContent);
  } catch (_) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const expectedOrigin = env.ALLOWED_ORIGIN || '';

    if (!expectedOrigin || origin !== expectedOrigin) {
      return jsonError('Origin is not allowed.', 403);
    }

    const headers = cors(origin, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (!ALLOWED_METHODS.has(request.method)) {
      return jsonError('HTTP method is not allowed.', 405, headers);
    }
    if (!env.KITTA_API_KEY) {
      return jsonError('The server-side KITTA_API_KEY secret is not configured.', 503, headers);
    }

    const incoming = new URL(request.url);
    if (!/^\/api\/open\/(?:v1|v3|tts)\//.test(incoming.pathname) || incoming.pathname.includes('/../')) {
      return jsonError('Only Kitta Audio Open API routes are allowed.', 404, headers);
    }

    // A public Worker must not become an unauthenticated relay for the owner's paid API quota.
    // Configure a Cloudflare Access application for this Worker and supply its team domain and audience.
    if (!(await verifyCloudflareAccess(request, env))) {
      return jsonError('Sign in through the configured Cloudflare Access application.', 401, headers);
    }

    const upstreamUrl = new URL(incoming.pathname + incoming.search, API_HOST);
    const upstreamHeaders = new Headers();
    FORWARDED_REQUEST_HEADERS.forEach((name) => {
      const value = request.headers.get(name);
      if (value) upstreamHeaders.set(name, value);
    });
    upstreamHeaders.set('Authorization', 'Bearer ' + env.KITTA_API_KEY);

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        body: hasBody ? request.body : undefined,
        redirect: 'follow'
      });
    } catch (_) {
      return jsonError('Unable to reach the Kitta Audio API.', 502, headers);
    }

    const responseHeaders = new Headers(headers);
    EXPOSED_RESPONSE_HEADERS.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    });
    responseHeaders.set('Cache-Control', 'no-store');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};