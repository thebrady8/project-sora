import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const html=fs.readFileSync('public/index.html','utf8'),app=fs.readFileSync('public/app.js','utf8'),css=fs.readFileSync('public/styles.css','utf8'),sw=fs.readFileSync('public/sw.js','utf8');
test('main landmark has one focus target',()=>{assert.match(html,/<main id="mainContent" tabindex="-1" class="content-area">/);assert.doesNotMatch(html,/tabindex="-1" class="content-area" tabindex/)});
test('dynamic discovery regions expose busy state',()=>{assert.match(app,/setAttribute\('aria-busy','true'\)/);assert.match(app,/removeAttribute\('aria-busy'\)/)});
test('mobile, contrast and reduced data styles exist',()=>{assert.match(css,/prefers-contrast: more/);assert.match(css,/max-width:420px/);assert.match(css,/prefers-reduced-data: reduce/)});
test('service worker cache is versioned for completed sprint',()=>assert.match(sw,/project-sora-sprint4-v1/));
