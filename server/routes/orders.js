const express = require('express');
const router = express.Router();
const OrderService = require('../services/OrderService');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const orderService = new OrderService();

function stripWeightFields(order) {
  if (!order || typeof order !== 'object') return order;
  const out = { ...order };
  if (Object.prototype.hasOwnProperty.call(out, 'weightLbsTotal')) delete out.weightLbsTotal;
  if (Object.prototype.hasOwnProperty.call(out, 'totalWeightLbs')) delete out.totalWeightLbs;
  if (Object.prototype.hasOwnProperty.call(out, 'weightTotal')) delete out.weightTotal;
  if (Object.prototype.hasOwnProperty.call(out, 'totalWeight')) delete out.totalWeight;
  if (Array.isArray(out.items)) {
    out.items = out.items.map(i => {
      if (!i || typeof i !== 'object') return i;
      const ii = { ...i };
      ['weightLbsEach','weightLbsTotal','weightEach','weightTotal','weightLbs','weight'].forEach(k => {
        if (Object.prototype.hasOwnProperty.call(ii, k)) delete ii[k];
      });
      return ii;
    });
  }
  return out;
}

// Create new order
router.post('/', requireAuth, async (req, res) => {
  try {
    const orderData = req.body;

    if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    // Attach authenticated user when available
    const enriched = {
      ...orderData,
      userId: req.user?.id ?? orderData.userId ?? null,
      userEmail: orderData.userEmail || req.user?.email || orderData.customer?.email || undefined
    };
    const order = await orderService.createOrder(enriched);
    res.status(201).json({
      message: 'Order created successfully',
      order
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Public minimal summary endpoint (no PII). Safe to expose on confirmation page.
router.get('/summary/:id', async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const items = Array.isArray(order.items) ? order.items.map(i => ({
      id: i.productId || i.id,
      productName: i.productName,
      quantity: i.quantity,
      subtotal: i.subtotal,
      // Include variations so confirmation page can render the full item description
      size: i.size,
      color: i.color,
      category: i.category
    })) : [];
    const out = {
      id: order.id,
      status: order.status,
      total: order.total,
      items,
      subtotal: order.subtotal,
      shipping: order.shipping,
      discount: order.discount,
      tax: order.tax
    };
    res.json(out);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get order by ID (authenticated, full details)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    // Only owner or admin can see
    const isOwner = order.userId && String(order.userId) === String(req.user.id);
    if (!isOwner && !req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
    res.json(req.user.isAdmin ? order : stripWeightFields(order));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get orders by user ID
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
  const isSelf = String(req.params.userId) === String(req.user.id);
  if (!isSelf && !req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const orders = await orderService.getOrdersByUser(req.params.userId);
    res.json(req.user.isAdmin ? orders : (orders || []).map(stripWeightFields));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get orders by user email
router.get('/email/:email', requireAdmin, async (req, res) => {
  try {
    const orders = await orderService.getOrdersByEmail(req.params.email);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Current user's orders
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await orderService.getOrdersByUser(userId);
    res.json(req.user.isAdmin ? orders : (orders || []).map(stripWeightFields));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Public: Get orders by email (sanitized). Intended for Order History fallback when not logged in.
// Basic spam/honeypot protection via optional `hp` param; if present, treat as bot and return empty.
router.get('/public/by-email', async (req, res) => {
  try {
    const { email, hp } = req.query;
    if (hp) return res.json([]);
    const em = String(email || '').trim();
    if (!em || !em.includes('@')) return res.status(400).json({ message: 'email is required' });
    const orders = await orderService.getOrdersByEmail(em);
    const sanitized = (orders || []).map(o => ({
      id: o.id,
      status: o.status,
      createdAt: o.createdAt,
      total: o.total,
      subtotal: o.subtotal,
      shipping: o.shipping,
      discount: o.discount,
      tax: o.tax,
      items: (o.items||[]).map(i => ({ id: i.productId || i.id, qty: i.quantity, price: i.price }))
    }));
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update order status
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const updatedOrder = await orderService.updateOrderStatus(req.params.id, status);
    res.json({
      message: 'Order status updated successfully',
      order: updatedOrder
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Cancel order
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
  // Only owner or admin can cancel
  const order = await orderService.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  const isOwner = order.userId && String(order.userId) === String(req.user.id);
  if (!isOwner && !req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const cancelledOrder = await orderService.cancelOrder(req.params.id);
    res.json({
      message: 'Order cancelled successfully',
      order: cancelledOrder
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get all orders (admin only)
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
  const { status, page, pageSize, sortBy, sortDir } = req.query;
  const result = await orderService.getAllOrders(status, { page, pageSize, sortBy, sortDir });
  res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get order statistics (admin only)
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { timeframe } = req.query;
    const stats = await orderService.getOrderStats(timeframe);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get recent orders (admin only)
router.get('/admin/recent', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const orders = await orderService.getRecentOrders(limit);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;