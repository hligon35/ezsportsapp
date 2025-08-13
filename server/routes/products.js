const express = require('express');
const router = express.Router();
const ProductService = require('../services/ProductService');

const productService = new ProductService();

// Get all products
router.get('/', async (req, res) => {
  try {
    const { category, search, includeInactive } = req.query;
    let products;

    if (search) {
      products = await productService.searchProducts(search);
    } else if (category) {
      products = await productService.getProductsByCategory(category);
    } else {
      products = await productService.getAllProducts(includeInactive === 'true');
    }

    res.json(products);
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
router.post('/', async (req, res) => {
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
router.put('/:id', async (req, res) => {
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
router.patch('/:id/stock', async (req, res) => {
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
router.patch('/:id/deactivate', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await productService.getProductStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get low stock products (admin only)
router.get('/admin/low-stock', async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 5;
    const lowStockProducts = await productService.getLowStockProducts(threshold);
    res.json(lowStockProducts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
