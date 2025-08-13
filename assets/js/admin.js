// Admin panel functionality
let currentEditingProduct = null;

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

function getProducts() {
  try {
    return JSON.parse(localStorage.getItem('adminProducts') || '[]');
  } catch {
    return [];
  }
}

function saveProducts(products) {
  localStorage.setItem('adminProducts', JSON.stringify(products));
  // Also update the main PRODUCTS array for the shop
  updateShopProducts(products);
}

function updateShopProducts(products) {
  // Convert admin products to shop format
  const shopProducts = products.map(p => ({
    id: p.id,
    title: p.name,
    price: p.price,
    category: p.category,
    img: p.image || 'https://source.unsplash.com/600x400/?product',
    description: p.description,
    stock: p.stock
  }));
  localStorage.setItem('shopProducts', JSON.stringify(shopProducts));
}

function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch {
    return [];
  }
}

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('users') || '[]');
  } catch {
    return [];
  }
}

function generateId() {
  return 'prod-' + Date.now();
}

function showSection(section) {
  // Hide all sections
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.remove('active'));
  
  // Show selected section
  document.getElementById(section + '-section').style.display = 'block';
  event.target.classList.add('active');
  
  // Load data for section
  if (section === 'products') renderProducts();
  if (section === 'orders') renderOrders();
  if (section === 'users') renderUsers();
  if (section === 'inventory') renderInventory();
}

function renderProducts() {
  const products = getProducts();
  const list = document.getElementById('products-list');
  
  if (!products.length) {
    list.innerHTML = '<p>No products yet. Add your first product above.</p>';
    return;
  }
  
  list.innerHTML = products.map(p => `
    <div class="product-item">
      <div>
        <strong>${p.name}</strong> - $${p.price}
        <br><small>${p.category} | Stock: ${p.stock || 0}</small>
      </div>
      <div>
        <button class="btn btn-ghost" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-ghost" onclick="deleteProduct('${p.id}')" style="color:red;">Delete</button>
      </div>
    </div>
  `).join('');
}

function renderOrders() {
  const orders = getOrders();
  const list = document.getElementById('orders-list');
  
  if (!orders.length) {
    list.innerHTML = '<p>No orders yet.</p>';
    return;
  }
  
  list.innerHTML = orders.map(order => `
    <div class="product-item">
      <div>
        <strong>Order #${order.id}</strong>
        <br><small>${new Date(order.date).toLocaleString()}</small>
        <br>Items: ${order.items.map(i => `${i.qty}x ${i.id}`).join(', ')}
      </div>
      <div>
        <strong>$${order.total.toFixed(2)}</strong>
      </div>
    </div>
  `).join('');
}

function renderUsers() {
  const users = getUsers();
  const list = document.getElementById('users-list');
  
  if (!users.length) {
    list.innerHTML = '<p>No users registered yet.</p>';
    return;
  }
  
  list.innerHTML = users.map(user => `
    <div class="product-item">
      <div>
        <strong>${user.name}</strong> (${user.email})
        <br><small>${user.isAdmin ? 'Admin' : 'Customer'}</small>
      </div>
      <div>
        <small>ID: ${user.id}</small>
      </div>
    </div>
  `).join('');
}

function addProduct(productData) {
  const products = getProducts();
  const newProduct = {
    id: generateId(),
    ...productData,
    createdAt: new Date().toISOString()
  };
  products.push(newProduct);
  saveProducts(products);
  renderProducts();
}

function editProduct(id) {
  const products = getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;
  
  currentEditingProduct = id;
  document.getElementById('product-name').value = product.name;
  document.getElementById('product-price').value = product.price;
  document.getElementById('product-image').value = product.image || '';
  document.getElementById('product-category').value = product.category;
  document.getElementById('product-description').value = product.description || '';
  document.getElementById('product-stock').value = product.stock || 0;
  
  document.querySelector('#product-form button[type="submit"]').textContent = 'Update Product';
  document.getElementById('cancel-edit').style.display = 'block';
}

function updateProduct(id, productData) {
  const products = getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index !== -1) {
    products[index] = { ...products[index], ...productData };
    saveProducts(products);
    renderProducts();
  }
}

function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  
  const products = getProducts().filter(p => p.id !== id);
  saveProducts(products);
  renderProducts();
}

function cancelEdit() {
  currentEditingProduct = null;
  document.getElementById('product-form').reset();
  document.querySelector('#product-form button[type="submit"]').textContent = 'Add Product';
  document.getElementById('cancel-edit').style.display = 'none';
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  
  // Check if user is admin
  if (!user || !user.isAdmin) {
    alert('Access denied. Admin privileges required.');
    window.location.href = 'login.html?redirect=admin.html';
    return;
  }
  
  // Product form submission
  document.getElementById('product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const productData = {
      name: document.getElementById('product-name').value,
      price: parseFloat(document.getElementById('product-price').value),
      image: document.getElementById('product-image').value,
      category: document.getElementById('product-category').value,
      description: document.getElementById('product-description').value,
      stock: parseInt(document.getElementById('product-stock').value) || 0
    };
    
    if (currentEditingProduct) {
      updateProduct(currentEditingProduct, productData);
      cancelEdit();
    } else {
      addProduct(productData);
      document.getElementById('product-form').reset();
    }
  });
  
  // Logout functionality
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
  });
  
  // Load initial data
  renderProducts();
  
  // Add stock form event listener
  document.getElementById('stock-form').addEventListener('submit', applyStockAdjustment);
});

