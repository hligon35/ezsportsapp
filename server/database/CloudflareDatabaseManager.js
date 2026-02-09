// Cloudflare-backed DB driver (via a Cloudflare Worker + D1)
// Exposes the same API surface as DatabaseManager, so services don’t need changes.

class CloudflareDatabaseManager {
  constructor(options = {}) {
    this.driver = 'cloudflare';
    this.baseUrl =
      options.baseUrl ||
      process.env.EZ_CF_DB_URL ||
      process.env.CF_DB_URL ||
      '';
    this.apiKey =
      options.apiKey ||
      process.env.EZ_CF_DB_API_KEY ||
      process.env.CF_DB_API_KEY ||
      '';

    if (!this.baseUrl) {
      throw new Error(
        'Cloudflare DB driver requires EZ_CF_DB_URL (or CF_DB_URL)'
      );
    }
  }

  async #request(endpointPath, { method = 'GET', body } = {}) {
    const url = this.baseUrl.replace(/\/$/, '') + endpointPath;
    const headers = { 'Content-Type': 'application/json' };

    // API key is optional for local dev; Worker can be configured without auth.
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await resp.text();
    if (!resp.ok) {
      const message = text || resp.statusText;
      throw new Error(`Cloudflare DB error (${resp.status}): ${message}`);
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async findAll(collection) {
    return this.read(collection);
  }

  async read(collection) {
    return this.#request(`/collections/${encodeURIComponent(collection)}`);
  }

  async write(collection, data) {
    await this.#request(`/collections/${encodeURIComponent(collection)}`, {
      method: 'PUT',
      body: { data }
    });
    return true;
  }

  async getNextId(collection) {
    const res = await this.#request(
      `/collections/${encodeURIComponent(collection)}/next-id`,
      { method: 'POST' }
    );
    return res?.nextId;
  }

  async find(collection, criteria = {}) {
    if (!criteria || Object.keys(criteria).length === 0) {
      return this.read(collection);
    }

    const res = await this.#request(
      `/collections/${encodeURIComponent(collection)}/find`,
      { method: 'POST', body: { criteria } }
    );
    return Array.isArray(res) ? res : [];
  }

  async findOne(collection, criteria) {
    const results = await this.find(collection, criteria);
    return results.length > 0 ? results[0] : null;
  }

  async insert(collection, data) {
    const res = await this.#request(
      `/collections/${encodeURIComponent(collection)}/insert`,
      { method: 'POST', body: { data } }
    );
    return res?.record;
  }

  async update(collection, criteria, updateData) {
    const res = await this.#request(
      `/collections/${encodeURIComponent(collection)}/update`,
      { method: 'POST', body: { criteria, updateData } }
    );
    return !!res?.updated;
  }

  async delete(collection, criteria) {
    const res = await this.#request(
      `/collections/${encodeURIComponent(collection)}/delete`,
      { method: 'POST', body: { criteria } }
    );
    return Number(res?.deletedCount || 0);
  }

  async initialize() {
    await this.#request('/initialize', { method: 'POST' });
    return true;
  }

  async backup() {
    // Cloudflare D1 backups are handled via Cloudflare tooling.
    return null;
  }
}

module.exports = CloudflareDatabaseManager;
