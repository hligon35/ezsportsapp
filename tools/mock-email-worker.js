/*
  Minimal local mock for the Cloudflare Email Worker endpoint.

  - Accepts POST / (or any path)
  - Returns 200 { ok:true }
  - Writes each request payload to tools/mock-email-worker.ndjson

  Usage:
    node tools/mock-email-worker.js

  Env:
    PORT (default 8788)
*/

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 8788);
const logPath = path.join(__dirname, 'mock-email-worker.ndjson');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      return;
    }

    const bodyStr = await readBody(req);
    let json = null;
    try { json = bodyStr ? JSON.parse(bodyStr) : null; } catch { json = { raw: bodyStr }; }

    const record = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: {
        'content-type': req.headers['content-type'],
        authorization: req.headers['authorization'] ? '(present)' : undefined
      },
      payload: json
    };

    try {
      fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
    } catch {
      // ignore logging failures
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message || 'error' }));
  }
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-email-worker] listening on http://127.0.0.1:${port}/ -> ${logPath}`);
});