// Inventory Management Functions
let inventoryThresholds = { low: 10, critical: 5 };

async function renderInventory() {
  try {
    const overview = await fetchInventoryOverview();
    updateInventoryStats(overview.stats);
    renderInventoryList(overview.products);
  } catch (error) {
    console.error('Error loading inventory:', error);
    document.getElementById('inventory-list').innerHTML = '<p>Error loading inventory data</p>';
  }
}

async function fetchInventoryOverview() {
  try {
    const response = await fetch('/api/inventory/overview');
    if (!response.ok) {
      console.warn('API not available, using fallback');
      throw new Error('Failed to fetch inventory');
    }
    const data = await response.text(); // Get as text first
    if (!data.trim()) {
      throw new Error('Empty response');
    }
    return JSON.parse(data); // Then parse JSON
  } catch (error) {
    console.warn('Using localStorage fallback:', error.message);
    // Fallback to localStorage for demonstration
    const products = getProducts();
    return {
      stats: calculateInventoryStats(products),
      products: products.map(p => ({
        ...p,
        stockStatus: getStockStatus(p.stock),
        stockValue: p.price * (p.stock || 0)
      }))
    };
  }
}

function calculateInventoryStats(products) {
  return {
    totalProducts: products.length,
    lowStockCount: products.filter(p => (p.stock || 0) <= inventoryThresholds.low && (p.stock || 0) > 0).length,
    outOfStockCount: products.filter(p => (p.stock || 0) === 0).length,
    totalInventoryValue: products.reduce((sum, p) => sum + (p.price * (p.stock || 0)), 0),
    totalItems: products.reduce((sum, p) => sum + (p.stock || 0), 0)
  };
}

function getStockStatus(stock) {
  if (stock === 0) return 'out';
  if (stock <= inventoryThresholds.critical) return 'critical';
  if (stock <= inventoryThresholds.low) return 'low';
  return 'good';
}

function updateInventoryStats(stats) {
  document.getElementById('total-products').textContent = stats.totalProducts;
  document.getElementById('low-stock-count').textContent = stats.lowStockCount;
  document.getElementById('out-of-stock-count').textContent = stats.outOfStockCount;
  document.getElementById('total-inventory-value').textContent = '$' + stats.totalInventoryValue.toFixed(2);
}

function renderInventoryList(products) {
  const list = document.getElementById('inventory-list');
  
  if (!products.length) {
    list.innerHTML = '<p>No products in inventory</p>';
    return;
  }

  list.innerHTML = products.map(product => {
    const statusClass = `stock-${product.stockStatus}`;
    const statusText = {
      'out': 'Out of Stock',
      'critical': 'Critical',
      'low': 'Low Stock',
      'good': 'In Stock'
    }[product.stockStatus];

    return `
      <div class="inventory-card">
        <h4>${product.name}</h4>
        <p><strong>Category:</strong> ${product.category}</p>
        <p><strong>Price:</strong> $${product.price}</p>
        <p><strong>Current Stock:</strong> ${product.stock || 0}</p>
        <p><strong>Stock Value:</strong> $${product.stockValue.toFixed(2)}</p>
        <span class="stock-status ${statusClass}">${statusText}</span>
        <div class="inventory-actions">
          <button class="btn-restock" onclick="showStockModal('${product.id}', 'add')">Restock</button>
          <button class="btn-adjust" onclick="showStockModal('${product.id}', 'adjust')">Adjust</button>
        </div>
      </div>
    `;
  }).join('');
}

function showStockModal(productId, type) {
  const products = getProducts();
  const product = products.find(p => p.id === productId);
  
  if (!product) return;

  document.getElementById('modal-product-id').value = productId;
  document.getElementById('modal-product-name').textContent = product.name;
  document.getElementById('modal-current-stock').textContent = product.stock || 0;
  
  if (type === 'add') {
    document.getElementById('adjustment-type').value = 'add';
    document.getElementById('adjustment-reason').value = 'restock';
    document.getElementById('modal-title').textContent = 'Restock Product';
  } else {
    document.getElementById('modal-title').textContent = 'Adjust Stock';
  }
  
  document.getElementById('stock-modal').style.display = 'block';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  if (modalId === 'stock-modal') {
    document.getElementById('stock-form').reset();
  }
}

