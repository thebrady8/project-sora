import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
for (const name of ['ownershipStatus','mediaType','purchaseDate','playtimeHours','personalRating','estimatedHours','franchise','genre','replayStatus','favorite']) assert.match(html,new RegExp(`name="${name}"`));
assert.match(app,/ownershipStatus: String\(formData\.get\('ownershipStatus'\)/);
assert.match(app,/playtimeMinutes: Math\.round/);
console.log('Sprint 4 form fields passed');
