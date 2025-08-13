// Inventory Service - Handle stock tracking and movements
const DatabaseManager = require('../database/DatabaseManager');

class InventoryService {
  constructor() {
    this.db = new DatabaseManager();
    this.lowStockThreshold = 10;
    this.criticalStockThreshold = 5;
  }

  // Get inventory overview with stats
  async getInventoryOverview() {
    try {
      const products = await this.db.findAll('products');
      
      const stats = {
        totalProducts: products.length,
        lowStockCount: products.filter(p => p.stock <= this.lowStockThreshold && p.stock > 0).length,
        outOfStockCount: products.filter(p => p.stock === 0).length,
        criticalStockCount: products.filter(p => p.stock <= this.criticalStockThreshold && p.stock > 0).length,
        totalInventoryValue: products.reduce((sum, p) => sum + (p.price * p.stock), 0),
        totalItems: products.reduce((sum, p) => sum + p.stock, 0)
      };

      const productsWithStatus = products.map(product => ({
        ...product,
        stockStatus: this.getStockStatus(product.stock),
        stockValue: product.price * product.stock
      }));

      return {
        stats,
        products: productsWithStatus
      };
    } catch (error) {
      throw error;
    }
  }

  // Get stock status based on current levels
  getStockStatus(stock) {
    if (stock === 0) return 'out';
    if (stock <= this.criticalStockThreshold) return 'critical';
    if (stock <= this.lowStockThreshold) return 'low';
    return 'good';
  }

  // Adjust stock levels with tracking
  async adjustStock(productId, adjustment, reason = 'manual', notes = '') {
    try {
      const product = await this.db.findOne('products', { id: productId });
      if (!product) {
        throw new Error('Product not found');
      }

      const oldStock = product.stock;
      let newStock;

      switch (adjustment.type) {
        case 'add':
          newStock = oldStock + adjustment.quantity;
          break;
        case 'remove':
          newStock = Math.max(0, oldStock - adjustment.quantity);
          break;
        case 'set':
          newStock = adjustment.quantity;
          break;
        default:
          throw new Error('Invalid adjustment type');
      }

      // Update product stock
      await this.db.update('products', { id: productId }, { 
        stock: newStock,
        updatedAt: new Date().toISOString()
      });

      // Record stock movement
      await this.recordStockMovement({
        productId,
        productName: product.name,
        oldStock,
        newStock,
        change: newStock - oldStock,
        reason,
        notes,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        oldStock,
        newStock,
        change: newStock - oldStock
      };
    } catch (error) {
      throw error;
    }
  }

  // Record stock movement for history tracking
  async recordStockMovement(movement) {
    try {
      // Check if stock_movements table exists, create if not
      const movements = await this.db.findAll('stock_movements').catch(() => []);
      
      const movementRecord = {
        id: 'mov_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        ...movement
      };

      await this.db.insert('stock_movements', movementRecord);
      return movementRecord;
    } catch (error) {
      console.warn('Could not record stock movement:', error.message);
      // Don't throw error here to avoid breaking stock adjustments
    }
  }

  // Get stock movement history
  async getStockHistory(productId = null, limit = 50) {
    try {
      let movements = await this.db.findAll('stock_movements').catch(() => []);
      
      if (productId) {
        movements = movements.filter(m => m.productId === productId);
      }

      // Sort by timestamp descending
      movements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return movements.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  // Update stock thresholds
  setStockThresholds(lowThreshold, criticalThreshold) {
    this.lowStockThreshold = lowThreshold;
    this.criticalStockThreshold = criticalThreshold;
  }

  // Get low stock alerts
  async getLowStockAlerts() {
    try {
      const products = await this.db.findAll('products');
      return products
        .filter(p => p.stock <= this.lowStockThreshold)
        .map(p => ({
          ...p,
          stockStatus: this.getStockStatus(p.stock),
          alertLevel: p.stock === 0 ? 'critical' : 'warning'
        }))
        .sort((a, b) => a.stock - b.stock);
    } catch (error) {
      throw error;
    }
  }

  // Generate inventory report
  async generateInventoryReport() {
    try {
      const overview = await this.getInventoryOverview();
      const lowStockAlerts = await this.getLowStockAlerts();
      const recentMovements = await this.getStockHistory(null, 20);

      return {
        generatedAt: new Date().toISOString(),
        overview: overview.stats,
        products: overview.products,
        alerts: lowStockAlerts,
        recentMovements,
        recommendations: this.generateRecommendations(overview.products)
      };
    } catch (error) {
      throw error;
    }
  }

  // Generate stock recommendations
  generateRecommendations(products) {
    const recommendations = [];

    products.forEach(product => {
      if (product.stock === 0) {
        recommendations.push({
          type: 'restock_urgent',
          productId: product.id,
          productName: product.name,
          message: 'OUT OF STOCK - Immediate restock required',
          priority: 'high'
        });
      } else if (product.stock <= this.criticalStockThreshold) {
        recommendations.push({
          type: 'restock_soon',
          productId: product.id,
          productName: product.name,
          message: `Critical stock level (${product.stock} remaining)`,
          priority: 'medium'
        });
      } else if (product.stock <= this.lowStockThreshold) {
        recommendations.push({
          type: 'restock_plan',
          productId: product.id,
          productName: product.name,
          message: `Low stock - Consider reordering soon`,
          priority: 'low'
        });
      }
    });

    return recommendations;
  }

  // Process bulk stock update
  async processBulkUpdate(updates) {
    const results = [];
    
    for (const update of updates) {
      try {
        const result = await this.adjustStock(
          update.productId,
          { type: 'set', quantity: update.newStock },
          update.reason || 'bulk_update',
          update.notes || 'Bulk inventory update'
        );
        results.push({ productId: update.productId, success: true, ...result });
      } catch (error) {
        results.push({ 
          productId: update.productId, 
          success: false, 
          error: error.message 
        });
      }
    }

    return results;
  }
}

module.exports = InventoryService;
