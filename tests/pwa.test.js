const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createServer, getServerPort, getServerHost } = require('../server');

function requestText(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

test('uses environment-based port and host defaults', () => {
  process.env.PORT = '4101';
  process.env.HOST = '0.0.0.0';
  assert.equal(getServerPort(), 4101);
  assert.equal(getServerHost(), '0.0.0.0');
  delete process.env.PORT;
  delete process.env.HOST;
});

test('serves the frontend from public assets and supports direct-route refreshes', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const assetResponse = await requestText(`http://127.0.0.1:${address.port}/styles.css`);
    const routeResponse = await requestText(`http://127.0.0.1:${address.port}/discover/next`);

    assert.equal(assetResponse.statusCode, 200);
    assert.match(assetResponse.body, /body/);
    assert.equal(routeResponse.statusCode, 200);
    assert.match(routeResponse.body, /Project Sora/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('blocks private files and server source from public serving', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const sourceResponse = await requestText(`http://127.0.0.1:${address.port}/server.js`);
    const envResponse = await requestText(`http://127.0.0.1:${address.port}/.env`);
    assert.equal(sourceResponse.statusCode, 403);
    assert.equal(envResponse.statusCode, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves the web app manifest with a manifest MIME type', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await requestText(`http://127.0.0.1:${address.port}/manifest.webmanifest`);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] || '', /manifest/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('manifest and service worker describe the installable PWA surface', () => {
  const manifestPath = path.join(__dirname, '..', 'public', 'manifest.webmanifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const swScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.equal(manifest.name, 'Project Sora');
  assert.equal(manifest.short_name, 'Sora');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.theme_color, '#0f172a');
  assert.equal(manifest.background_color, '#020617');
  assert.equal(manifest.id, 'project-sora');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.match(indexHtml, /<link rel="manifest"/i);
  assert.match(indexHtml, /apple-touch-icon/i);
  assert.match(indexHtml, /theme-color/i);
  assert.match(appJs, /beforeinstallprompt/i);
  assert.match(appJs, /appinstalled/i);
  assert.match(swScript, /CACHE_NAME/i);
  assert.match(swScript, /\/api\//i);
  assert.match(swScript, /postMessage/i);
  assert.match(swScript, /searchParams\.has\('auth'\)/i);
  assert.match(stylesCss, /overflow-x:\s*hidden/i);
  assert.match(stylesCss, /safe-area-inset/i);
});
