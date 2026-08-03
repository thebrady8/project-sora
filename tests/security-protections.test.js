const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

function waitForServer(url, timeoutMs = 5000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server did not start at ${url}`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };

    attempt();
  });
}

async function main() {
  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '3101' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  serverProcess.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForServer('http://127.0.0.1:3101/');

    const rootResponse = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3101/', (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
    });

    assert.equal(rootResponse.statusCode, 200);
    assert.equal(rootResponse.headers['x-content-type-options'], 'nosniff');
    assert.equal(rootResponse.headers['x-frame-options'], 'DENY');
    assert.equal(rootResponse.headers['referrer-policy'], 'no-referrer');
    assert.match(rootResponse.headers['content-security-policy'] || '', /default-src 'self'/);

    const loginAttempts = [];
    for (let index = 0; index < 7; index += 1) {
      loginAttempts.push(new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 3101,
          path: '/api/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(0));
        req.write(JSON.stringify({ email: 'wrong@example.com', password: 'bad' }));
        req.end();
      }));
    }

    const statuses = await Promise.all(loginAttempts);
    assert.ok(statuses.includes(429), `Expected a rate limit response, got ${statuses.join(', ')}`);
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('Security protections test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
