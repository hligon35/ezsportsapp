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
            const price = Number(p.map ?? p.price ?? p.wholesale ?? 0) || 0;
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
      let total = 0;
      const enrichedItems = [];

      for (const item of orderData.items) {
        const qty = Math.max(1, Number(item.qty) || 1);
        let product = null;
        try { product = await this.productService.getProductById(item.id); } catch {}

        // Fallback lookup when product is not found in DB
        let price = 0;
        let productName = '';
        if (product) {
          price = Number(product.price || 0) || 0;
          productName = product.name || String(item.id);
        } else {
          const fb = fbMap.get(String(item.id));
          if (fb) {
            price = Number(fb.price || 0) || 0;
            productName = fb.name || String(item.id);
          } else {
            // Last resort: honor client-provided unit price if present so the order record is useful
            const unit = Number(item.price || 0);
            price = Number.isFinite(unit) && unit > 0 ? unit : 0;
            productName = String(item.id);
          }
        }

        const itemTotal = price * qty;
        total += itemTotal;

        enrichedItems.push({
          productId: item.id,
          productName,
          price,
          quantity: qty,
          subtotal: itemTotal,
          // Optional: store per-line shipping provided by client for future detailed invoices
          ship: Number(item.ship || 0) || undefined
        });
      }

      // Create order object
      const newOrder = {
        userId: orderData.userId,
        userEmail: orderData.userEmail,
        items: enrichedItems,
        total: Number.isFinite(orderData.total) ? Number(orderData.total) : total,
        status: 'pending',
        shippingAddress: orderData.shippingAddress || null,
        customerInfo: orderData.customerInfo || null,
        paymentInfo: orderData.paymentInfo || null,
        // Persist breakdown if provided by caller (compute otherwise)
        subtotal: Number.isFinite(orderData.subtotal) ? Number(orderData.subtotal) : enrichedItems.reduce((s,i)=>s + Number(i.subtotal||0), 0),
        shipping: Number.isFinite(orderData.shipping) ? Number(orderData.shipping) : 0,
        discount: Number.isFinite(orderData.discount) ? Number(orderData.discount) : 0,
        tax: (orderData.tax === null) ? null : (Number.isFinite(orderData.tax) ? Number(orderData.tax) : 0),
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
