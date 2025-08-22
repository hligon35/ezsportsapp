// Invoice Service - Generate and list invoices (derived from orders)
const DatabaseManager = require('../database/DatabaseManager');

class InvoiceService {
  constructor() {
    this.db = new DatabaseManager();
  }

  // Map an order record to an invoice shape
  toInvoice(order) {
    const invoiceId = `INV-${order.id}`;
    const status = (order.status === 'paid' || order.status === 'fulfilled' || order.status === 'delivered') ? 'paid' : 'unpaid';
    const subtotal = Number(order.total || 0);
    return {
      id: invoiceId,
      orderId: order.id,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customer: {
        name: order.customerInfo?.name || 'Customer',
        email: order.userEmail || order.customerInfo?.email || ''
      },
      items: order.items || [],
      currency: order.currency || 'usd',
      subtotal,
      tax: Number(order.tax || 0),
      shipping: Number(order.shipping || 0),
      total: Number(order.total || 0),
      status
    };
  }

  async getInvoiceById(invoiceId) {
    const orderId = String(invoiceId).replace(/^INV-/, '');
    const numericId = Number(orderId);
    const criteria = isNaN(numericId) ? { id: orderId } : { id: numericId };
    const order = await this.db.findOne('orders', criteria);
    if (!order) return null;
    return this.toInvoice(order);
  }

  async getAllInvoices(status = null, options = {}) {
    const { page = 1, pageSize = 20, sortBy = 'createdAt', sortDir = 'desc' } = options;
    const orders = await this.db.find('orders');
    let invoices = orders.map(o => this.toInvoice(o));
    if (status) invoices = invoices.filter(inv => inv.status === status);

    const sorted = [...invoices].sort((a, b) => {
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
  }
}

module.exports = InvoiceService;
