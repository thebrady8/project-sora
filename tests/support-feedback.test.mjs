import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');

assert.ok(html.includes('id="supportDialog"'));
assert.ok(html.includes('/assets/project-sora-mobile-qr.png'));
assert.ok(html.includes('id="feedbackForm"'));
assert.ok(html.includes('Add to Home Screen'));
assert.ok(html.includes('Install app'));
assert.ok(app.includes("apiRequest('/api/feedback'"));
assert.ok(app.includes('function openSupportDialog()'));
assert.ok(css.includes('.support-dialog'));
assert.ok(server.includes("url.pathname === '/api/feedback'"));
assert.ok(server.includes("const FEEDBACK_FILE"));
assert.match(sw, /const CACHE_VERSION = 'project-sora-[^']+-v\d+';/);
assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'project-sora-mobile-qr.png')));
console.log('Support, QR, install help, and feedback regression test passed');
