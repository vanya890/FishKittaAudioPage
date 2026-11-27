const KITTA_API_HOST = 'https://fishaudio.org';
const FISH_API_HOST = 'https://api.fish.audio';
const FISH_MODELS = new Set(['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3', 's3-pro']);
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

function corsHeaders(origin, env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Request-Id, X-Fish-Model, Range',
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS.join(', '),
    'Access-Control-Max-Age': '86400',
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

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }
  return difference === 0;
}

function isAllowedApiPath(pathname) {
  if (pathname === '/fish/v1/tts' || pathname === '/fish/wallet/self/package') return true;
  if (pathname === '/api/openapi.json') return true;
  if (!/^\/api\/open\/(?:v1|v3)\//.test(pathname)) return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (_) { return false; }
  if (decoded.includes('\\') || decoded.split('/').some((part) => part === '.' || part === '..')) return false;
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const expectedOrigin = env.ALLOWED_ORIGIN || '';

    if (!expectedOrigin || origin !== expectedOrigin) {
      return jsonError('Origin is not allowed.', 403);
    }

    const headers = corsHeaders(origin, env);

    // Preflight must be answered before authentication. Browsers do not attach Authorization to OPTIONS.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Origin': origin
        }
      });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return jsonError('HTTP method is not allowed.', 405, headers);
    }
    if (!env.PROXY_ACCESS_TOKEN || env.PROXY_ACCESS_TOKEN.length < 32) {
      return jsonError('The server-side PROXY_ACCESS_TOKEN secret is not configured or is too short.', 503, headers);
    }

    const incoming = new URL(request.url);
    if (!isAllowedApiPath(incoming.pathname)) {
      return jsonError('Only Kitta Audio Open API v1/v3 routes are allowed.', 404, headers);
    }

    const authorization = request.headers.get('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match || !constantTimeEqual(match[1], env.PROXY_ACCESS_TOKEN)) {
      return jsonError('Invalid proxy access token.', 401, headers);
    }

    const isFishRoute = incoming.pathname.startsWith('/fish/');
    const upstreamHeaders = new Headers();
    FORWARDED_REQUEST_HEADERS.forEach((name) => {
      const value = request.headers.get(name);
      if (value) upstreamHeaders.set(name, value);
    });

    let upstreamUrl;
    if (isFishRoute) {
      if (!env.FISH_API_KEY) {
        return jsonError('The server-side FISH_API_KEY secret is not configured. Run: npx wrangler secret put FISH_API_KEY', 503, headers);
      }
      const fishPath = incoming.pathname.slice('/fish'.length);
      const requestedModel = request.headers.get('X-Fish-Model');
      if (incoming.pathname === '/fish/v1/tts') {
        if (requestedModel && !FISH_MODELS.has(requestedModel)) {
          return jsonError('Unsupported Fish Audio model.', 400, headers);
        }
        upstreamHeaders.set('model', requestedModel || 's2.1-pro');
      } else if (requestedModel) {
        return jsonError('X-Fish-Model is only valid for Fish Audio TTS.', 400, headers);
      }
      upstreamHeaders.set('Authorization', 'Bearer ' + env.FISH_API_KEY);
      upstreamUrl = new URL(fishPath + incoming.search, FISH_API_HOST);
    } else {
      if (!env.KITTA_API_KEY) {
        return jsonError('The server-side KITTA_API_KEY secret is not configured.', 503, headers);
      }
      upstreamHeaders.set('Authorization', 'Bearer ' + env.KITTA_API_KEY);
      upstreamUrl = new URL(incoming.pathname + incoming.search, KITTA_API_HOST);
    }

    // The browser's PROXY_ACCESS_TOKEN is never forwarded to either provider.

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
