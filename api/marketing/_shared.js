// Shared utilities for marketing proxy endpoints
const TARGET = 'https://script.google.com/macros/s/AKfycbxPYA7ns--_RcaagFSzZzNs00vBneiV9Ws46NHaCVWCeyDBmy7tpMLmCvEsUzxrqwt2/exec';

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  });
}

async function forward(bodyObj) {
  // Forward as text/plain to match current Apps Script parsing fallback.
  const res = await fetch(TARGET, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(bodyObj || {})
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok && !data.ok) {
    return jsonResponse({ ok: false, error: 'Upstream error', upstreamStatus: res.status }, 502);
  }
  return jsonResponse(data);
}

export { jsonResponse, forward };