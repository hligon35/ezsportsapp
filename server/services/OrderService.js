// Order Service - Handle order operations
const DatabaseManager = require('../database/DatabaseManager');
const ProductService = require('./ProductService');

class OrderService {
  constructor() {
    this.db = new DatabaseManager();
    this.productService = new ProductService();
  }

  // Create a new order
  async createOrder(orderData) {
    try {
  // Dropship model: skip stock availability validation

      // Calculate total
      let total = 0;
      const enrichedItems = [];
      
      for (const item of orderData.items) {
        const product = await this.productService.getProductById(item.id);
        if (!product) {
          throw new Error(`Product not found: ${item.id}`);
        }
        
        const itemTotal = product.price * item.qty;
        total += itemTotal;
        
        enrichedItems.push({
          productId: item.id,
          productName: product.name,
          price: product.price,
          quantity: item.qty,
          subtotal: itemTotal
        });
      }

      // Create order object
      const newOrder = {
        userId: orderData.userId,
        userEmail: orderData.userEmail,
        items: enrichedItems,
        total: total,
        status: 'pending',
        shippingAddress: orderData.shippingAddress || null,
        customerInfo: orderData.customerInfo || null,
        paymentInfo: orderData.paymentInfo || null
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
      const orders = await this.getAllOrders();
      return orders
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = OrderService;
