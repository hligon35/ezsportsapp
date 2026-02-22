// Order Service - Handle order operations
const DatabaseManager = require('../database/DatabaseManager');
const ProductService = require('./ProductService');
const path = require('path');
const fs = require('fs').promises;

class OrderService {
  constructor() {
    this.db = new DatabaseManager();
    this.productService = new ProductService();
  }

  _parseCatalogPrice(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const s = String(value).trim();
    if (!s) return 0;
    // Support catalog encodings like "2/ft", "1.5/ft", "$2.50/ft"
    const m = s.match(/(-?\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : 0;
  }

  _parseByFootFeet(size) {
    const s = String(size || '').trim();
    if (!s) return null;
    let m = s.match(/\bby\s*the\s*f(?:oot|t)\s*:\s*(\d+)\s*['′]?\b/i);
    if (m && m[1]) {
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    m = s.match(/\b(\d+)\s*(?:ft|feet)\b/i);
    if (m && m[1]) {
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    return null;
  }

  _normalizeDisplayName(name, { color, size } = {}) {
    const raw = String(name || '').trim();
    if (!raw) return raw;

    let out = raw;

    // Common catalog suffixes that should not appear on receipts when we show variants separately.
    out = out.replace(/\s*[-–—]\s*all\s+colors\s*$/i, '');
    out = out.replace(/\s*\(\s*all\s+colors\s*\)\s*$/i, '');
    out = out.replace(/\s*[-–—]\s*all\s+sizes\s*$/i, '');
    out = out.replace(/\s*\(\s*all\s+sizes\s*\)\s*$/i, '');

    const c = String(color || '').trim();
    if (c) {
      const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\s*[-–—]\\s*${esc}\\s*$`, 'i'), '');
      out = out.replace(new RegExp(`\\s*\\(\\s*${esc}\\s*\\)\\s*$`, 'i'), '');
    }

    const s = String(size || '').trim();
    if (s) {
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\s*[-–—]\\s*${esc}\\s*$`, 'i'), '');
      out = out.replace(new RegExp(`\\s*\\(\\s*${esc}\\s*\\)\\s*$`, 'i'), '');
    }

    out = out.trim();
    return out || raw;
  }

  // Load fallback catalog (assets/prodList.json) and build a quick lookup by SKU/id
  async _loadFallbackCatalogMap() {
    try {
      const file = path.join(__dirname, '..', '..', 'assets', 'prodList.json');
      const raw = await fs.readFile(file, 'utf8');
      const json = JSON.parse(raw);
      const out = new Map();
      if (json && json.categories && typeof json.categories === 'object') {
        for (const arr of Object.values(json.categories)) {
          if (!Array.isArray(arr)) continue;
          arr.forEach(p => {
            const id = String(p.sku || p.id || p.name || '').trim();
            if (!id) return;
            const name = String(p.name || p.title || id);
            const price = this._parseCatalogPrice(p.map ?? p.price ?? p.wholesale ?? 0);
            out.set(id, { name, price });
          });
        }
      }
      return out;
    } catch {
      return new Map();
    }
  }

  // Create a new order
  async createOrder(orderData) {
    try {
      // Dropship model: skip stock availability validation

      // Preload fallback map once in case some SKUs aren't seeded in DB yet
      const fbMap = await this._loadFallbackCatalogMap();

      // Calculate total
      let itemsSubtotal = 0;
      let shippingFromItems = 0;
      let weightLbsFromItems = 0;
      const enrichedItems = [];

      for (const item of orderData.items) {
        const qty = Math.max(1, Number(item.qty ?? item.quantity) || 1);
        let product = null;
        try { product = await this.productService.getProductById(item.id); } catch {}

        const clientName = String(item.name || '').trim();
        const byFootFeet = this._parseByFootFeet(item.size);
        const selectedOptionRaw = (item.option ?? item.variationOption ?? item.variation ?? item.variant ?? item.style ?? item.type ?? item.size);
        const selectedOption = (selectedOptionRaw !== undefined && selectedOptionRaw !== null) ? String(selectedOptionRaw).trim() : '';

        // Fallback lookup when product is not found in DB
        let price = 0;
        let productName = '';
        if (product) {
          price = Number(product.price || 0) || 0;
          productName = product.name || String(item.id);

          // If product has variations with explicit MAP pricing, choose the matching option.
          // Note: the front-end encodes the chosen option into `size` for most variation products.
          const variations = Array.isArray(product.variations) ? product.variations : [];
          const isByFoot = Number.isFinite(byFootFeet) && byFootFeet && byFootFeet > 0;
          if (variations.length && !isByFoot) {
            const opt = String(selectedOption || '').trim();
            const optLc = opt.toLowerCase();
            const optOf = (v) => String(v?.option || v?.name || v?.value || '').trim();
            let matched = null;
            if (optLc) {
              matched = variations.find(v => optOf(v).toLowerCase() === optLc) || null;
            }
            if (!matched && variations.length === 1) matched = variations[0];
            if (!matched) matched = variations.find(v => optOf(v).toLowerCase() === 'standard') || null;

            if (matched) {
              const vMap = this._parseCatalogPrice(matched.map ?? matched.price ?? matched.MAP ?? null);
              if (Number.isFinite(vMap) && vMap > 0) price = vMap;
            }
          }
        } else {
          const fb = fbMap.get(String(item.id));
          if (fb) {
            price = Number(fb.price || 0) || 0;
            productName = fb.name || String(item.id);
          } else {
            // Last resort: honor client-provided unit price if present so the order record is useful
            const unit = Number(item.price || 0);
            price = Number.isFinite(unit) && unit > 0 ? unit : 0;
            productName = clientName || String(item.id);
          }
        }

        // Prefer client-provided display name for dynamic products (e.g., netting calculator),
        // but keep catalog/DB names authoritative when we have a product record.
        if (!product && clientName) productName = clientName;

        // By-the-foot items store the chosen feet in the size field; price is per-foot in catalog.
        // Keep qty as-is (front-end uses qty=1 for these) and multiply unit price accordingly.
        if (Number.isFinite(price) && price > 0 && Number.isFinite(byFootFeet) && byFootFeet && byFootFeet > 0) {
          price = price * Math.floor(byFootFeet);
        }

        // Clean up name for receipts/emails (variants are rendered separately)
        productName = this._normalizeDisplayName(productName, { color: item.color, size: item.size });

        const itemTotal = price * qty;
        itemsSubtotal += itemTotal;

        // Optional: item-level shipping values can be provided by the client
        const shipVal = Number(item.ship || 0);
        if (Number.isFinite(shipVal) && shipVal > 0) shippingFromItems += shipVal;

        // Optional: persist weight fields (lbs) when provided by client
        const qtyForWeight = qty;
        const wEachRaw = Number(item.weightLbsEach ?? item.weightEach ?? item.weight);
        const wTotalRaw = Number(item.weightLbsTotal ?? item.weightLbs ?? item.weightTotal);
        let weightLbsEach = (Number.isFinite(wEachRaw) && wEachRaw > 0) ? wEachRaw : undefined;
        let weightLbsTotal = (Number.isFinite(wTotalRaw) && wTotalRaw > 0) ? wTotalRaw : undefined;
        if (weightLbsEach === undefined && weightLbsTotal !== undefined && qtyForWeight > 0) {
          weightLbsEach = weightLbsTotal / qtyForWeight;
        }
        if (weightLbsTotal === undefined && weightLbsEach !== undefined) {
          weightLbsTotal = weightLbsEach * qtyForWeight;
        }
        if (Number.isFinite(weightLbsTotal) && weightLbsTotal > 0) weightLbsFromItems += weightLbsTotal;

        enrichedItems.push({
          productId: item.id,
          productName,
          price,
          quantity: qty,
          subtotal: itemTotal,
          // Optional: store per-line shipping provided by client for future detailed invoices
          ship: Number(item.ship || 0) || undefined,
          // Optional: weight data (lbs)
          weightLbsEach,
          weightLbsTotal,
          // Optional: persist variation details for confirmation/email
          size: (item.size !== undefined && item.size !== null) ? String(item.size) : undefined,
          option: selectedOption || undefined,
          color: (item.color !== undefined && item.color !== null) ? String(item.color) : undefined,
          category: (item.category !== undefined && item.category !== null) ? String(item.category) : undefined
        });
      }

      const providedSubtotal = Number.isFinite(orderData.subtotal) ? Number(orderData.subtotal) : null;
      const providedShipping = Number.isFinite(orderData.shipping) ? Number(orderData.shipping) : null;
      const providedDiscount = Number.isFinite(orderData.discount) ? Number(orderData.discount) : null;
      const hasTaxProp = Object.prototype.hasOwnProperty.call(orderData || {}, 'tax');
      const providedTax = hasTaxProp
        ? ((orderData.tax === null) ? null : (Number.isFinite(orderData.tax) ? Number(orderData.tax) : 0))
        : 0;

      const subtotal = providedSubtotal !== null ? providedSubtotal : enrichedItems.reduce((s, i) => s + Number(i.subtotal || 0), 0);
      const shipping = providedShipping !== null ? providedShipping : shippingFromItems;
      const discount = providedDiscount !== null ? providedDiscount : 0;
      const tax = providedTax;
      const taxForTotal = (tax === null) ? 0 : (Number.isFinite(Number(tax)) ? Number(tax) : 0);
      const computedTotal = subtotal + shipping + taxForTotal - discount;

      // Create order object
      const newOrder = {
        userId: orderData.userId,
        userEmail: orderData.userEmail,
        items: enrichedItems,
        total: Number.isFinite(orderData.total) ? Number(orderData.total) : computedTotal,
        status: 'pending',
        shippingAddress: orderData.shippingAddress || null,
        customerInfo: orderData.customerInfo || null,
        paymentInfo: orderData.paymentInfo || null,
        // Optional: store order-level weight (lbs)
        weightLbsTotal: (Number.isFinite(Number(orderData.weightLbsTotal)) && Number(orderData.weightLbsTotal) > 0)
          ? Number(orderData.weightLbsTotal)
          : (weightLbsFromItems > 0 ? weightLbsFromItems : undefined),
        // Persist breakdown if provided by caller (compute otherwise)
        subtotal,
        shipping,
        discount,
        tax,
        couponAudit: orderData.couponAudit || undefined
      };

      // Insert order
      const order = await this.db.insert('orders', newOrder);

  // Dropship model: do not decrease stock

      return order;
    } catch (error) {
      throw error;
    }
  }

  // Get order by ID
  async getOrderById(id) {
    try {
      return await this.db.findOne('orders', { id: parseInt(id) });
    } catch (error) {
      throw error;
    }
  }

  // Get orders by user
  async getOrdersByUser(userId) {
    try {
      return await this.db.find('orders', { userId: parseInt(userId) });
    } catch (error) {
      throw error;
    }
  }

  // Get orders by user email
  async getOrdersByEmail(email) {
    try {
      return await this.db.find('orders', { userEmail: email });
    } catch (error) {
      throw error;
    }
  }

  // Get all orders
  async getAllOrders(status = null, options = {}) {
    try {
      const { page = 1, pageSize = 20, sortBy = 'createdAt', sortDir = 'desc' } = options;
      const criteria = status ? { status } : {};
      const all = await this.db.find('orders', criteria);
      const sorted = [...all].sort((a, b) => {
        const av = a[sortBy];
        const bv = b[sortBy];
        const cmp = (av instanceof Date || typeof av === 'string') ? (new Date(av) - new Date(bv)) : ((av||0) - (bv||0));
        return sortDir === 'asc' ? cmp : -cmp;
      });
      const total = sorted.length;
      const p = Math.max(1, parseInt(page));
      const ps = Math.max(1, parseInt(pageSize));
      const start = (p - 1) * ps;
      const items = sorted.slice(start, start + ps);
      return { items, total, page: p, pageSize: ps };
    } catch (error) {
      throw error;
    }
  }

  // Update order status
  async updateOrderStatus(id, status) {
    try {
  const validStatuses = ['pending', 'paid', 'fulfilled', 'processing', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new Error('Invalid order status');
      }

      const updated = await this.db.update('orders', { id: parseInt(id) }, { status });
      if (!updated) {
        throw new Error('Order not found');
      }

      return await this.getOrderById(id);
    } catch (error) {
      throw error;
    }
  }

  // Cancel order
  async cancelOrder(id) {
    try {
      const order = await this.getOrderById(id);
      if (!order) {
        throw new Error('Order not found');
      }

      // Allow cancel if not fulfilled/delivered
      if (['fulfilled','delivered'].includes(order.status)) {
        throw new Error('Cannot cancel order that is already fulfilled/delivered');
      }

      // Dropship model: no stock restoration needed

      // Update status
      return await this.updateOrderStatus(id, 'cancelled');
    } catch (error) {
      throw error;
    }
  }

  // Attach/merge payment info to an order
  async updatePaymentInfo(id, paymentInfoPatch = {}) {
    try {
      const orderId = parseInt(id);
      const order = await this.getOrderById(orderId);
      if (!order) throw new Error('Order not found');
      const merged = { ...order.paymentInfo, ...paymentInfoPatch };
      const updated = await this.db.update('orders', { id: orderId }, { paymentInfo: merged });
      if (!updated) throw new Error('Failed to update payment info');
      return await this.getOrderById(orderId);
    } catch (e) { throw e; }
  }

  // Generic partial update for arbitrary fields (e.g., paidAt, refundedAt, flags)
  async patchOrder(id, fields = {}) {
    try {
      const orderId = parseInt(id);
      const updated = await this.db.update('orders', { id: orderId }, { ...fields });
      if (!updated) throw new Error('Order not found');
      return await this.getOrderById(orderId);
    } catch (e) { throw e; }
  }

  // Get order statistics
  async getOrderStats(timeframe = 'all') {
    try {
  const res = await this.getAllOrders(null, { page: 1, pageSize: 100000, sortBy: 'createdAt', sortDir: 'desc' });
  const orders = Array.isArray(res) ? res : (res.items || []);
  let filteredOrders = orders;

      // Apply time filter
      if (timeframe !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (timeframe) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          default:
            startDate = new Date(0);
        }

  filteredOrders = orders.filter(order => new Date(order.createdAt) >= startDate);
      }

      const totalOrders = filteredOrders.length;
      const totalRevenue = filteredOrders.reduce((sum, order) => sum + order.total, 0);
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const statusCounts = filteredOrders.reduce((acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {});

      return {
        totalOrders,
        totalRevenue,
        avgOrderValue,
        statusCounts,
        timeframe
      };
    } catch (error) {
      throw error;
    }
  }

  // Get recent orders
  async getRecentOrders(limit = 10) {
    try {
      const res = await this.getAllOrders(null, { page: 1, pageSize: 100000, sortBy: 'createdAt', sortDir: 'desc' });
      const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      return items.slice(0, limit);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = OrderService;
