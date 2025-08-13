const express = require('express');
const router = express.Router();
const InventoryService = require('../services/InventoryService');

const inventoryService = new InventoryService();

// Get inventory overview and stats
router.get('/overview', async (req, res) => {
  try {
    const overview = await inventoryService.getInventoryOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Adjust stock levels
router.post('/adjust', async (req, res) => {
  try {
    const { productId, adjustment, reason, notes } = req.body;
    
    if (!productId || !adjustment) {
      return res.status(400).json({ message: 'Product ID and adjustment details are required' });
    }

    const result = await inventoryService.adjustStock(productId, adjustment, reason, notes);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get stock movement history
router.get('/history/:productId?', async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 50 } = req.query;
    
    const history = await inventoryService.getStockHistory(productId, parseInt(limit));
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get low stock alerts
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await inventoryService.getLowStockAlerts();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update stock thresholds
router.post('/thresholds', async (req, res) => {
  try {
    const { lowThreshold, criticalThreshold } = req.body;
    
    if (!lowThreshold || !criticalThreshold) {
      return res.status(400).json({ message: 'Both thresholds are required' });
    }

    inventoryService.setStockThresholds(parseInt(lowThreshold), parseInt(criticalThreshold));
    res.json({ message: 'Thresholds updated successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Generate inventory report
router.get('/report', async (req, res) => {
  try {
    const report = await inventoryService.generateInventoryReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Process bulk stock update
router.post('/bulk-update', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ message: 'Updates array is required' });
    }

    const results = await inventoryService.processBulkUpdate(updates);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
