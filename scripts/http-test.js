#!/usr/bin/env node
/*
 Simple HTTP test script for posting JSON to the app endpoints.
 Usage:
   node scripts/http-test.js POST https://example.com/api/marketing/subscribe '{"email":"demo@example.com","source":"http-test"}'
*/

async function main() {
  const argv = process.argv.slice(2);
  const method = (argv[0] || 'GET').toUpperCase();
  const url = argv[1];
  const raw = argv.slice(2);
  if (!url) {
    console.error('Usage: node scripts/http-test.js METHOD URL JSON');
    process.exit(1);
  }
  let body = undefined;
  let headers = {};
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    // Use text/plain for marketing endpoints to leverage server-side tolerant parser
    const isMarketing = /\/api\/marketing\//.test(url);
    headers['Content-Type'] = isMarketing ? 'text/plain' : 'application/json';
    // Accept either a JSON string or key=value pairs
    let jsonStr = null;
    if (raw.length === 0) {
      jsonStr = '{}';
    } else if (raw.length === 1 && /^{/.test(raw[0])) {
      // Looks like JSON
      jsonStr = raw[0];
    } else {
      // Parse k=v pairs into an object
      const obj = {};
      for (const tok of raw) {
        const idx = tok.indexOf('=');
        if (idx === -1) continue;
        const k = tok.slice(0, idx);
        const v = tok.slice(idx + 1);
        obj[k] = v;
      }
      jsonStr = JSON.stringify(obj);
    }
    // Normalize quotes if the shell left surrounding quotes
    if ((jsonStr.startsWith("'") && jsonStr.endsWith("'")) || (jsonStr.startsWith('"') && jsonStr.endsWith('"'))) {
      jsonStr = jsonStr.slice(1, -1);
    }
    try { body = JSON.stringify(JSON.parse(jsonStr)); }
    catch { body = jsonStr; }
  }
  console.log('Request method:', method);
  console.log('Request url:', url);
  if (body !== undefined) {
    console.log('Request headers:', headers);
    console.log('Request body:', body);
  }
  const res = await fetch(url, { method, headers, body }).catch(err => ({ ok: false, status: 0, text: async () => String(err.message), headers: { get: () => '' } }));
  const text = await res.text();
  const ct = res.headers?.get?.('content-type') || '';
  let obj = null;
  if (ct.includes('application/json')) {
    try { obj = JSON.parse(text); } catch {}
  }
  console.log('Status:', res.status);
  console.log('OK:', res.ok);
  if (obj) {
    console.log('JSON:', JSON.stringify(obj, null, 2));
  } else {
    console.log('Body:', text);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
