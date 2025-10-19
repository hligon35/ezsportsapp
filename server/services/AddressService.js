const { fetch } = require('undici');

class AddressService {
  constructor() {
    this.provider = (process.env.ADDRESS_VALIDATION_PROVIDER || 'none').toLowerCase();
    this.timeoutMs = Number(process.env.ADDRESS_VALIDATION_TIMEOUT_MS || 3000);
  }

  async validateAndNormalize(addr = {}) {
    const safe = (v) => (typeof v === 'string' ? v.trim() : '');
    const base = {
      address1: safe(addr.address1),
      address2: safe(addr.address2),
      city: safe(addr.city),
      state: safe(addr.state),
      postal: safe(addr.postal),
      country: (safe(addr.country) || 'US').toUpperCase(),
    };
    if (!base.address1 || !base.city || !base.state || !base.postal) {
      return { valid: false, address: base, reason: 'missing_fields' };
    }
    if (this.provider === 'smartystreets') return await this.#validateSmarty(base);
    if (this.provider === 'google') return await this.#validateGoogle(base);
    // provider=none: accept as-is
    return { valid: true, address: base, provider: 'none' };
  }

  async #withTimeout(promise) {
    const to = new Promise((_, rej) => setTimeout(() => rej(new Error('addr_validate_timeout')), this.timeoutMs));
    return Promise.race([promise, to]);
  }

  async #validateSmarty(base) {
    try {
      const authId = process.env.SMARTY_AUTH_ID || '';
      const authToken = process.env.SMARTY_AUTH_TOKEN || '';
      if (!authId || !authToken) return { valid: true, address: base, provider: 'smartystreets', reason: 'disabled_missing_keys' };
      const url = 'https://us-street.api.smarty.com/street-address?candidates=1';
      const body = [{ street: base.address1, secondary: base.address2 || undefined, city: base.city, state: base.state, zipcode: base.postal }];
      const resp = await this.#withTimeout(fetch(url + `&auth-id=${encodeURIComponent(authId)}&auth-token=${encodeURIComponent(authToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }));
      if (!resp.ok) return { valid: true, address: base, provider: 'smartystreets', reason: `http_${resp.status}` };
      const arr = await resp.json();
      const best = Array.isArray(arr) && arr[0];
      if (!best) return { valid: true, address: base, provider: 'smartystreets', reason: 'no_candidates' };
      const comp = best.components || {};
      const norm = {
        address1: [best.delivery_line_1, best.delivery_line_2].filter(Boolean).join(' '),
        address2: '',
        city: comp.city_name || base.city,
        state: comp.state_abbreviation || base.state,
        postal: [comp.zipcode, comp.plus4_code].filter(Boolean).join('-') || base.postal,
        country: 'US'
      };
      return { valid: true, address: norm, provider: 'smartystreets' };
    } catch (e) {
      return { valid: true, address: base, provider: 'smartystreets', reason: e.message };
    }
  }

  async #validateGoogle(base) {
    try {
      const key = process.env.GOOGLE_MAPS_API_KEY || '';
      if (!key) return { valid: true, address: base, provider: 'google', reason: 'disabled_missing_key' };
      // Use Address Validation API if enabled on the project; otherwise accept
      const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(key)}`;
      const payload = { address: { addressLines: [base.address1, base.address2].filter(Boolean), regionCode: base.country, locality: base.city, administrativeArea: base.state, postalCode: base.postal } };
      const resp = await this.#withTimeout(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
      if (!resp.ok) return { valid: true, address: base, provider: 'google', reason: `http_${resp.status}` };
      const data = await resp.json();
      const verdict = data.result?.verdict?.addressComplete === true;
      const postal = data.result?.address?.postalAddress || {};
      const norm = {
        address1: (postal.addressLines && postal.addressLines[0]) || base.address1,
        address2: (postal.addressLines && postal.addressLines[1]) || '',
        city: postal.locality || base.city,
        state: postal.administrativeArea || base.state,
        postal: postal.postalCode || base.postal,
        country: (postal.regionCode || base.country || 'US').toUpperCase()
      };
      return { valid: !!verdict, address: norm, provider: 'google' };
    } catch (e) {
      return { valid: true, address: base, provider: 'google', reason: e.message };
    }
  }
}

module.exports = AddressService;