async function applyStockAdjustment(event) {
  event.preventDefault();
  
  const productId = document.getElementById('modal-product-id').value;
  const type = document.getElementById('adjustment-type').value;
  const quantity = parseInt(document.getElementById('adjustment-quantity').value);
  const reason = document.getElementById('adjustment-reason').value;
  const notes = document.getElementById('adjustment-notes').value;

  try {
    // Try API first
    const response = await fetch('/api/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        adjustment: { type, quantity },
        reason,
        notes
      })
    });

    if (response.ok) {
      const responseText = await response.text();
      if (responseText.trim()) {
        const result = JSON.parse(responseText);
        alert(`Stock adjusted successfully! Old: ${result.oldStock}, New: ${result.newStock}`);
      } else {
        throw new Error('Empty response from server');
      }
    } else {
      throw new Error('API call failed with status: ' + response.status);
    }
  } catch (error) {
    console.warn('Using localStorage fallback:', error.message);
    // Fallback to localStorage
    const products = getProducts();
    const productIndex = products.findIndex(p => p.id === productId);
    
    if (productIndex !== -1) {
      const currentStock = products[productIndex].stock || 0;
      let newStock;
      
      switch (type) {
        case 'add':
          newStock = currentStock + quantity;
          break;
        case 'remove':
          newStock = Math.max(0, currentStock - quantity);
          break;
        case 'set':
          newStock = quantity;
          break;
      }
      
      products[productIndex].stock = newStock;
      saveProducts(products);
      alert(`Stock adjusted! Old: ${currentStock}, New: ${newStock}`);
    }
  }
  
  closeModal('stock-modal');
  renderInventory();
}

function updateThresholds() {
  const lowThreshold = parseInt(document.getElementById('low-stock-threshold').value);
  const criticalThreshold = parseInt(document.getElementById('critical-stock-threshold').value);
  
  if (lowThreshold <= criticalThreshold) {
    alert('Low stock threshold must be higher than critical threshold');
    return;
  }
  
  inventoryThresholds = { low: lowThreshold, critical: criticalThreshold };
  
  // Try to update on server
  fetch('/api/inventory/thresholds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lowThreshold, criticalThreshold })
  }).then(response => {
    if (response.ok) {
      console.log('Thresholds updated on server');
    } else {
      console.warn('Failed to update thresholds on server, using local values');
    }
  }).catch(error => {
    console.warn('Server not available, using local thresholds:', error.message);
  });
  
  alert('Thresholds updated successfully!');
  renderInventory();
}

function exportInventoryReport() {
  const products = getProducts();
  const stats = calculateInventoryStats(products);
  
  const report = {
    generatedAt: new Date().toISOString(),
    stats,
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock || 0,
      value: p.price * (p.stock || 0),
      status: getStockStatus(p.stock || 0)
    }))
  };
  
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-report-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function showBulkStockUpdate() {
  document.getElementById('bulk-modal').style.display = 'block';
}

function applyBulkPercentage() {
  const percentage = parseFloat(document.getElementById('bulk-percentage').value);
  
  if (isNaN(percentage)) {
    alert('Please enter a valid percentage');
    return;
  }
  
  const products = getProducts();
  products.forEach(product => {
    const currentStock = product.stock || 0;
    const adjustment = Math.round(currentStock * (percentage / 100));
    product.stock = Math.max(0, currentStock + adjustment);
  });
  
  saveProducts(products);
  alert(`Applied ${percentage}% adjustment to all products`);
  closeModal('bulk-modal');
  renderInventory();
}

function processBulkUpdate() {
  const fileInput = document.getElementById('bulk-csv');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select a CSV file');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const csv = e.target.result;
      const lines = csv.split('\n').filter(line => line.trim());
      const products = getProducts();
      
      let updated = 0;
      for (let i = 1; i < lines.length; i++) { // Skip header
        const [productId, newStock, reason] = lines[i].split(',').map(s => s.trim());
        const productIndex = products.findIndex(p => p.id === productId);
        
        if (productIndex !== -1) {
          products[productIndex].stock = parseInt(newStock) || 0;
          updated++;
        }
      }
      
      saveProducts(products);
      alert(`Updated ${updated} products from CSV`);
      closeModal('bulk-modal');
      renderInventory();
    } catch (error) {
      alert('Error processing CSV file: ' + error.message);
    }
  };
  reader.readAsText(file);
}

function showInventoryHistory() {
  alert('Inventory history feature - this would show detailed stock movement logs');
}

// Make functions global for onclick handlers
window.showSection = showSection;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.cancelEdit = cancelEdit;
window.showStockModal = showStockModal;
window.closeModal = closeModal;
window.updateThresholds = updateThresholds;
window.exportInventoryReport = exportInventoryReport;
window.showBulkStockUpdate = showBulkStockUpdate;
window.applyBulkPercentage = applyBulkPercentage;
window.processBulkUpdate = processBulkUpdate;
window.showInventoryHistory = showInventoryHistory;
