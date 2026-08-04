import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('add game form includes barcode, scanner, title suggestions, and MSRP', () => {
  assert.match(html, /id="barcodeInput"/);
  assert.match(html, /id="scanBarcodeButton"/);
  assert.match(html, /id="msrpInput"/);
  assert.match(html, /id="titleSuggestions"/);
});

test('frontend uses BarcodeDetector with manual fallback and saves barcode/MSRP', () => {
  assert.match(app, /BarcodeDetector/);
  assert.match(app, /lookupBarcode/);
  assert.match(app, /msrp: Number\(formData\.get\('msrp'\)/);
  assert.match(app, /barcode: String\(formData\.get\('barcode'\)/);
});

test('server exposes catalog-backed barcode lookup', () => {
  assert.match(server, /\/api\/games\/barcode/);
  assert.match(server, /entry\.barcodes/);
});
