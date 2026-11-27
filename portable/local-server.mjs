import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const API_ORIGIN = 'https://fishaudio.org';
const FISH_API_ORIGIN = 'https://api.fish.audio';
const FISH_MODELS = new Set(['s2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3', 's3-pro']);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_HEADERS = ['accept', 'content-type', 'idempotency-key', 'x-request-id', 'range', 'authorization', 'x-fish-model'];
const RESPONSE_HEADERS = ['content-type', 'content-disposition', 'x-request-id', 'x-openapi-quota-remaining', 'x-openapi-credits-used', 'x-openapi-ignored-parameters', 'retry-after'];
const MIME_TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.ico':'image/x-icon','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2'};
const DEFAULT_ROOT = path.dirname(fileURLToPath(import.meta.url));

function sendJson(response, status, message) {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify({error:message}));
}

function isLoopbackAddress(address) {
  const normalized = String(address || '').replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function isAllowedApiPath(pathname) {
  let decoded = pathname;
  try {
    for (let i=0;i<3;i+=1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch { return false; }
  if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) return false;
  return decoded === '/api/openapi.json' || decoded === '/fish/v1/tts' || decoded === '/fish/wallet/self/package' || /^\/api\/open\/(?:v1|v3)(?:\/|$)/.test(decoded);
}

function getLocalHost(request, server) {
  const host = String(request.headers.host || '').toLowerCase();
  const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(host);
  if (!match) return null;
  const activePort = server.address()?.port;
  if (!activePort || Number(match[2]) !== activePort) return null;
  return host;
}

function serveStatic(request, response, rootDir, pathname) {
  if (!['GET','HEAD'].includes(request.method || 'GET')) { sendJson(response,405,'Method not allowed.'); return; }
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { sendJson(response,400,'Invalid URL path.'); return; }
  if (decoded.includes('\0') || decoded.includes('\\')) { sendJson(response,400,'Invalid URL path.'); return; }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(rootDir, relative);
  const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (target !== rootDir && !target.startsWith(rootPrefix)) { sendJson(response,403,'Path is outside the application directory.'); return; }

  let filePath = target;
  try { if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath,'index.html'); }
  catch { sendJson(response,404,'File not found.'); return; }
  let stat;
  try { stat = fs.statSync(filePath); }
  catch { sendJson(response,404,'File not found.'); return; }
  if (!stat.isFile()) { sendJson(response,404,'File not found.'); return; }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { if (!response.headersSent) sendJson(response,500,'Unable to read the application file.'); else response.destroy(); });
  stream.pipe(response);
}

async function proxyApiRequest(request, response, url, upstreamFetch) {
  if (!ALLOWED_METHODS.has(request.method || '')) { sendJson(response,405,'HTTP method is not allowed.'); return; }
  if (!isAllowedApiPath(url.pathname)) { sendJson(response,404,'Only Kitta Audio Open API and approved Fish Audio routes are allowed.'); return; }
  const isFishRoute = url.pathname.startsWith('/fish/');
  const authorization = request.headers.authorization || '';
  if (!/^Bearer\s+\S{1,}$/i.test(authorization)) { sendJson(response,401,'Enter a valid Kitta Audio API key in the application.'); return; }

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    if (name === 'x-fish-model') continue;
    const value = request.headers[name];
    if (value) headers.set(name,value);
  }
  let upstreamUrl;
  if (isFishRoute) {
    const fishModel = request.headers['x-fish-model'];
    if (url.pathname === '/fish/v1/tts') {
      if (fishModel && !FISH_MODELS.has(fishModel)) { sendJson(response,400,'Unsupported Fish Audio model.'); return; }
      headers.set('model',fishModel || 's2.1-pro');
    } else if (fishModel) {
      sendJson(response,400,'X-Fish-Model is only valid for Fish Audio TTS.');
      return;
    }
    upstreamUrl = new URL(url.pathname.slice('/fish'.length) + url.search,FISH_API_ORIGIN).toString();
  } else {
    upstreamUrl = new URL(url.pathname + url.search,API_ORIGIN).toString();
  }
  const hasBody = !['GET','HEAD'].includes(request.method || '');
  const init = {method:request.method,headers,redirect:'follow'};
  if (hasBody) { init.body = Readable.toWeb(request); init.duplex = 'half'; }

  let upstream;
  try { upstream = await upstreamFetch(upstreamUrl,init); }
  catch { sendJson(response,502,'Unable to reach the Kitta Audio API. Check the internet connection and try again.'); return; }

  const responseHeaders = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status,responseHeaders);
  if (!upstream.body || request.method === 'HEAD') { response.end(); return; }
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error',() => response.destroy());
  response.on('close',() => { if (!response.writableEnded) stream.destroy(); });
  stream.pipe(response);
}

export function createLocalServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const upstreamFetch = options.fetchImpl || globalThis.fetch;
  if (typeof upstreamFetch !== 'function') throw new TypeError('A Fetch-compatible upstream function is required.');
  let server;
  server = http.createServer(async (request,response) => {
    try {
      if (!isLoopbackAddress(request.socket.remoteAddress)) { sendJson(response,403,'This local server accepts connections from this computer only.'); return; }
      const host = getLocalHost(request,server);
      if (!host) { sendJson(response,403,'Invalid local Host header.'); return; }
      const origin = request.headers.origin;
      if (origin && origin !== 'http://' + host) { sendJson(response,403,'Cross-origin requests are not allowed.'); return; }
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') { sendJson(response,403,'Cross-site requests are not allowed.'); return; }
      const url = new URL(request.url || '/','http://' + host);
      if (url.pathname === '/health') {
        response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        response.end(JSON.stringify({ok:true,service:'Audio Console Local API'}));
        return;
      }
      if (url.pathname.startsWith('/api/')) { await proxyApiRequest(request,response,url,upstreamFetch); return; }
      serveStatic(request,response,rootDir,url.pathname);
    } catch { sendJson(response,500,'The local server encountered an unexpected error.'); }
  });
  server.requestTimeout = 10*60*1000;
  server.headersTimeout = 65*1000;
  return server;
}

export async function listenOnAvailablePort(server, firstPort=4173, lastPort=4199) {
  for (let port=firstPort;port<=lastPort;port+=1) {
    try {
      await new Promise((resolve,reject) => {
        const onError = error => { server.removeListener('listening',onListening); reject(error); };
        const onListening = () => { server.removeListener('error',onError); resolve(); };
        server.once('error',onError);
        server.once('listening',onListening);
        server.listen(port,'127.0.0.1');
      });
      return port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('Ports 4173–4199 are busy. Close another local server and launch this program again.');
}

function openBrowser(url) {
  if (process.platform !== 'win32') { console.log('Open this address in your browser: ' + url); return; }
  const child = spawn('cmd.exe',['/d','/s','/c','start "" "' + url + '"'],{detached:true,stdio:'ignore',windowsHide:true});
  child.unref();
}

async function start() {
  const server = createLocalServer();
  const port = await listenOnAvailablePort(server);
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('');
  console.log('Audio Console is running.');
  console.log('Local address: ' + url);
  console.log('This server is available only on this computer.');
  console.log('Press Ctrl+C in this window to stop it.');
  console.log('');
  openBrowser(url);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  start().catch(error => { console.error('Unable to start the local server: ' + error.message); process.exitCode = 1; });
}
