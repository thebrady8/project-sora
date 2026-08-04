process.env.GAMEVAULT_PERSISTENCE = 'JSON';
process.env.PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const serverModule = require('../server.js');

test('Sprint 4 authenticated insights and search endpoints respond', async (t) => {
  const server = serverModule.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const registration = await fetch(`${base}/api/register`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:`sprint4-${suffix}@example.com`, username:`sprint4${String(suffix).slice(-6)}`, password:'StrongPassword123!'}) });
  assert.equal(registration.status, 201);
  const auth = await registration.json();
  const headers = { authorization:`Bearer ${auth.token}`, 'content-type':'application/json' };
  const games = [{id:'halo-2',title:'Halo 2',platform:'Xbox',franchise:'Halo',status:'Completed',completionPercent:100},{id:'halo-3',title:'Halo 3',platform:'Xbox',franchise:'Halo',status:'Backlog',estimatedHours:10}];
  const save = await fetch(`${base}/api/library`, { method:'POST', headers, body:JSON.stringify({games}) });
  assert.equal(save.status, 200);
  const insights = await fetch(`${base}/api/library/insights?minutes=60`, { headers });
  assert.equal(insights.status, 200);
  const payload = await insights.json();
  assert.equal(payload.stats.total, 2);
  assert.equal(payload.franchises[0].total, 2);
  const search = await fetch(`${base}/api/library/search?q=halo&status=Completed`, { headers });
  assert.equal(search.status, 200);
  assert.equal((await search.json()).total, 1);
});
