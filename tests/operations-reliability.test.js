const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer, redactForLogging, handleServerError, createShutdownController } = require('../server');

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : {} });
        } catch (error) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function startTestServer() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

test('redacts sensitive values before logging', () => {
  const payload = {
    password: 'super-secret',
    token: 'abc123',
    email: 'player@example.com',
    privateNote: 'do not log',
    nested: { note: 'also private' }
  };

  const redacted = redactForLogging(payload);

  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.token, '[REDACTED]');
  assert.equal(redacted.email, '[REDACTED]');
  assert.equal(redacted.privateNote, '[REDACTED]');
  assert.equal(redacted.nested.note, '[REDACTED]');
  assert.ok(!JSON.stringify(redacted).includes('player@example.com'));
});

test('health endpoints expose safe status information', async () => {
  const { server, port } = await startTestServer();

  try {
    const health = await requestJson(`http://127.0.0.1:${port}/health`);
    const ready = await requestJson(`http://127.0.0.1:${port}/ready`);

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.service, 'project-sora');
    assert.ok(Number.isFinite(health.body.uptimeMs));
    assert.ok(!Object.prototype.hasOwnProperty.call(health.body, 'port'));

    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.status, 'ready');
    assert.ok(!Object.prototype.hasOwnProperty.call(ready.body, 'databasePath'));
  } finally {
    await stopTestServer(server);
  }
});

test('centralized error handling returns safe public messages', () => {
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(payload) {
      this.payload = payload;
    }
  };
  const request = {
    method: 'GET',
    url: '/api/boom',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
  };

  handleServerError(request, response, new Error('Internal failure with password secret and email player@example.com'), 'req-123');

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['x-request-id'], 'req-123');
  assert.equal(JSON.parse(response.payload).error, 'Internal Server Error');
  assert.ok(!response.payload.includes('player@example.com'));
});

test('shutdown controller closes the server gracefully', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  let exited = false;
  const shutdown = createShutdownController(server, {
    exit: () => {
      exited = true;
    },
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  shutdown('SIGTERM');

  await new Promise((resolve) => server.once('close', resolve));
  assert.equal(exited, true);
});
