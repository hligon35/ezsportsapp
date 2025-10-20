#!/usr/bin/env node
/*
 Quick QA smoke test for EZSports server.
 - Verifies /health
 - Verifies /api/config
 - Tries /api/products?limit=1
 - Optionally hits /api/analytics/track
 Usage: node server/scripts/smoke-test.js [baseUrl]
*/

const base = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4242';
const f = (typeof fetch === 'function') ? fetch : require('undici').fetch;

async function get(path, opts){
  const res = await f(base.replace(/\/$/, '') + path, opts);
  const text = await res.text();
  let data = null; try{ data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

(async () => {
  console.log('Smoke test base:', base);
  const health = await get('/health');
  console.log('health:', health.status, health.data || health.text);
  const cfg = await get('/api/config');
  console.log('config:', cfg.status, cfg.data || cfg.text);
  const products = await get('/api/products?limit=1');
  console.log('products:', products.status, Array.isArray(products.data)? products.data.length : products.text);
  const track = await get('/api/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/', ts: new Date().toISOString() }) });
  console.log('track:', track.status, track.data || track.text);
  const ok = health.ok && cfg.ok && products.ok && track.ok;
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('Smoke test failed:', e); process.exit(2); });
