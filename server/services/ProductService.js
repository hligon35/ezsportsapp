// Product Service - Handle product operations
const DatabaseManager = require('../database/DatabaseManager');

class ProductService {
  constructor() {
    this.db = new DatabaseManager();
  }

  // Get all products
  async getAllProducts(includeInactive = false) {
    try {
      const criteria = includeInactive ? {} : { isActive: true };
      return await this.db.find('products', criteria);
    } catch (error) {
      throw error;
    }
  }

  // Get products by category
  async getProductsByCategory(category) {
    try {
      return await this.db.find('products', { category, isActive: true });
    } catch (error) {
      throw error;
    }
  }

  // Get product by ID
  async getProductById(id) {
    try {
      return await this.db.findOne('products', { id });
    } catch (error) {
      throw error;
    }
  }

  // Search products
  async searchProducts(query) {
    try {
      const products = await this.db.find('products', { isActive: true });
      const searchTerm = query.toLowerCase();
      
      return products.filter(product => 
        product.name.toLowerCase().includes(searchTerm) ||
        product.description.toLowerCase().includes(searchTerm) ||
        product.category.toLowerCase().includes(searchTerm)
      );
    } catch (error) {
      throw error;
    }
  }

  // Create product
  async createProduct(productData) {
    try {
      const newProduct = {
        ...productData,
        isActive: true,
        stock: productData.stock || 0
      };

      return await this.db.insert('products', newProduct);
    } catch (error) {
      throw error;
    }
  }

  // Update product
  async updateProduct(id, updateData) {
    try {
      delete updateData.id; // Don't allow ID updates
      
      const updated = await this.db.update('products', { id }, updateData);
      if (!updated) {
        throw new Error('Product not found');
      }

      return await this.getProductById(id);
    } catch (error) {
      throw error;
    }
  }

  // Update stock
  async updateStock(id, newStock) {
    try {
      const updated = await this.db.update('products', { id }, { stock: newStock });
      if (!updated) {
        throw new Error('Product not found');
      }

      return await this.getProductById(id);
    } catch (error) {
      throw error;
    }
  }

  // Decrease stock (for orders)
  async decreaseStock(id, quantity) {
    try {
      const product = await this.getProductById(id);
      if (!product) {
        throw new Error('Product not found');
      }

      if (product.stock < quantity) {
        throw new Error('Insufficient stock');
      }

      const newStock = product.stock - quantity;
      return await this.updateStock(id, newStock);
    } catch (error) {
      throw error;
    }
  }

  // Check stock availability
  async checkStock(id, quantity) {
    try {
      const product = await this.getProductById(id);
      if (!product) {
        return false;
      }

      return product.stock >= quantity;
    } catch (error) {
      return false;
    }
  }

  // Soft delete product (mark as inactive)
  async deactivateProduct(id) {
    try {
      const updated = await this.db.update('products', { id }, { isActive: false });
      return updated;
    } catch (error) {
      throw error;
    }
  }

  // Hard delete product
  async deleteProduct(id) {
    try {
      const deletedCount = await this.db.delete('products', { id });
      return deletedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  // Get low stock products
  async getLowStockProducts(threshold = 5) {
    try {
      const products = await this.getAllProducts();
      return products.filter(product => product.stock <= threshold);
    } catch (error) {
      throw error;
    }
  }

  // Get product statistics
  async getProductStats() {
    try {
      const products = await this.getAllProducts(true);
      const activeProducts = products.filter(p => p.isActive);
      
      const categories = [...new Set(products.map(p => p.category))];
      const categoryStats = categories.map(category => ({
        category,
        count: products.filter(p => p.category === category && p.isActive).length,
        totalStock: products
          .filter(p => p.category === category && p.isActive)
          .reduce((sum, p) => sum + p.stock, 0)
      }));

      return {
        totalProducts: products.length,
        activeProducts: activeProducts.length,
        inactiveProducts: products.length - activeProducts.length,
        totalStock: activeProducts.reduce((sum, p) => sum + p.stock, 0),
        lowStockProducts: activeProducts.filter(p => p.stock <= 5).length,
        categories: categoryStats
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ProductService;
