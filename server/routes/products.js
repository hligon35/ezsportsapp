const express = require('express');
const router = express.Router();
const ProductService = require('../services/ProductService');
const { requireAdmin } = require('../middleware/auth');

const productService = new ProductService();

// Simple in‑memory cache (invalidated every 60s). Adequate for JSON file DB.
let cache = { ts: 0, data: [] };
const CACHE_TTL_MS = 60 * 1000;

async function loadAll(includeInactive) {
  const now = Date.now();
  if (now - cache.ts > CACHE_TTL_MS) {
    cache.data = await productService.getAllProducts(includeInactive);
    cache.ts = now;
  }
  return cache.data;
}

// Get all products (with optional category/search)
router.get('/', async (req, res) => {
  try {
    const { category, search, includeInactive, fields, refresh, limit, offset } = req.query;
    const incInactive = includeInactive === 'true';
    let products;
    if (search) {
      products = await productService.searchProducts(search);
    } else if (category) {
      products = await productService.getProductsByCategory(category);
    } else {
      // If refresh=true explicitly bypass cache (simple admin/dev tool)
      if (refresh === 'true') {
        cache.ts = 0; // invalidate
      }
      products = await loadAll(incInactive);
      if (!incInactive) {
        products = products.filter(p => p.isActive !== false);
      }
    }
    // Field filtering (?fields=id,name,price)
    if (fields) {
      const wanted = new Set(String(fields).split(',').map(f => f.trim()).filter(Boolean));
      products = products.map(p => {
        const o = {}; wanted.forEach(k => { if (p.hasOwnProperty(k)) o[k] = p[k]; }); return o; });
    }
    // Basic pagination (?limit=50&offset=0)
    let lim = parseInt(limit, 10);
    if (isNaN(lim) || lim <= 0) lim = products.length; // no limit
    if (lim > 500) lim = 500; // hard cap to protect memory
    let off = parseInt(offset, 10);
    if (isNaN(off) || off < 0) off = 0;
    const paged = products.slice(off, off + lim);
    res.json(paged);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get product by ID
router.get('/:id', async (req, res) => {
  try {
    const product = await productService.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add a new product (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, image, category, stock } = req.body;
    
    if (!name || !price || !category) {
      return res.status(400).json({ message: 'Name, price, and category are required' });
    }

    const productData = {
      name,
      description: description || '',
      price: parseFloat(price),
      image: image || '',
      category,
      stock: parseInt(stock) || 0
    };

    const newProduct = await productService.createProduct(productData);
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update product (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.price) updateData.price = parseFloat(updateData.price);
    if (updateData.stock) updateData.stock = parseInt(updateData.stock);

    const updatedProduct = await productService.updateProduct(req.params.id, updateData);
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update stock
router.patch('/:id/stock', requireAdmin, async (req, res) => {
  try {
    const { stock } = req.body;
    if (stock === undefined) {
      return res.status(400).json({ message: 'Stock value is required' });
    }

    const updatedProduct = await productService.updateStock(req.params.id, parseInt(stock));
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Deactivate product (admin only)
router.patch('/:id/deactivate', requireAdmin, async (req, res) => {
  try {
    const success = await productService.deactivateProduct(req.params.id);
    if (!success) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deactivated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete product (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const success = await productService.deleteProduct(req.params.id);
    if (!success) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get product statistics (admin only)
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await productService.getProductStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get low stock products (admin only)
router.get('/admin/low-stock', requireAdmin, async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 5;
    const lowStockProducts = await productService.getLowStockProducts(threshold);
    res.json(lowStockProducts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
