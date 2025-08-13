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
      // Validate stock availability for all items
      for (const item of orderData.items) {
        const hasStock = await this.productService.checkStock(item.id, item.qty);
        if (!hasStock) {
          const product = await this.productService.getProductById(item.id);
          throw new Error(`Insufficient stock for ${product?.name || item.id}`);
        }
      }

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

      // Decrease stock for all items
      for (const item of orderData.items) {
        await this.productService.decreaseStock(item.id, item.qty);
      }

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
  async getAllOrders(status = null) {
    try {
      const criteria = status ? { status } : {};
      return await this.db.find('orders', criteria);
    } catch (error) {
      throw error;
    }
  }

  // Update order status
  async updateOrderStatus(id, status) {
    try {
      const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
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

      if (order.status !== 'pending') {
        throw new Error('Cannot cancel order that is already processed');
      }

      // Restore stock
      for (const item of order.items) {
        const product = await this.productService.getProductById(item.productId);
        if (product) {
          await this.productService.updateStock(item.productId, product.stock + item.quantity);
        }
      }

      // Update status
      return await this.updateOrderStatus(id, 'cancelled');
    } catch (error) {
      throw error;
    }
  }

  // Get order statistics
  async getOrderStats(timeframe = 'all') {
    try {
      const orders = await this.getAllOrders();
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
