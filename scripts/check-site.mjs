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
for (const required of ['view-studio', 'view-voices', 'view-media', 'view-jobs', 'view-explorer', 'api-key', 'proxy-url', 'generate-tts']) {
  if (!ids.includes(required)) throw new Error('Missing required interface element: ' + required);
}
if (!html.includes('Content-Security-Policy')) throw new Error('Content Security Policy meta tag is required.');
if (!js.includes("const API_ORIGIN = 'https://fishaudio.org'")) throw new Error('The API origin must remain pinned to the official API host.');
if (/localStorage|sessionStorage|document\.cookie/.test(js)) throw new Error('Do not persist API credentials in browser storage.');
if (!js.includes("Authorization")) throw new Error('Bearer authentication handling is missing.');
if (!js.includes("apiRequest('/api/openapi.json'") || !js.includes("apiRequest(API_V3 + '/openapi.json'")) {
  throw new Error('API Explorer must load both the v1 and v3 OpenAPI contracts.');
}
if (!css.includes('.app-shell') || !css.includes('@media')) throw new Error('Responsive application styles are missing.');
if (!fs.existsSync(path.join(root, 'worker/index.js'))) throw new Error('Secure proxy template is missing.');
console.log('Site validation passed: ' + ids.length + ' unique ids; assets, CSP, fixed API host and credential-storage checks are valid.');
