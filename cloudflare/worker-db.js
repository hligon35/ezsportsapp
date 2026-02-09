// Cloudflare Worker: JSON-collection DB backed by D1
// Provides a tiny HTTP API used by the Node server in production.

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function getBearerToken(req) {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isAuthorized(req, env) {
  const required = (env.CF_DB_API_KEY || '').trim();
  if (!required) return true;
  const provided = getBearerToken(req) || (req.headers.get('X-API-Key') || '').trim();
  return provided && provided === required;
}

function defaultAutoIncrementStart(collection) {
  const defaults = {
    users: 1000,
    products: 2000,
    orders: 3000,
    analytics: 1,
    subscribers: 1,
    coupons: 1,
    emails: 1,
    payouts: 1,
    errors: 1
  };
  return defaults[collection] || 1;
}

async function getCollection(env, name) {
  const row = await env.DB.prepare('SELECT data FROM collections WHERE name = ?')
    .bind(name)
    .first();
  if (!row) return [];
  try {
    return JSON.parse(row.data);
  } catch {
    return [];
  }
}

async function setCollection(env, name, data) {
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO collections (name, data, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  )
    .bind(name, JSON.stringify(data), updatedAt)
    .run();
}

async function updateSchemaLastModified(env) {
  const now = new Date().toISOString();
  const raw = await getCollection(env, 'schema');
  const schema = !raw || typeof raw !== 'object' || Array.isArray(raw) ? { metadata: {} } : raw;
  schema.metadata = schema.metadata || {};
  schema.metadata.lastModified = now;
  await setCollection(env, 'schema', schema);
}

async function getMetaNumber(env, key) {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  if (!row) return null;
  const num = Number(row.value);
  return Number.isFinite(num) ? num : null;
}

async function setMetaNumber(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, String(value))
    .run();
}

function matchesCriteria(item, criteria) {
  return Object.keys(criteria).every((key) => {
    const c = criteria[key];
    if (c && typeof c === 'object' && c.$regex) {
      const regex = new RegExp(c.$regex, c.$options || '');
      return regex.test(item?.[key]);
    }
    return item?.[key] === c;
  });
}

async function nextId(env, collection) {
  const metaKey = `autoIncrement:${collection}`;
  let stored = await getMetaNumber(env, metaKey);
  if (!Number.isFinite(stored)) stored = defaultAutoIncrementStart(collection);

  let maxExisting = 0;
  if (collection !== 'schema' && collection !== 'products') {
    const existing = await getCollection(env, collection);
    if (Array.isArray(existing)) {
      for (const rec of existing) {
        const idNum = Number(rec?.id);
        if (Number.isFinite(idNum)) maxExisting = Math.max(maxExisting, idNum);
      }
    }
  }

  const nextVal = Math.max(stored, maxExisting) + 1;
  await setMetaNumber(env, metaKey, nextVal);

  // Keep schema metadata in sync (best-effort)
  try {
    const rawSchema = await getCollection(env, 'schema');
    const schema = !rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema) ? { metadata: {} } : rawSchema;
    schema.metadata = schema.metadata || {};
    schema.metadata.autoIncrement = schema.metadata.autoIncrement || {};
    schema.metadata.autoIncrement[collection] = nextVal;
    await setCollection(env, 'schema', schema);
  } catch {
    // ignore
  }

  return nextVal;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;

    // Health
    if (pathname === '/health') return textResponse('ok');

    if (!isAuthorized(req, env)) {
      return textResponse('Unauthorized', 401);
    }

    const parts = pathname.split('/').filter(Boolean);

    // POST /initialize
    if (req.method === 'POST' && pathname === '/initialize') {
      // Ensure schema exists (optional)
      const rawSchema = await getCollection(env, 'schema');
      if (!rawSchema || Array.isArray(rawSchema) || typeof rawSchema !== 'object') {
        await setCollection(env, 'schema', {
          metadata: {
            version: '1.0.0',
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            autoIncrement: {}
          }
        });
      }
      return jsonResponse({ ok: true });
    }

    if (parts[0] !== 'collections' || !parts[1]) {
      return textResponse('Not found', 404);
    }

    const collection = decodeURIComponent(parts[1]);

    // GET /collections/:name
    if (req.method === 'GET' && parts.length === 2) {
      const data = await getCollection(env, collection);
      return jsonResponse(data);
    }

    // PUT /collections/:name  { data }
    if (req.method === 'PUT' && parts.length === 2) {
      const payload = await req.json().catch(() => ({}));
      await setCollection(env, collection, payload.data);
      await updateSchemaLastModified(env);
      return jsonResponse({ ok: true });
    }

    // POST /collections/:name/next-id
    if (req.method === 'POST' && parts[2] === 'next-id') {
      const nextVal = await nextId(env, collection);
      return jsonResponse({ nextId: nextVal });
    }

    // POST /collections/:name/find  { criteria }
    if (req.method === 'POST' && parts[2] === 'find') {
      const payload = await req.json().catch(() => ({}));
      const criteria = payload.criteria || {};
      const data = await getCollection(env, collection);
      if (!criteria || Object.keys(criteria).length === 0) return jsonResponse(data);
      if (!Array.isArray(data)) return jsonResponse([]);
      return jsonResponse(data.filter((item) => matchesCriteria(item, criteria)));
    }

    // POST /collections/:name/insert  { data }
    if (req.method === 'POST' && parts[2] === 'insert') {
      const payload = await req.json().catch(() => ({}));
      const record = payload.data || {};

      const data = await getCollection(env, collection);
      const records = Array.isArray(data) ? data : [];

      const now = new Date().toISOString();
      record.createdAt = record.createdAt || now;
      if (collection !== 'schema') record.updatedAt = now;

      if (!record.id) {
        if (collection === 'products') {
          record.id = `prod-${await nextId(env, collection)}`;
        } else {
          record.id = await nextId(env, collection);
        }
      }

      records.push(record);
      await setCollection(env, collection, records);
      await updateSchemaLastModified(env);
      return jsonResponse({ record });
    }

    // POST /collections/:name/update  { criteria, updateData }
    if (req.method === 'POST' && parts[2] === 'update') {
      const payload = await req.json().catch(() => ({}));
      const criteria = payload.criteria || {};
      const updateData = payload.updateData || {};

      const data = await getCollection(env, collection);
      const records = Array.isArray(data) ? data : [];

      let updated = false;
      const now = new Date().toISOString();

      const updatedRecords = records.map((rec) => {
        if (matchesCriteria(rec, criteria)) {
          updated = true;
          return { ...rec, ...updateData, updatedAt: now };
        }
        return rec;
      });

      if (updated) {
        await setCollection(env, collection, updatedRecords);
        await updateSchemaLastModified(env);
      }

      return jsonResponse({ updated });
    }

    // POST /collections/:name/delete  { criteria }
    if (req.method === 'POST' && parts[2] === 'delete') {
      const payload = await req.json().catch(() => ({}));
      const criteria = payload.criteria || {};

      const data = await getCollection(env, collection);
      const records = Array.isArray(data) ? data : [];

      const filtered = records.filter((rec) => !matchesCriteria(rec, criteria));
      const deletedCount = records.length - filtered.length;

      if (deletedCount > 0) {
        await setCollection(env, collection, filtered);
        await updateSchemaLastModified(env);
      }

      return jsonResponse({ deletedCount });
    }

    return textResponse('Not found', 404);
  }
};
