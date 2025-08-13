const express = require('express');
const router = express.Router();
const OrderService = require('../services/OrderService');

const orderService = new OrderService();

// Create new order
router.post('/', async (req, res) => {
  try {
    const orderData = req.body;
    
    if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    const order = await orderService.createOrder(orderData);
    res.status(201).json({
      message: 'Order created successfully',
      order
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get order by ID
router.get('/:id', async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get orders by user ID
router.get('/user/:userId', async (req, res) => {
  try {
    const orders = await orderService.getOrdersByUser(req.params.userId);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get orders by user email
router.get('/email/:email', async (req, res) => {
  try {
    const orders = await orderService.getOrdersByEmail(req.params.email);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update order status
router.patch('/:id/status', async (req, res) => {
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
router.patch('/:id/cancel', async (req, res) => {
  try {
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
router.get('/admin/all', async (req, res) => {
  try {
    const { status } = req.query;
    const orders = await orderService.getAllOrders(status);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get order statistics (admin only)
router.get('/admin/stats', async (req, res) => {
  try {
    const { timeframe } = req.query;
    const stats = await orderService.getOrderStats(timeframe);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get recent orders (admin only)
router.get('/admin/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const orders = await orderService.getRecentOrders(limit);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
