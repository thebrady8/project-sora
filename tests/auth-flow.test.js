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

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function main() {
  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '3104' },
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
    await waitForServer('http://127.0.0.1:3104/');

    const uniqueEmail = `auth-flow-${Date.now()}@example.com`;
    const registerResponse = await postJson('http://127.0.0.1:3104/api/register', {
      email: uniqueEmail,
      password: 'secret123'
    });

    assert.equal(registerResponse.statusCode, 201, `Expected registration success, got ${registerResponse.body}`);

    const loginResponse = await postJson('http://127.0.0.1:3104/api/login', {
      email: uniqueEmail,
      password: 'secret123'
    });

    assert.equal(loginResponse.statusCode, 200, `Expected login success, got ${loginResponse.body}`);
    const loginPayload = JSON.parse(loginResponse.body);
    assert.ok(loginPayload.token, 'Login should return a token');
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('Authentication flow regression test passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
