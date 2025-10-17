// ShippingService: optional rate estimation scaffold.
// Currently returns null unless enabled and fully configured.
// Integrations can be added for providers like EasyPost or Shippo using their REST APIs.

class ShippingService {
  constructor() {
    this.enabled = String(process.env.SHIPPING_PROVIDER_ENABLED || 'false').toLowerCase() === 'true';
    this.provider = (process.env.SHIPPING_PROVIDER || 'none').toLowerCase();
  }

  // items: [{ id, qty }], address: { address1, address2, city, state, postal, country }
  // Returns { cents: number, provider?: string } or null to keep default logic
  async estimate(items = [], address = {}) {
    if (!this.enabled) return null;
    if (this.provider === 'none') return null;
    try {
      // Placeholder: without weight/dimensions per SKU, external rates are unreliable.
      // Keep custom per-item shipping unless you enrich product data with shipping dimensions.
      return null;
    } catch {
      return null;
    }
  }
}

module.exports = ShippingService;
