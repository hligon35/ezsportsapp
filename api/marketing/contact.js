import { jsonResponse, forward } from './_shared.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }
  let body = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch { body = {}; }
  body.type = 'contact';
  return forward(body);
}